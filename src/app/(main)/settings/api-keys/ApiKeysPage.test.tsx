import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@/test/render';
import { ApiKeysPage } from './ApiKeysPage';

const PLAINTEXT_KEY = 'umami_0123456789abcdefghijklmnopqrstuvwxyzABCD';

const mocks = vi.hoisted(() => ({
  createKey: vi.fn(),
  revokeKey: vi.fn(),
  touch: vi.fn(),
  toast: vi.fn(),
  keys: [] as Record<string, unknown>[],
  deletePaths: [] as string[],
}));

vi.mock('@/components/hooks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/hooks')>();

  return {
    ...actual,
    useLoginQuery: () => ({ user: { id: 'user-1', role: 'user' } }),
    useUserApiKeysQuery: () => ({
      data: { data: mocks.keys, count: mocks.keys.length, page: 1, pageSize: 20 },
      isLoading: false,
      isFetching: false,
      error: null,
    }),
    useUpdateQuery: () => ({
      mutateAsync: mocks.createKey,
      error: null,
      isPending: false,
      touch: mocks.touch,
      toast: mocks.toast,
    }),
    useDeleteQuery: (path: string) => {
      mocks.deletePaths.push(path);

      return { mutateAsync: mocks.revokeKey, error: null, isPending: false, touch: mocks.touch };
    },
    useModified: () => ({ modified: undefined, touch: mocks.touch }),
  };
});

beforeEach(() => {
  mocks.createKey.mockReset();
  mocks.revokeKey.mockReset();
  mocks.touch.mockReset();
  mocks.toast.mockReset();
  mocks.deletePaths.length = 0;
  mocks.keys = [
    {
      id: 'key-1',
      name: 'TradeSites',
      keyPrefix: 'umami_abcdef',
      createdAt: '2026-09-01T12:00:00.000Z',
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
    },
  ];
});

describe('ApiKeysPage', () => {
  test('lists existing keys by name and prefix without the secret', () => {
    render(<ApiKeysPage />, { route: '/settings/api-keys' });

    expect(screen.getByRole('heading', { name: 'API keys' })).toBeInTheDocument();
    expect(screen.getByText('TradeSites')).toBeInTheDocument();
    expect(screen.getByText(/umami_abcdef/)).toBeInTheDocument();
    expect(screen.getAllByText('Never')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  test('creates a key and shows the plaintext once with a copy control', async () => {
    mocks.createKey.mockImplementation(async (data, options) => {
      const created = {
        id: 'key-2',
        name: data.name,
        keyPrefix: PLAINTEXT_KEY.slice(0, 12),
        createdAt: '2026-09-13T12:00:00.000Z',
        expiresAt: null,
        key: PLAINTEXT_KEY,
      };

      await options?.onSuccess?.(created);

      return created;
    });

    const { user } = render(<ApiKeysPage />, { route: '/settings/api-keys' });

    await user.click(screen.getByRole('button', { name: 'Create API key' }));

    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Name'), 'Integration');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.createKey).toHaveBeenCalledWith({ name: 'Integration' }, expect.anything());
    });

    expect(await within(dialog).findByText(PLAINTEXT_KEY)).toBeInTheDocument();
    expect(within(dialog).getByText(/will not be shown again/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(mocks.touch).toHaveBeenCalledWith('api-keys');

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.queryByText(PLAINTEXT_KEY)).not.toBeInTheDocument();
    });
  });

  test('revokes a key after confirmation', async () => {
    mocks.revokeKey.mockImplementation(async (_data, options) => {
      await options?.onSuccess?.();
    });

    const { user } = render(<ApiKeysPage />, { route: '/settings/api-keys' });

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText(/revoke/)).toBeInTheDocument();
    expect(within(dialog).getByText('TradeSites')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect(mocks.revokeKey).toHaveBeenCalled();
    });

    expect(mocks.deletePaths).toContain('/users/user-1/api-keys/key-1');
    expect(mocks.touch).toHaveBeenCalledWith('api-keys');
  });
});
