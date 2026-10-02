import { v5 } from 'uuid';
import { z } from 'zod';
import { checkAuth } from '@/lib/auth';
import clickhouse from '@/lib/clickhouse';
import { API_KEY_HEADER, CACHE_TOKEN_TYPE, DATA_TYPE, EVENT_TYPE } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import { parseToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import { badRequest, forbidden, json, serverError, unauthorized } from '@/lib/response';
import { canUpdateWebsite } from '@/permissions';

const text = z
  .string()
  .max(255)
  .refine(value => !/^[=+\-@\t\r]/.test(value));
const pathname = z
  .string()
  .max(500)
  .regex(/^\/(?!\/)[^?#\r\n]*$/);
const schema = z
  .strictObject({
    website: z.uuid(),
    conversionId: z.uuid(),
    occurredAt: z.iso.datetime({ offset: true }),
    sessionCache: z.string().max(4096).optional(),
    data: z.strictObject({
      quote_request_id: z.uuid(),
      pathname,
      source: text.optional(),
      landing_page: pathname.optional(),
      utm_source: text.optional(),
      utm_medium: text.optional(),
      utm_campaign: text.optional(),
      funnel_name: text.optional(),
      referrer_domain: z
        .string()
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/i)
        .optional(),
    }),
  })
  .refine(value => value.conversionId === value.data.quote_request_id);

const eventLookup = (id: string) =>
  prisma.client.websiteEvent.findUnique({
    where: { id },
    include: { eventData: { where: { dataKey: 'attribution_status' } } },
  });
const storedResult = (event: any, conversionId: string) =>
  json({
    conversionId,
    eventId: event.id,
    duplicate: true,
    linked: event.eventData.some((entry: any) => entry.stringValue === 'linked'),
  });
const invalidSession = () => badRequest({ code: 'invalid-session-cache' });
const conversionUuid = (kind: string, website: string, conversionId: string) =>
  v5(JSON.stringify([kind, website, conversionId]), v5.URL);

export async function POST(request: Request) {
  try {
    if (!request.headers.get(API_KEY_HEADER)) return unauthorized();
    const auth = await checkAuth(request);
    if (!auth?.user) return unauthorized();
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return badRequest();
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return badRequest();
    const { website, conversionId, occurredAt, sessionCache, data } = parsed.data;
    if (!(await canUpdateWebsite(auth, website))) return forbidden();
    // Atomic primary-key deduplication below depends on the relational backend.
    if (clickhouse.enabled) return serverError('Server conversions require PostgreSQL.');
    const eventId = conversionUuid('server-conversion', website, conversionId);
    const existing = await eventLookup(eventId);
    if (existing) return storedResult(existing, conversionId);

    let linked = false;
    let sessionId = conversionUuid('unlinked-conversion', website, conversionId);
    let visitId = conversionUuid('unlinked-conversion-visit', website, conversionId);
    if (sessionCache) {
      let cache: any;
      try {
        cache = parseToken(sessionCache, secret());
      } catch {
        return invalidSession();
      }
      if (
        cache?.type !== CACHE_TOKEN_TYPE ||
        cache.websiteId !== website ||
        !z.uuid().safeParse(cache.sessionId).success ||
        !z.uuid().safeParse(cache.visitId).success
      )
        return invalidSession();
      const session = await prisma.client.session.findFirst({
        where: { id: cache.sessionId, websiteId: website },
      });
      const visit = await prisma.client.websiteEvent.findFirst({
        where: { websiteId: website, sessionId: cache.sessionId, visitId: cache.visitId },
      });
      if (!session || !visit) return invalidSession();
      sessionId = cache.sessionId;
      visitId = cache.visitId;
      linked = true;
    }

    const createdAt = new Date(occurredAt);
    const eventData = { ...data, attribution_status: linked ? 'linked' : 'unlinked' };
    try {
      await prisma.transaction(async tx => {
        if (!linked) {
          await tx.session.upsert({
            where: { id: sessionId },
            update: {},
            create: { id: sessionId, websiteId: website, createdAt },
          });
        }
        // Nested create commits the event and its properties together, or neither.
        await tx.websiteEvent.create({
          data: {
            id: eventId,
            websiteId: website,
            sessionId,
            visitId,
            createdAt,
            eventType: EVENT_TYPE.customEvent,
            eventName: 'quote_request_submit',
            urlPath: data.pathname,
            utmSource: data.utm_source,
            utmMedium: data.utm_medium,
            utmCampaign: data.utm_campaign,
            referrerDomain: data.referrer_domain,
            eventData: {
              create: Object.entries(eventData)
                .filter(([, value]) => value !== undefined)
                .map(([dataKey, stringValue]) => ({
                  id: uuid(),
                  websiteId: website,
                  dataKey,
                  stringValue,
                  dataType: DATA_TYPE.string,
                  createdAt,
                })),
            },
          },
        });
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        const saved = await eventLookup(eventId);
        if (saved) return storedResult(saved, conversionId);
      }
      throw error;
    }
    return json({ conversionId, eventId, linked, duplicate: false });
  } catch {
    // Avoid exposing request bodies, signed cache tokens or database connection strings.
    return serverError('Unable to save server conversion.');
  }
}
