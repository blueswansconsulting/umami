import { z } from 'zod';
import { generateApiKey, getApiKeyPrefix, hashApiKey } from '@/lib/api-key';
import { uuid } from '@/lib/crypto';
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { pagingParams } from '@/lib/schema';
import { canManageApiKeys } from '@/permissions';
import { createApiKey, getUserApiKeys } from '@/queries/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const schema = z.object({
    ...pagingParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { userId } = await params;

  if (!(await canManageApiKeys(auth, userId))) {
    return unauthorized();
  }

  return json(await getUserApiKeys(userId, query));
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const schema = z.object({
    name: z.string().trim().min(1).max(100),
    expiresAt: z.coerce
      .date()
      .min(new Date(), { message: 'Expiry must be in the future' })
      .optional(),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { userId } = await params;

  if (!(await canManageApiKeys(auth, userId))) {
    return unauthorized();
  }

  const { name, expiresAt } = body;
  const key = generateApiKey();

  const apiKey = await createApiKey({
    id: uuid(),
    userId,
    name,
    keyHash: hashApiKey(key),
    keyPrefix: getApiKeyPrefix(key),
    expiresAt,
  });

  return json({ ...apiKey, key });
}
