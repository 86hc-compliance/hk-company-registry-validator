import { createHash } from 'node:crypto';
import { APIError, createAuthMiddleware } from 'better-auth/api';

/** Explicitly retain Better Auth 1.7's SHA-256/base64url token storage format. */
export const oauthTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('base64url');

type RevokedRefresh = { createdAt: string | number | Date; revoked_at: number };
export function refreshRevocationGuard(
  lookup: (hash: string) => Promise<RevokedRefresh | null | undefined>,
) {
  return createAuthMiddleware(async (context) => {
    if (
      context.path !== '/oauth2/token' ||
      context.body?.grant_type !== 'refresh_token' ||
      typeof context.body.refresh_token !== 'string'
    )
      return;
    const token = await lookup(oauthTokenHash(context.body.refresh_token));
    if (!token) return;
    const issuedAt = new Date(token.createdAt).getTime();
    // A concurrent rotation may have claimed the old row before revocation and
    // inserted its replacement after our deletion batch. The provider captures the
    // rotation issue time before that claim, so the replacement remains fenced even if the customer subsequently grants fresh consent.
    if (!Number.isFinite(issuedAt) || issuedAt <= token.revoked_at)
      throw new APIError('BAD_REQUEST', {
        error: 'invalid_grant',
        error_description: 'refresh token revoked',
      });
  });
}
