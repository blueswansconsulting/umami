import type { Auth } from '@/lib/types';

export async function canCreateUser({ user }: Auth) {
  return user?.isAdmin ?? false;
}

export async function canViewUser({ user }: Auth, viewedUserId: string) {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  return user.id === viewedUserId;
}

export async function canViewUsers({ user }: Auth) {
  return user?.isAdmin ?? false;
}

export async function canUpdateUser({ user }: Auth, viewedUserId: string) {
  if (!user) {
    return false;
  }

  if (user.isAdmin) {
    return true;
  }

  return user.id === viewedUserId;
}

export async function canManageApiKeys({ user, token }: Auth, ownerId: string) {
  // Keys are managed from a login session only, so a leaked key cannot mint replacements for itself.
  return !!token && canUpdateUser({ user }, ownerId);
}

export async function canDeleteUser({ user }: Auth) {
  return user?.isAdmin ?? false;
}

export async function canEnforceTwoFactorAuthForEveryone({ user }: Auth) {
  return user?.isAdmin ?? false;
}

export async function canEnforceTwoFactorAuthForUser({ user }: Auth) {
  return user?.isAdmin ?? false;
}
