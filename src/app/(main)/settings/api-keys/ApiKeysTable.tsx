import {
  AlertDialog,
  Button,
  Code,
  DataColumn,
  DataTable,
  Icon,
  Modal,
  Text,
} from '@umami/react-zen';
import { useState } from 'react';
import { ControlledDialog } from '@/components/common/ControlledDialog';
import { DateDistance } from '@/components/common/DateDistance';
import { useDeleteQuery, useMessages } from '@/components/hooks';
import { Trash } from '@/components/icons';

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

export function ApiKeysTable({ data = [], userId }: { data?: ApiKeyRow[]; userId: string }) {
  const { t, labels } = useMessages();
  const [revokeKey, setRevokeKey] = useState<ApiKeyRow | null>(null);

  return (
    <>
      <DataTable data={data}>
        <DataColumn id="name" label={t(labels.name)} width="2fr" />
        <DataColumn id="key" label={t(labels.apiKey)}>
          {(row: ApiKeyRow) => <Code>{`${row.keyPrefix}…`}</Code>}
        </DataColumn>
        <DataColumn id="created" label={t(labels.created)}>
          {(row: ApiKeyRow) => <DateDistance date={new Date(row.createdAt)} />}
        </DataColumn>
        <DataColumn id="expires" label={t(labels.expires)}>
          {(row: ApiKeyRow) => <ExpiryCell expiresAt={row.expiresAt} />}
        </DataColumn>
        <DataColumn id="lastUsed" label={t(labels.lastUsed)}>
          {(row: ApiKeyRow) =>
            row.lastUsedAt ? <DateDistance date={new Date(row.lastUsedAt)} /> : t(labels.never)
          }
        </DataColumn>
        <DataColumn id="action" align="end" width="100px">
          {(row: ApiKeyRow) => (
            <Button variant="quiet" aria-label={t(labels.revoke)} onPress={() => setRevokeKey(row)}>
              <Icon>
                <Trash />
              </Icon>
            </Button>
          )}
        </DataColumn>
      </DataTable>
      <ControlledDialog>
        <Modal isOpen={!!revokeKey} onOpenChange={isOpen => !isOpen && setRevokeKey(null)}>
          {revokeKey && (
            <ApiKeyRevokeDialog
              apiKey={revokeKey}
              userId={userId}
              onClose={() => setRevokeKey(null)}
            />
          )}
        </Modal>
      </ControlledDialog>
    </>
  );
}

function ExpiryCell({ expiresAt }: { expiresAt: string | null }) {
  const { t, labels } = useMessages();

  if (!expiresAt) {
    return t(labels.never);
  }

  const date = new Date(expiresAt);

  return date <= new Date() ? (
    <Text color="muted">{t(labels.expired)}</Text>
  ) : (
    <DateDistance date={date} />
  );
}

function ApiKeyRevokeDialog({
  apiKey,
  userId,
  onClose,
}: {
  apiKey: ApiKeyRow;
  userId: string;
  onClose: () => void;
}) {
  const { t, labels, messages } = useMessages();
  const { mutateAsync, touch } = useDeleteQuery(`/users/${userId}/api-keys/${apiKey.id}`);

  const handleConfirm = async () => {
    await mutateAsync(null, {
      onSuccess: () => {
        touch('api-keys');
        onClose();
      },
    });
  };

  return (
    <AlertDialog
      title={t(labels.revoke)}
      onConfirm={handleConfirm}
      onCancel={onClose}
      confirmLabel={t(labels.revoke)}
      isDanger
    >
      <Text>
        {t.rich(messages.confirmRevoke, {
          target: apiKey.name,
          b: chunks => <b>{chunks}</b>,
        })}
      </Text>
    </AlertDialog>
  );
}
