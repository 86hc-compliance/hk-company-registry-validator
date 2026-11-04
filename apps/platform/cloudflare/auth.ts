import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import type { CloudflareEnv } from './env';
import { environment } from './http';
import { sendAuthEmail } from './mail';
import { oauthTokenHash, refreshRevocationGuard } from './http-oauth';

export function createAuth(env: CloudflareEnv) {
  const config = environment(env);
  const scopes = ['openid', 'profile', 'email', 'offline_access', 'cases:read', 'cases:write'];
  return betterAuth({
    appName: 'Norby',
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: config.baseUrl,
    trustedOrigins: [config.baseUrl],
    disabledPaths: ['/token', '/oauth2/delete-consent'],
    hooks: {
      before: refreshRevocationGuard((hash) =>
        env.DB.prepare(
          'SELECT t.createdAt, r.revoked_at FROM oauthRefreshToken t JOIN norby_revocations r ON r.user_id=t.userId AND r.client_id=t.clientId WHERE t.token=?',
        )
          .bind(hash)
          .first<{ createdAt: string; revoked_at: number }>(),
      ),
    },
    // Both the application limiter and Better Auth's stricter login limits persist in D1.
    rateLimit: { enabled: true, storage: 'database' },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'], ipv6Subnet: 56 },
      // The generated schema is checked during migration/testing, not on every isolate request.
      database: { validateSchema: false },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: config.emailVerificationRequired,
      sendResetPassword: async ({ user, url }) =>
        sendAuthEmail(env, { to: user.email, subject: '重設密碼 · Reset your password', url }),
    },
    emailVerification: {
      sendOnSignUp: config.emailVerificationRequired,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        sendAuthEmail(env, { to: user.email, subject: '驗證電子郵件 · Verify your email', url }),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    plugins: [
      jwt(),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: `${config.baseUrl}/mcp`,
        scopes,
        resources: [{ identifier: `${config.baseUrl}/mcp`, allowedScopes: scopes }],
        grantTypes: ['authorization_code', 'refresh_token'],
        accessTokenExpiresIn: 300,
        storeTokens: { hash: oauthTokenHash },
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultApplicationType: 'infer',
        clientPrivileges: ({ user }) =>
          !!user &&
          config.staffEmails.includes(user.email.toLowerCase()) &&
          (!config.emailVerificationRequired || user.emailVerified),
        resourcePrivileges: ({ user }) =>
          !!user &&
          config.staffEmails.includes(user.email.toLowerCase()) &&
          (!config.emailVerificationRequired || user.emailVerified),
      }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
