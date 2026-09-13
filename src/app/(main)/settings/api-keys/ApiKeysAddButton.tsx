import { Button, Dialog, DialogTrigger, Icon, Modal, Text } from '@umami/react-zen';
import { useMessages } from '@/components/hooks';
import { Plus } from '@/components/icons';
import { ApiKeyAddForm } from './ApiKeyAddForm';

export function ApiKeysAddButton({ userId }: { userId: string }) {
  const { t, labels } = useMessages();

  return (
    <DialogTrigger>
      <Button variant="primary">
        <Icon>
          <Plus />
        </Icon>
        <Text>{t(labels.createApiKey)}</Text>
      </Button>
      <Modal>
        <Dialog title={t(labels.createApiKey)} style={{ width: 480 }}>
          {({ close }) => <ApiKeyAddForm userId={userId} onClose={close} />}
        </Dialog>
      </Modal>
    </DialogTrigger>
  );
}
