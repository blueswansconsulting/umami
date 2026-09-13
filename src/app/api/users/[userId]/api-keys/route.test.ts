import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hashApiKey } from '@/lib/api-key';
import { checkAuth } from '@/lib/auth';
import { createApiKey, getUserApiKeys } from '@/queries/prisma';
import { GET, POST } from './route';

vi.mock('@/lib/auth', () => ({
  checkAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {},
}));

vi.mock('@/queries/prisma', () => ({
  createApiKey: vi.fn(),
  getUserApiKeys: vi.fn(),
}));

const checkAuthMock = vi.mocked(checkAuth);
const createApiKeyMock = vi.mocked(createApiKey);
const getUserApiKeysMock = vi.mocked(getUserApiKeys);

const params = { params: Promise.resolve({ userId: 'user-1' }) };

function sessionAuth(user: Record<string, unknown>) {
  return { user, token: 'session-token', authKey: undefined, shareToken: null } as any;
}

function postRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/users/user-1/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  checkAuthMock.mockReset();
  createApiKeyMock.mockReset();
  getUserApiKeysMock.mockReset();
  createApiKeyMock.mockImplementation(async ({ keyHash, ...data }) => ({
    ...data,
    createdAt: new Date('2026-09-13T12:00:00Z'),
    expiresAt: data.expiresAt ?? null,
    lastUsedAt: null,
    revokedAt: null,
  }));
});

describe('POST /api/users/{userId}/api-keys', () => {
  test('creates a key for the user themself and returns the plaintext once', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));

    const response = await POST(postRequest({ name: 'TradeSites' }), params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.key).toMatch(/^umami_[A-Za-z0-9_-]{40}$/);
    expect(body.keyPrefix).toBe(body.key.slice(0, 12));
    expect(body.name).toBe('TradeSites');
    expect(body.expiresAt).toBeNull();
    expect(createApiKeyMock).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: 'user-1',
      name: 'TradeSites',
      keyHash: hashApiKey(body.key),
      keyPrefix: body.keyPrefix,
      expiresAt: undefined,
    });
    expect(JSON.stringify(createApiKeyMock.mock.calls[0][0])).not.toContain(body.key);
  });

  test('stores a future expiry date', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));

    const response = await POST(
      postRequest({ name: 'Expiring', expiresAt: '2030-01-01T00:00:00.000Z' }),
      params,
    );

    expect(response.status).toBe(200);
    expect(createApiKeyMock.mock.calls[0][0].expiresAt).toEqual(new Date('2030-01-01T00:00:00Z'));
  });

  test('rejects an expiry date in the past', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));

    const response = await POST(
      postRequest({ name: 'Expired', expiresAt: '2020-01-01T00:00:00.000Z' }),
      params,
    );

    expect(response.status).toBe(400);
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  test('rejects a blank name', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));

    const response = await POST(postRequest({ name: '   ' }), params);

    expect(response.status).toBe(400);
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  test('rejects another non-admin user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-2', isAdmin: false }));

    const response = await POST(postRequest({ name: 'Nope' }), params);

    expect(response.status).toBe(401);
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  test('allows an admin to create a key for another user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'admin-1', isAdmin: true }));

    const response = await POST(postRequest({ name: 'Admin made' }), params);

    expect(response.status).toBe(200);
    expect(createApiKeyMock.mock.calls[0][0].userId).toBe('user-1');
  });

  test('rejects a caller authenticated with an API key', async () => {
    checkAuthMock.mockResolvedValue({
      user: { id: 'user-1', isAdmin: true },
      token: undefined,
      authKey: undefined,
      shareToken: null,
    } as any);

    const response = await POST(postRequest({ name: 'Replacement' }), params);

    expect(response.status).toBe(401);
    expect(createApiKeyMock).not.toHaveBeenCalled();
  });

  test('rejects an unauthenticated request', async () => {
    checkAuthMock.mockResolvedValue(null);

    const response = await POST(postRequest({ name: 'Anon' }), params);

    expect(response.status).toBe(401);
  });
});

describe('GET /api/users/{userId}/api-keys', () => {
  const page = {
    data: [
      {
        id: 'key-1',
        name: 'TradeSites',
        keyPrefix: 'umami_abcdef',
        createdAt: '2026-09-13T12:00:00.000Z',
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
      },
    ],
    count: 1,
    page: 1,
    pageSize: 20,
  };

  test('lists the keys of the user themself', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));
    getUserApiKeysMock.mockResolvedValue(page as any);

    const response = await GET(
      new Request('http://localhost/api/users/user-1/api-keys?page=2&pageSize=5'),
      params,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(page);
    expect(getUserApiKeysMock).toHaveBeenCalledWith('user-1', { page: 2, pageSize: 5 });
  });

  test('rejects another non-admin user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-2', isAdmin: false }));

    const response = await GET(new Request('http://localhost/api/users/user-1/api-keys'), params);

    expect(response.status).toBe(401);
    expect(getUserApiKeysMock).not.toHaveBeenCalled();
  });

  test('allows an admin to list keys of another user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'admin-1', isAdmin: true }));
    getUserApiKeysMock.mockResolvedValue(page as any);

    const response = await GET(new Request('http://localhost/api/users/user-1/api-keys'), params);

    expect(response.status).toBe(200);
  });
});
