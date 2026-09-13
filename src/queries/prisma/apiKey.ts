import type { Prisma } from '@/generated/prisma/client';
import { API_KEY_TOUCH_INTERVAL_MS } from '@/lib/api-key';
import prisma from '@/lib/prisma';
import type { QueryFilters } from '@/lib/types';

const API_KEY_FIELDS = {
  id: true,
  name: true,
  keyPrefix: true,
  createdAt: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
} satisfies Prisma.ApiKeySelect;

export async function getApiKey(keyId: string) {
  return prisma.client.apiKey.findUnique({
    where: { id: keyId },
    select: { ...API_KEY_FIELDS, userId: true },
  });
}

export async function getApiKeyByHash(keyHash: string) {
  return prisma.client.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
  });
}

export async function getUserApiKeys(userId: string, filters?: QueryFilters) {
  return prisma.pagedQuery(
    'apiKey',
    {
      where: { userId, revokedAt: null },
      select: API_KEY_FIELDS,
      orderBy: { createdAt: 'desc' },
    },
    filters,
  );
}

export async function createApiKey(data: {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  expiresAt?: Date;
}) {
  return prisma.client.apiKey.create({
    data,
    select: API_KEY_FIELDS,
  });
}

export async function touchApiKey(keyId: string, now = new Date()) {
  return prisma.client.apiKey.updateMany({
    where: {
      id: keyId,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lte: new Date(now.getTime() - API_KEY_TOUCH_INTERVAL_MS) } },
      ],
    },
    data: { lastUsedAt: now },
  });
}

export async function updateApiKey(keyId: string, data: Prisma.ApiKeyUpdateInput) {
  return prisma.client.apiKey.update({
    where: { id: keyId },
    data,
    select: API_KEY_FIELDS,
  });
}
