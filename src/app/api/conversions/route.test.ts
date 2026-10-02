import { beforeEach, expect, test, vi } from 'vitest';
import { checkAuth } from '@/lib/auth';
import { CACHE_TOKEN_TYPE } from '@/lib/constants';
import { secret } from '@/lib/crypto';
import { createToken } from '@/lib/jwt';
import { canUpdateWebsite } from '@/permissions';
import { POST } from './route';

vi.mock('@/lib/auth', () => ({ checkAuth: vi.fn() }));
vi.mock('@/permissions', () => ({ canUpdateWebsite: vi.fn() }));
vi.mock('@/lib/clickhouse', () => ({ default: { enabled: false } }));
const db = vi.hoisted(() => ({
  websiteEvent: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  session: { findFirst: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    client: db,
    transaction: vi.fn((callback: any) => callback(db)),
  },
}));

const website = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conversionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const visitId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const body = {
  website,
  conversionId,
  occurredAt: '2026-10-02T18:34:42.000Z',
  data: {
    quote_request_id: conversionId,
    pathname: '/solar-installers/uk/peterborough',
    source: 'solar-installers/peterborough',
  },
};
function request(payload: any = body, key = true) {
  return new Request('http://localhost/api/conversions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-umami-api-key': 'test-key' } : {}),
    },
    body: JSON.stringify(payload),
  });
}
function cache(extra = {}) {
  return createToken(
    { type: CACHE_TOKEN_TYPE, websiteId: website, sessionId, visitId, ...extra },
    secret(),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkAuth).mockResolvedValue({ user: { id: 'owner' } } as any);
  vi.mocked(canUpdateWebsite).mockResolvedValue(true);
  db.websiteEvent.findUnique.mockResolvedValue(null);
  db.websiteEvent.findFirst.mockResolvedValue({ id: 'pageview' });
  db.session.findFirst.mockResolvedValue({ id: sessionId });
  db.websiteEvent.create.mockResolvedValue({});
});

test('requires API key, authenticated owner and website write permission', async () => {
  expect((await POST(request(body, false))).status).toBe(401);
  vi.mocked(checkAuth).mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  vi.mocked(checkAuth).mockResolvedValue({ user: { id: 'owner' } } as any);
  vi.mocked(canUpdateWebsite).mockResolvedValue(false);
  expect((await POST(request())).status).toBe(403);
  expect(db.websiteEvent.create).not.toHaveBeenCalled();
});
test('links signed cache to the original website session and visit without recomputing server IP', async () => {
  const result = await POST(request({ ...body, sessionCache: cache() }));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ conversionId, linked: true });
  expect(db.session.findFirst).toHaveBeenCalledWith({
    where: { id: sessionId, websiteId: website },
  });
  expect(db.websiteEvent.findFirst).toHaveBeenCalledWith({
    where: { websiteId: website, sessionId, visitId },
  });
  expect(db.websiteEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      websiteId: website,
      sessionId,
      visitId,
      createdAt: new Date(body.occurredAt),
      eventName: 'quote_request_submit',
      urlPath: body.data.pathname,
      eventData: {
        create: expect.arrayContaining([
          expect.objectContaining({ dataKey: 'quote_request_id', stringValue: conversionId }),
        ]),
      },
    }),
  });
  expect(db.session.upsert).not.toHaveBeenCalled();
});
test.each([
  ['broken', () => 'invalid'],
  ['wrong website', () => cache({ websiteId: conversionId })],
  ['wrong token type', () => cache({ type: 'share' })],
])('rejects %s cache rather than guessing a visitor', async (_, token) => {
  expect((await POST(request({ ...body, sessionCache: token() }))).status).toBe(400);
  expect(db.websiteEvent.create).not.toHaveBeenCalled();
});
test('rejects a valid cache if its session or visit does not belong to this website', async () => {
  db.session.findFirst.mockResolvedValue(null);
  expect((await POST(request({ ...body, sessionCache: cache() }))).status).toBe(400);
  db.session.findFirst.mockResolvedValue({ id: sessionId });
  db.websiteEvent.findFirst.mockResolvedValue(null);
  expect((await POST(request({ ...body, sessionCache: cache() }))).status).toBe(400);
  expect(db.websiteEvent.create).not.toHaveBeenCalled();
});
test('missing cache records an explicitly unlinked conversion, never a guessed session', async () => {
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ linked: false });
  const data = db.websiteEvent.create.mock.calls[0][0].data;
  expect(data.sessionId).not.toBe(sessionId);
  expect(data.eventData.create).toContainEqual(
    expect.objectContaining({ dataKey: 'attribution_status', stringValue: 'unlinked' }),
  );
  expect(db.session.upsert).toHaveBeenCalled();
});
test('a completed retry returns the stored link state without writing another event', async () => {
  db.websiteEvent.findUnique.mockResolvedValue({
    id: 'saved',
    eventData: [{ dataKey: 'attribution_status', stringValue: 'linked' }],
  });
  const result = await POST(request());
  expect(await result.json()).toMatchObject({ conversionId, linked: true, duplicate: true });
  expect(db.websiteEvent.create).not.toHaveBeenCalled();
});
test('concurrent unique-key conflict returns success only if the deterministic event exists', async () => {
  db.websiteEvent.findUnique
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'saved', eventData: [] });
  db.websiteEvent.create.mockRejectedValueOnce({ code: 'P2002' });
  expect((await POST(request())).status).toBe(200);
  db.websiteEvent.findUnique.mockResolvedValue(null);
  db.websiteEvent.create.mockRejectedValueOnce({ code: 'P2002' });
  expect((await POST(request())).status).toBe(500);
});
test.each([
  { ...body, data: { ...body.data, customer_email: 'private@example.com' } },
  { ...body, data: { ...body.data, quote_request_id: website } },
  { ...body, occurredAt: 'bad-time' },
  { ...body, data: { ...body.data, pathname: 'https://example.com' } },
  { ...body, data: { ...body.data, landing_page: 'https://example.com/?email=private' } },
  { ...body, data: { ...body.data, landing_page: '/quote?email=private' } },
  { ...body, data: { ...body.data, landing_page: '/quote\nprivate' } },
])('rejects unsafe or inconsistent input', async payload => {
  expect((await POST(request(payload))).status).toBe(400);
  expect(db.websiteEvent.create).not.toHaveBeenCalled();
});

test('deterministic conversion IDs survive signing-secret rotation', async () => {
  const first = await (await POST(request())).json();
  const previous = process.env.APP_SECRET;
  process.env.APP_SECRET = 'rotated-test-secret';
  try {
    const second = await (await POST(request())).json();
    expect(second.eventId).toBe(first.eventId);
  } finally {
    process.env.APP_SECRET = previous;
  }
});
test('persists a referrer hostname without accepting a URL or contact-bearing query', async () => {
  expect(
    (await POST(request({ ...body, data: { ...body.data, referrer_domain: 'www.google.co.uk' } })))
      .status,
  ).toBe(200);
  expect(db.websiteEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ referrerDomain: 'www.google.co.uk' }),
  });
  for (const value of [
    'https://google.com',
    'google.com?email=private',
    'private@google.com',
    'google.com\n',
  ]) {
    expect(
      (await POST(request({ ...body, data: { ...body.data, referrer_domain: value } }))).status,
    ).toBe(400);
  }
});
test('accepts the complete synthetic payload produced by SIL buildQuoteConversion', async () => {
  const fixture = {
    website: '00000000-0000-4000-8000-000000000001',
    conversionId: '00000000-0000-4000-8000-000000000002',
    occurredAt: '2026-10-02T18:34:42.453Z',
    data: {
      quote_request_id: '00000000-0000-4000-8000-000000000002',
      referrer_domain: 'duckduckgo.com',
      source: 'solar-installers/peterborough',
      pathname: '/get-quotes',
      landing_page: '/solar-installers/uk/peterborough',
      utm_source: 'fixture-search',
      utm_medium: 'organic',
      utm_campaign: 'fixture-campaign',
      funnel_name: 'location_quote',
    },
  };
  const result = await POST(request(fixture));
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    conversionId: fixture.conversionId,
    linked: false,
    duplicate: false,
  });
  expect(db.websiteEvent.create).toHaveBeenCalledWith({
    data: expect.objectContaining({
      websiteId: fixture.website,
      urlPath: '/get-quotes',
      referrerDomain: 'duckduckgo.com',
      utmSource: 'fixture-search',
      utmMedium: 'organic',
      utmCampaign: 'fixture-campaign',
    }),
  });
});
