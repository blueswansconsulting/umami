import { parseRequest } from '@/lib/request';
import { notFound, ok, unauthorized } from '@/lib/response';
import { canManageApiKeys } from '@/permissions';
import { getApiKey, updateApiKey } from '@/queries/prisma';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string; keyId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { userId, keyId } = await params;

  if (!(await canManageApiKeys(auth, userId))) {
    return unauthorized();
  }

  const apiKey = await getApiKey(keyId);

  if (!apiKey || apiKey.userId !== userId) {
    return notFound();
  }

  if (!apiKey.revokedAt) {
    await updateApiKey(keyId, { revokedAt: new Date() });
  }

  return ok();
}
