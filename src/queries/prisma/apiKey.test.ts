import { beforeEach, describe, expect, test, vi } from 'vitest';
import { API_KEY_TOUCH_INTERVAL_MS } from '@/lib/api-key';
import {
  createApiKey,
  getApiKey,
  getApiKeyByHash,
  getUserApiKeys,
  touchApiKey,
  updateApiKey,
} from './apiKey';

const { findUniqueMock, createMock, updateMock, updateManyMock, pagedQueryMock } = vi.hoisted(
  () => ({
    findUniqueMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
    updateManyMock: vi.fn(),
    pagedQueryMock: vi.fn(),
  }),
);

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      apiKey: {
        findUnique: findUniqueMock,
        create: createMock,
        update: updateMock,
        updateMany: updateManyMock,
      },
    },
    pagedQuery: pagedQueryMock,
  },
}));

beforeEach(() => {
  findUniqueMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  updateManyMock.mockReset();
  pagedQueryMock.mockReset();
});

function selectOf(call: any[]) {
  return call[call.length - 1].select;
}

describe('api key queries never return the key hash', () => {
  test('getApiKey selects display fields and the owner only', async () => {
    await getApiKey('key-1');

    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { id: 'key-1' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        userId: true,
      },
    });
  });

  test('getApiKeyByHash looks up by hash and selects only what auth needs', async () => {
    await getApiKeyByHash('a'.repeat(64));

    expect(findUniqueMock.mock.calls[0][0].where).toEqual({ keyHash: 'a'.repeat(64) });
    expect(selectOf(findUniqueMock.mock.calls[0])).not.toHaveProperty('keyHash');
  });

  test('getUserApiKeys pages over unrevoked keys of the user without the hash', async () => {
    await getUserApiKeys('user-1', { page: 2 });

    const [model, criteria, filters] = pagedQueryMock.mock.calls[0];

    expect(model).toBe('apiKey');
    expect(criteria.where).toEqual({ userId: 'user-1', revokedAt: null });
    expect(criteria.select).not.toHaveProperty('keyHash');
    expect(filters).toEqual({ page: 2 });
  });

  test('createApiKey and updateApiKey return rows without the hash', async () => {
    await createApiKey({
      id: 'key-1',
      userId: 'user-1',
      name: 'n',
      keyHash: 'h',
      keyPrefix: 'umami_abcdef',
    });
    await updateApiKey('key-1', { revokedAt: new Date() });

    expect(selectOf(createMock.mock.calls[0])).not.toHaveProperty('keyHash');
    expect(selectOf(updateMock.mock.calls[0])).not.toHaveProperty('keyHash');
  });
});

describe('touchApiKey', () => {
  test('only writes lastUsedAt when it is unset or older than the throttle interval', async () => {
    const now = new Date('2026-09-13T12:00:00Z');

    await touchApiKey('key-1', now);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'key-1',
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lte: new Date(now.getTime() - API_KEY_TOUCH_INTERVAL_MS) } },
        ],
      },
      data: { lastUsedAt: now },
    });
  });
});
