import { beforeEach, describe, expect, test, vi } from 'vitest';
import { checkAuth } from '@/lib/auth';
import { getApiKey, updateApiKey } from '@/queries/prisma';
import { DELETE } from './route';

vi.mock('@/lib/auth', () => ({
  checkAuth: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {},
}));

vi.mock('@/queries/prisma', () => ({
  getApiKey: vi.fn(),
  updateApiKey: vi.fn(),
}));

const checkAuthMock = vi.mocked(checkAuth);
const getApiKeyMock = vi.mocked(getApiKey);
const updateApiKeyMock = vi.mocked(updateApiKey);

const params = { params: Promise.resolve({ userId: 'user-1', keyId: 'key-1' }) };

function sessionAuth(user: Record<string, unknown>) {
  return { user, token: 'session-token', authKey: undefined, shareToken: null } as any;
}

function deleteRequest() {
  return new Request('http://localhost/api/users/user-1/api-keys/key-1', { method: 'DELETE' });
}

function mockKey(overrides: Record<string, unknown> = {}) {
  getApiKeyMock.mockResolvedValue({
    id: 'key-1',
    userId: 'user-1',
    name: 'TradeSites',
    keyPrefix: 'umami_abcdef',
    createdAt: new Date('2026-09-13T12:00:00Z'),
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  } as any);
}

beforeEach(() => {
  checkAuthMock.mockReset();
  getApiKeyMock.mockReset();
  updateApiKeyMock.mockReset();
});

describe('DELETE /api/users/{userId}/api-keys/{keyId}', () => {
  test('revokes a key of the user themself', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));
    mockKey();

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateApiKeyMock).toHaveBeenCalledWith('key-1', { revokedAt: expect.any(Date) });
  });

  test('keeps the original revocation time when the key is already revoked', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));
    mockKey({ revokedAt: new Date('2026-09-01T00:00:00Z') });

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(200);
    expect(updateApiKeyMock).not.toHaveBeenCalled();
  });

  test('returns not found for a key that belongs to a different user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));
    mockKey({ userId: 'user-2' });

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(404);
    expect(updateApiKeyMock).not.toHaveBeenCalled();
  });

  test('returns not found for an unknown key', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-1', isAdmin: false }));
    getApiKeyMock.mockResolvedValue(null);

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(404);
  });

  test('rejects another non-admin user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'user-2', isAdmin: false }));
    mockKey();

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(401);
    expect(updateApiKeyMock).not.toHaveBeenCalled();
  });

  test('allows an admin to revoke a key of another user', async () => {
    checkAuthMock.mockResolvedValue(sessionAuth({ id: 'admin-1', isAdmin: true }));
    mockKey();

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(200);
    expect(updateApiKeyMock).toHaveBeenCalledWith('key-1', { revokedAt: expect.any(Date) });
  });

  test('rejects a caller authenticated with an API key', async () => {
    checkAuthMock.mockResolvedValue({
      user: { id: 'user-1', isAdmin: false },
      token: undefined,
      authKey: undefined,
      shareToken: null,
    } as any);
    mockKey();

    const response = await DELETE(deleteRequest(), params);

    expect(response.status).toBe(401);
    expect(updateApiKeyMock).not.toHaveBeenCalled();
  });
});
