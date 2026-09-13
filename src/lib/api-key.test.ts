import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  API_KEY_PREFIX,
  API_KEY_TOUCH_INTERVAL_MS,
  generateApiKey,
  getApiKeyPrefix,
  hashApiKey,
  isApiKeyActive,
  shouldTouchApiKey,
} from './api-key';

describe('generateApiKey', () => {
  test('returns the umami_ prefix followed by 40 URL-safe characters', () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^umami_[A-Za-z0-9_-]{40}$/);
  });

  test('returns a different key on every call', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey()));

    expect(keys.size).toBe(50);
  });
});

describe('hashApiKey', () => {
  test('returns the sha256 hex digest of the key', () => {
    const key = 'umami_0123456789abcdefghijklmnopqrstuvwxyzABCD';

    expect(hashApiKey(key)).toBe(createHash('sha256').update(key).digest('hex'));
    expect(hashApiKey(key)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('getApiKeyPrefix', () => {
  test('returns the first 12 characters for display', () => {
    expect(getApiKeyPrefix('umami_abcdefghijklmnopqrstuvwxyz01234567890123')).toBe('umami_abcdef');
  });
});

describe('isApiKeyActive', () => {
  const now = new Date('2026-09-13T12:00:00Z');

  test('accepts a key that is neither revoked nor expired', () => {
    expect(isApiKeyActive({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(
      isApiKeyActive({ revokedAt: null, expiresAt: new Date('2026-09-14T00:00:00Z') }, now),
    ).toBe(true);
  });

  test('rejects a revoked key even when its expiry is in the future', () => {
    expect(
      isApiKeyActive(
        {
          revokedAt: new Date('2026-09-01T00:00:00Z'),
          expiresAt: new Date('2027-01-01T00:00:00Z'),
        },
        now,
      ),
    ).toBe(false);
  });

  test('rejects a key whose expiry has passed', () => {
    expect(
      isApiKeyActive({ revokedAt: null, expiresAt: new Date('2026-09-13T11:59:59Z') }, now),
    ).toBe(false);
    expect(isApiKeyActive({ revokedAt: null, expiresAt: now }, now)).toBe(false);
  });
});

describe('shouldTouchApiKey', () => {
  const now = new Date('2026-09-13T12:00:00Z');

  test('writes lastUsedAt on first use', () => {
    expect(shouldTouchApiKey({ lastUsedAt: null }, now)).toBe(true);
  });

  test('does not write lastUsedAt when it is fresher than the interval', () => {
    const recent = new Date(now.getTime() - API_KEY_TOUCH_INTERVAL_MS + 1000);

    expect(shouldTouchApiKey({ lastUsedAt: recent }, now)).toBe(false);
  });

  test('writes lastUsedAt once the interval has elapsed', () => {
    expect(API_KEY_TOUCH_INTERVAL_MS).toBe(60_000);
    expect(
      shouldTouchApiKey({ lastUsedAt: new Date(now.getTime() - API_KEY_TOUCH_INTERVAL_MS) }, now),
    ).toBe(true);
  });
});
