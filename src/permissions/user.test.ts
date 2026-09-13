import { describe, expect, test } from 'vitest';
import { canManageApiKeys } from './user';

const session = { token: 'session-token' };

describe('canManageApiKeys', () => {
  test('allows a user with a login session to manage their own keys', async () => {
    expect(
      await canManageApiKeys(
        { ...session, user: { id: 'user-1', isAdmin: false } } as any,
        'user-1',
      ),
    ).toBe(true);
  });

  test('allows an admin with a login session to manage keys of another user', async () => {
    expect(
      await canManageApiKeys(
        { ...session, user: { id: 'admin-1', isAdmin: true } } as any,
        'user-1',
      ),
    ).toBe(true);
  });

  test('denies another non-admin user', async () => {
    expect(
      await canManageApiKeys(
        { ...session, user: { id: 'user-2', isAdmin: false } } as any,
        'user-1',
      ),
    ).toBe(false);
  });

  test('denies a caller authenticated with an API key instead of a login session', async () => {
    expect(
      await canManageApiKeys(
        { token: undefined, user: { id: 'user-1', isAdmin: true } } as any,
        'user-1',
      ),
    ).toBe(false);
  });

  test('denies a request without a user', async () => {
    expect(await canManageApiKeys({ ...session, user: undefined } as any, 'user-1')).toBe(false);
  });
});
