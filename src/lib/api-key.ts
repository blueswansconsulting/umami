import crypto from 'node:crypto';
import { getRandomChars } from '@/lib/generate';

export const API_KEY_PREFIX = 'umami_';
export const API_KEY_TOUCH_INTERVAL_MS = 60_000;

const API_KEY_SECRET_LENGTH = 40;
const API_KEY_DISPLAY_LENGTH = 12;
// 64 symbols divide 2^32 evenly, so the modulo in getRandomChars is unbiased.
const URL_SAFE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';

export function generateApiKey() {
  return `${API_KEY_PREFIX}${getRandomChars(API_KEY_SECRET_LENGTH, URL_SAFE_CHARS)}`;
}

export function hashApiKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function getApiKeyPrefix(key: string) {
  return key.slice(0, API_KEY_DISPLAY_LENGTH);
}

export function isApiKeyActive(
  { revokedAt, expiresAt }: { revokedAt: Date | null; expiresAt: Date | null },
  now = new Date(),
) {
  return !revokedAt && (!expiresAt || expiresAt > now);
}

export function shouldTouchApiKey({ lastUsedAt }: { lastUsedAt: Date | null }, now = new Date()) {
  return !lastUsedAt || now.getTime() - lastUsedAt.getTime() >= API_KEY_TOUCH_INTERVAL_MS;
}
