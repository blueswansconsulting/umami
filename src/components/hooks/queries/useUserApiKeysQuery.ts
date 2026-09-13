import { useApi } from '../useApi';
import { useModified } from '../useModified';
import { usePagedQuery } from '../usePagedQuery';

export function useUserApiKeysQuery(userId: string) {
  const { get } = useApi();
  const { modified } = useModified('api-keys');

  return usePagedQuery({
    queryKey: ['api-keys', { userId, modified }],
    queryFn: params => {
      return get(`/users/${userId}/api-keys`, params);
    },
    enabled: !!userId,
  });
}
