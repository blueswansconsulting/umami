import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { API_KEY_HEADER } from '@/lib/constants';
import { hash } from '@/lib/crypto';
import { parseSecureToken } from '@/lib/jwt';
import redis from '@/lib/redis';
import { getApiKeyByHash, touchApiKey } from '@/queries/prisma/apiKey';
import { getUser } from '@/queries/prisma/user';
import { API_KEY_TOUCH_INTERVAL_MS, hashApiKey } from './api-key';
import { checkAuth } from './auth';

vi.mock('@/lib/jwt', () => ({
  parseSecureToken: vi.fn(),
  parseToken: vi.fn(() => null),
}));

vi.mock('@/queries/prisma/user', () => ({
  getUser: vi.fn(),
}));

vi.mock('@/queries/prisma/apiKey', () => ({
  getApiKeyByHash: vi.fn(),
  touchApiKey: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  default: {
    enabled: false,
    client: {
      get: vi.fn(),
    },
  },
}));

const parseSecureTokenMock = vi.mocked(parseSecureToken);
const getUserMock = vi.mocked(getUser);
const getApiKeyByHashMock = vi.mocked(getApiKeyByHash);
const touchApiKeyMock = vi.mocked(touchApiKey);
const redisMock = redis as unknown as {
  enabled: boolean;
  client: {
    get: ReturnType<typeof vi.fn>;
  };
};

const PASSWORD_HASH = '$2b$10$currentpasswordhashvalue';

function authedRequest() {
  return new Request('http://localhost/api/test', {
    headers: { authorization: 'Bearer secure-token' },
  });
}

function mockUser() {
  getUserMock.mockResolvedValue({
    id: 'user-1',
    username: 'bob',
    role: 'user',
    password: PASSWORD_HASH,
  } as any);
}

beforeEach(() => {
  parseSecureTokenMock.mockReset();
  getUserMock.mockReset();
  getApiKeyByHashMock.mockReset();
  touchApiKeyMock.mockReset();
  redisMock.enabled = false;
  redisMock.client.get.mockReset();
});

describe('checkAuth password fingerprint', () => {
  test('authorizes a stateless token whose fingerprint matches the current password', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user?.id).toBe('user-1');
  });

  test('authorizes a legacy stateless token that does not include a password fingerprint', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1' } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user?.id).toBe('user-1');
  });

  test('rejects a stateless token whose fingerprint predates a password change', async () => {
    // Token minted against the old password must stop working once the password changes.
    parseSecureTokenMock.mockReturnValue({
      userId: 'user-1',
      pwd: hash('old-password-hash'),
    } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
  });

  test('does not expose the password hash on the returned user', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) } as any);
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user).not.toHaveProperty('password');
  });

  test('authorizes a Redis session whose fingerprint matches the current password', async () => {
    redisMock.enabled = true;
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    redisMock.client.get.mockResolvedValue({ userId: 'user-1', pwd: hash(PASSWORD_HASH) });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result?.user?.id).toBe('user-1');
  });

  test('rejects a Redis session whose fingerprint predates a password change', async () => {
    redisMock.enabled = true;
    parseSecureTokenMock.mockReturnValue({ authKey: 'auth:session-key' } as any);
    redisMock.client.get.mockResolvedValue({ userId: 'user-1', pwd: hash('old-password-hash') });
    mockUser();

    const result = await checkAuth(authedRequest());

    expect(result).toBeNull();
  });
});

describe('checkAuth API key', () => {
  const NOW = new Date('2026-09-13T12:00:00Z');
  const API_KEY = 'umami_0123456789abcdefghijklmnopqrstuvwxyzABCD';

  function apiKeyRequest(key: string | null = API_KEY, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/test', {
      headers: { ...(key !== null && { [API_KEY_HEADER]: key }), ...headers },
    });
  }

  function mockApiKey(overrides: Record<string, unknown> = {}) {
    getApiKeyByHashMock.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      ...overrides,
    } as any);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('authorizes the key owner from a valid x-umami-api-key header with token undefined', async () => {
    mockApiKey();
    mockUser();

    const result = await checkAuth(apiKeyRequest());

    expect(getApiKeyByHashMock).toHaveBeenCalledWith(hashApiKey(API_KEY));
    expect(getUserMock).toHaveBeenCalledWith('user-1');
    expect(result?.user?.id).toBe('user-1');
    expect(result?.user?.isAdmin).toBe(false);
    expect(result?.user).not.toHaveProperty('password');
    expect(result?.token).toBeUndefined();
  });

  test('rejects a revoked key', async () => {
    mockApiKey({ revokedAt: new Date('2026-09-01T00:00:00Z'), expiresAt: new Date('2027-01-01') });
    mockUser();

    expect(await checkAuth(apiKeyRequest())).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('rejects an expired key', async () => {
    mockApiKey({ expiresAt: new Date('2026-09-13T11:59:59Z') });
    mockUser();

    expect(await checkAuth(apiKeyRequest())).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('rejects an unknown key', async () => {
    getApiKeyByHashMock.mockResolvedValue(null);
    mockUser();

    expect(await checkAuth(apiKeyRequest('umami_unknownunknownunknownunknownunknown0'))).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('rejects a key whose user no longer exists', async () => {
    mockApiKey();
    getUserMock.mockResolvedValue(null);

    expect(await checkAuth(apiKeyRequest())).toBeNull();
    expect(touchApiKeyMock).not.toHaveBeenCalled();
  });

  test('does not fall back to a valid bearer token when the api key is invalid', async () => {
    getApiKeyByHashMock.mockResolvedValue(null);
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1' } as any);
    mockUser();

    const result = await checkAuth(
      apiKeyRequest('umami_badbadbadbadbadbadbadbadbadbadbadbadbad0', {
        authorization: 'Bearer secure-token',
      }),
    );

    expect(result).toBeNull();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  test('treats an empty api key header as absent and uses the bearer token', async () => {
    parseSecureTokenMock.mockReturnValue({ userId: 'user-1' } as any);
    mockUser();

    const result = await checkAuth(apiKeyRequest('', { authorization: 'Bearer secure-token' }));

    expect(result?.user?.id).toBe('user-1');
    expect(result?.token).toBe('secure-token');
    expect(getApiKeyByHashMock).not.toHaveBeenCalled();
  });

  test('writes lastUsedAt on the first use of a key', async () => {
    mockApiKey({ lastUsedAt: null });
    mockUser();

    await checkAuth(apiKeyRequest());

    expect(touchApiKeyMock).toHaveBeenCalledWith('key-1');
  });

  test('does not write lastUsedAt again within the throttle interval', async () => {
    mockApiKey({ lastUsedAt: new Date(NOW.getTime() - API_KEY_TOUCH_INTERVAL_MS + 1000) });
    mockUser();

    const result = await checkAuth(apiKeyRequest());

    expect(result?.user?.id).toBe('user-1');
    expect(touchApiKeyMock).not.toHaveBeenCalled();
  });

  test('writes lastUsedAt again once the throttle interval has elapsed', async () => {
    mockApiKey({ lastUsedAt: new Date(NOW.getTime() - API_KEY_TOUCH_INTERVAL_MS) });
    mockUser();

    await checkAuth(apiKeyRequest());

    expect(touchApiKeyMock).toHaveBeenCalledWith('key-1');
  });
});
