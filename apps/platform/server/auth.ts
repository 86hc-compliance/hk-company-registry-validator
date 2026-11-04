import { betterAuth } from 'better-auth';
import { jwt } from 'better-auth/plugins';
import { mcp } from '@better-auth/mcp';
import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import { getMigrations } from 'better-auth/db/migration';
import { createTransport } from 'nodemailer';
import type Database from 'better-sqlite3';
import { config } from './config.js';
import { oauthTokenHash, refreshRevocationGuard } from '../cloudflare/http-oauth.js';

export function createAuth(db: Database.Database) {
  const mailer = config.smtpUrl ? createTransport(config.smtpUrl) : null;
  const send = async (to: string, subject: string, url: string) => {
    if (!mailer) throw new Error('MAIL_NOT_CONFIGURED');
    await mailer.sendMail({
      from: config.mailFrom,
      to,
      subject,
      text: `Norby\n\n${subject}\n${url}\n\n如果不是你提出的要求，請忽略此信。 If you did not request this, ignore this email.`,
    });
  };
  return betterAuth({
    appName: 'Norby',
    database: db,
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: [config.baseUrl],
    disabledPaths: ['/token', '/oauth2/delete-consent'],
    hooks: {
      before: refreshRevocationGuard(
        async (hash) =>
          db
            .prepare(
              'SELECT t.createdAt, r.revoked_at FROM oauthRefreshToken t JOIN norby_revocations r ON r.user_id=t.userId AND r.client_id=t.clientId WHERE t.token=?',
            )
            .get(hash) as { createdAt: string; revoked_at: number } | undefined,
      ),
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: config.emailVerificationRequired,
      sendResetPassword: async ({ user, url }) =>
        send(user.email, '重設密碼 · Reset your password', url),
    },
    emailVerification: {
      sendOnSignUp: config.emailVerificationRequired,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, '驗證電子郵件 · Verify your email', url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12 },
    plugins: [
      jwt(),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: `${config.baseUrl}/mcp`,
        scopes: ['openid', 'profile', 'email', 'offline_access', 'cases:read', 'cases:write'],
        resources: [
          {
            identifier: `${config.baseUrl}/mcp`,
            allowedScopes: [
              'openid',
              'profile',
              'email',
              'offline_access',
              'cases:read',
              'cases:write',
            ],
          },
        ],
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
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
    ],
  });
}
export type Auth = ReturnType<typeof createAuth>;
export async function migrateAuth(auth: Auth) {
  const migration = await getMigrations(auth.options);
  await migration.runMigrations();
}
