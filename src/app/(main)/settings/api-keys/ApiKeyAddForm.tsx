import {
  Button,
  Code,
  Column,
  Form,
  FormButtons,
  FormField,
  FormSubmitButton,
  ListItem,
  Row,
  Select,
  Text,
  TextField,
} from '@umami/react-zen';
import { addDays } from 'date-fns';
import { useState } from 'react';
import { CopyButton } from '@/components/common/CopyButton';
import { useMessages, useUpdateQuery } from '@/components/hooks';

const NEVER = 'never';
const EXPIRY_DAYS = [30, 90, 365];

export function ApiKeyAddForm({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { t, labels, messages, getErrorMessage } = useMessages();
  const { mutateAsync, error, isPending, touch } = useUpdateQuery(`/users/${userId}/api-keys`);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const handleSubmit = async ({ name, expiresIn }: { name: string; expiresIn: string }) => {
    const expiresAt =
      expiresIn && expiresIn !== NEVER
        ? addDays(new Date(), Number(expiresIn)).toISOString()
        : undefined;

    await mutateAsync(
      { name, ...(expiresAt && { expiresAt }) },
      {
        onSuccess: data => {
          touch('api-keys');
          setCreatedKey(data.key);
        },
      },
    );
  };

  if (createdKey) {
    return (
      <Column gap="4">
        <Text>{t(messages.apiKeyCreated)}</Text>
        <Row alignItems="center" gap="2">
          <Code style={{ wordBreak: 'break-all' }}>{createdKey}</Code>
          <CopyButton value={createdKey} label={t(labels.copy)} />
        </Row>
        <FormButtons>
          <Button variant="primary" onPress={onClose}>
            {t(labels.done)}
          </Button>
        </FormButtons>
      </Column>
    );
  }

  return (
    <Form
      onSubmit={handleSubmit}
      error={getErrorMessage(error)}
      defaultValues={{ name: '', expiresIn: NEVER }}
    >
      <FormField name="name" label={t(labels.name)} rules={{ required: t(labels.required) }}>
        <TextField autoComplete="off" />
      </FormField>
      <FormField name="expiresIn" label={t(labels.expires)}>
        <Select>
          <ListItem id={NEVER}>{t(labels.never)}</ListItem>
          {EXPIRY_DAYS.map(days => (
            <ListItem key={days} id={String(days)}>
              {t(labels.days, { x: days })}
            </ListItem>
          ))}
        </Select>
      </FormField>
      <FormButtons>
        <Button isDisabled={isPending} onPress={onClose}>
          {t(labels.cancel)}
        </Button>
        <FormSubmitButton variant="primary" isDisabled={isPending}>
          {t(labels.save)}
        </FormSubmitButton>
      </FormButtons>
    </Form>
  );
}
