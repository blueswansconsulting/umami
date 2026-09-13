'use client';
import { Column, Text } from '@umami/react-zen';
import { DataGrid } from '@/components/common/DataGrid';
import { PageBody } from '@/components/common/PageBody';
import { PageHeader } from '@/components/common/PageHeader';
import { Panel } from '@/components/common/Panel';
import { useLoginQuery, useMessages, useUserApiKeysQuery } from '@/components/hooks';
import { ApiKeysAddButton } from './ApiKeysAddButton';
import { ApiKeysTable } from './ApiKeysTable';

export function ApiKeysPage() {
  const { t, labels, messages } = useMessages();
  const { user } = useLoginQuery();
  const query = useUserApiKeysQuery(user.id);

  return (
    <PageBody>
      <Column gap="6">
        <PageHeader title={t(labels.apiKeys)}>
          <ApiKeysAddButton userId={user.id} />
        </PageHeader>
        <Panel>
          <Column gap="4">
            <Text color="muted">{t(messages.apiKeysDescription)}</Text>
            <DataGrid query={query}>
              {({ data }) => <ApiKeysTable data={data} userId={user.id} />}
            </DataGrid>
          </Column>
        </Panel>
      </Column>
    </PageBody>
  );
}
