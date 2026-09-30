import { hashPassword, verifyPassword } from '../auth/password.ts';
import { createResetToken, hashResetToken, signAccessToken } from '../auth/tokens.ts';
import { badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { recordAudit } from '../repositories/audit.repo.ts';
import {
  consumeResetToken, createUser, findUserByEmail, findUserById,
  storeResetToken, toPublicUser, updatePassword, type PublicUser,
} from '../repositories/users.repo.ts';

export interface AuthResult {
  user: PublicUser;
  token: string;
}

export async function register(input: {
  email: string; password: string; firstName: string; lastName: string; ip?: string;
}): Promise<AuthResult> {
  const existing = await findUserByEmail(input.email);
  if (existing) throw conflict('An account with this email already exists', { field: 'email' });

  const passwordHash = await hashPassword(input.password);
  const user = await createUser({
    email: input.email,
    passwordHash,
    firstName: input.firstName,
    lastName: input.lastName,
    role: 'STUDENT', // role is never taken from user input
  });
  await recordAudit({
    userId: user.id, action: 'USER_REGISTERED', resource: 'user',
    resourceId: user.id, ipAddress: input.ip,
  });

  const token = await signAccessToken({ sub: user.id, email: user.email, role: user.role });
  return { user: toPublicUser(user), token };
}

export async function login(input: {
  email: string; password: string; ip?: string;
}): Promise<AuthResult> {
  const user = await findUserByEmail(input.email);

  // Same generic message whether the email is unknown or the password is wrong,
  // so the endpoint cannot be used to enumerate registered accounts.
  const invalid = unauthorized('Email or password is incorrect');
  if (!user) {
    // Still spend the hashing time so timing does not leak account existence.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$0000000000000000000000000000000000000000000',
      input.password,
    );
    throw invalid;
  }

  const ok = await verifyPassword(user.password_hash, input.password);
  if (!ok) {
    await recordAudit({
      userId: user.id, action: 'LOGIN_FAILED', resource: 'user',
      resourceId: user.id, ipAddress: input.ip,
    });
    throw invalid;
  }
  if (!user.is_active) throw unauthorized('This account has been deactivated');

  await recordAudit({
    userId: user.id, action: 'LOGIN_SUCCESS', resource: 'user',
    resourceId: user.id, ipAddress: input.ip,
  });
  const token = await signAccessToken({ sub: user.id, email: user.email, role: user.role });
  return { user: toPublicUser(user), token };
}

export async function me(userId: string): Promise<PublicUser> {
  const user = await findUserById(userId);
  if (!user) throw unauthorized();
  return toPublicUser(user);
}

/**
 * Always reports success, so the endpoint cannot be used to discover which
 * emails are registered. The token is only created when the account exists.
 */
export async function requestPasswordReset(email: string): Promise<{ devToken?: string }> {
  const user = await findUserByEmail(email);
  if (!user) return {};

  const { token, tokenHash } = createResetToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await storeResetToken(user.id, tokenHash, expiresAt);
  await recordAudit({
    userId: user.id, action: 'PASSWORD_RESET_REQUESTED', resource: 'user', resourceId: user.id,
  });

  // No mail transport is configured in this project, so the token is returned
  // only outside production to keep the flow testable end to end.
  return process.env.NODE_ENV === 'production' ? {} : { devToken: token };
}

/**
 * Changes the password of an already signed-in user.
 *
 * The current password is required even though the session is already valid:
 * it stops someone who walks up to an unlocked browser from taking over the
 * account, and it is the standard expectation for this flow.
 */
export async function changePassword(params: {
  userId: string; currentPassword: string; newPassword: string; ip?: string;
}): Promise<void> {
  const user = await findUserById(params.userId);
  if (!user) throw unauthorized();

  if (!(await verifyPassword(user.password_hash, params.currentPassword))) {
    await recordAudit({
      userId: user.id, action: 'PASSWORD_CHANGE_FAILED', resource: 'user',
      resourceId: user.id, ipAddress: params.ip,
    });
    throw badRequest('Cari şifrəniz düzgün deyil', {
      fields: { currentPassword: 'Cari şifrəniz düzgün deyil' },
      field: 'currentPassword',
    });
  }

  if (await verifyPassword(user.password_hash, params.newPassword)) {
    throw badRequest('Yeni şifrə cari şifrədən fərqli olmalıdır', {
      fields: { newPassword: 'Başqa şifrə seçin' }, field: 'newPassword',
    });
  }

  await updatePassword(user.id, await hashPassword(params.newPassword));
  await recordAudit({
    userId: user.id, action: 'PASSWORD_CHANGED', resource: 'user',
    resourceId: user.id, ipAddress: params.ip,
  });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const userId = await consumeResetToken(hashResetToken(token));
  if (!userId) throw unauthorized('This reset link is invalid or has expired');

  await updatePassword(userId, await hashPassword(newPassword));
  await recordAudit({
    userId, action: 'PASSWORD_RESET_COMPLETED', resource: 'user', resourceId: userId,
  });
}
