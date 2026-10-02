import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CACHE_TOKEN_TYPE } from '@/lib/constants';
import { secret } from '@/lib/crypto';
import { createToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import { getWebsiteStats } from '@/queries/sql/getWebsiteStats';
import { POST } from './route';

// Exercise the real PostgreSQL write path; authentication is covered separately.
vi.mock('@/lib/auth', () => ({ checkAuth: vi.fn(async () => ({ user: { id: 'owner' } })) }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn(async () => true) }));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));

describe.runIf(process.env.UMAMI_CONVERSION_INTEGRATION === '1')(
  'PostgreSQL conversion persistence',
  () => {
    const website = randomUUID();
    const sessionId = randomUUID();
    const visitId = randomUUID();
    const client = prisma.client;
    function request(conversionId: string, sessionCache?: string) {
      return new Request('http://localhost/api/conversions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-umami-api-key': 'test-key' },
        body: JSON.stringify({
          website,
          conversionId,
          occurredAt: '2026-10-02T18:34:42Z',
          sessionCache,
          data: { quote_request_id: conversionId, pathname: '/solar-installers/uk/peterborough' },
        }),
      });
    }
    beforeAll(async () => {
      const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) ||
        !/^\/(?:dummy|[a-z0-9_]+_test)$/.test(connection.pathname)
      ) {
        throw new Error('Conversion integration tests require an isolated local test database.');
      }
      await client.website.create({
        data: { id: website, name: 'Conversion integration fixture' },
      });
      await client.session.create({ data: { id: sessionId, websiteId: website } });
      await client.websiteEvent.create({
        data: {
          id: randomUUID(),
          websiteId: website,
          sessionId,
          visitId,
          urlPath: '/solar-installers/uk/peterborough',
        },
      });
    });
    afterAll(async () => {
      const connection = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
      if (
        !['localhost', '127.0.0.1', '[::1]'].includes(connection.hostname) ||
        !/^\/(?:dummy|[a-z0-9_]+_test)$/.test(connection.pathname)
      )
        return;
      await client.eventData.deleteMany({ where: { websiteId: website } });
      await client.websiteEvent.deleteMany({ where: { websiteId: website } });
      await client.session.deleteMany({ where: { websiteId: website } });
      await client.website.delete({ where: { id: website } });
    });
    test.each([true, false])(
      'eight concurrent requests save exactly one complete conversion (linked=%s)',
      async linked => {
        const conversionId = randomUUID();
        const cache = linked
          ? createToken(
              { type: CACHE_TOKEN_TYPE, websiteId: website, sessionId, visitId },
              secret(),
            )
          : undefined;
        const responses = await Promise.all(
          Array.from({ length: 8 }, () => POST(request(conversionId, cache))),
        );
        expect(responses.map(response => response.status)).toEqual(Array(8).fill(200));
        const results = await Promise.all(responses.map(response => response.json()));
        expect(new Set(results.map(result => result.eventId)).size).toBe(1);
        const events = await client.websiteEvent.findMany({
          where: { id: results[0].eventId },
          include: { eventData: true },
        });
        expect(events).toHaveLength(1);
        expect(events[0].eventData).toHaveLength(3);
        expect(events[0].eventData).toContainEqual(
          expect.objectContaining({ dataKey: 'quote_request_id', stringValue: conversionId }),
        );
        expect(events[0].eventData).toContainEqual(
          expect.objectContaining({
            dataKey: 'attribution_status',
            stringValue: linked ? 'linked' : 'unlinked',
          }),
        );
        if (linked) {
          expect(events[0].sessionId).toBe(sessionId);
          expect(events[0].visitId).toBe(visitId);
        } else {
          expect(events[0].sessionId).not.toBe(sessionId);
          expect(await client.session.count({ where: { id: events[0].sessionId } })).toBe(1);
        }
      },
    );
    test('failure of a nested property rolls back event and synthetic session', async () => {
      const beforeEvents = await client.websiteEvent.count({ where: { websiteId: website } });
      const beforeSessions = await client.session.count({ where: { websiteId: website } });
      await client.$executeRawUnsafe(
        `ALTER TABLE event_data ADD CONSTRAINT conversion_test_failure CHECK (data_key <> 'attribution_status') NOT VALID`,
      );
      try {
        expect((await POST(request(randomUUID()))).status).toBe(500);
        expect(await client.websiteEvent.count({ where: { websiteId: website } })).toBe(
          beforeEvents,
        );
        expect(await client.session.count({ where: { websiteId: website } })).toBe(beforeSessions);
      } finally {
        await client.$executeRawUnsafe(
          'ALTER TABLE event_data DROP CONSTRAINT conversion_test_failure',
        );
      }
    });
    test('unlinked conversion sessions do not inflate default visitor or visit totals', async () => {
      const stats = (await getWebsiteStats(website, {
        startDate: new Date('1970-01-01'),
        endDate: new Date('2100-01-01'),
      })) as unknown as { visitors: number; visits: number; pageviews: number };
      expect(Number(stats.visitors)).toBe(1);
      expect(Number(stats.visits)).toBe(1);
      expect(Number(stats.pageviews)).toBe(1);
      expect(await client.session.count({ where: { websiteId: website } })).toBe(2);
    });
  },
);
