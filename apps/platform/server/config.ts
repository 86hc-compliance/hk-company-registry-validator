import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) process.loadEnvFile('.env');
export const production = process.env.NODE_ENV === 'production';
const trustProxy = process.env.TRUST_PROXY?.trim() || (production ? 'loopback' : 'false');
const dataDir = resolve(process.env.DATA_DIRECTORY || 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
let developmentSecrets: { auth: string; encryption: string } | undefined;
if (!production) {
  const file = resolve(dataDir, 'development-secrets.json');
  if (!existsSync(file))
    writeFileSync(
      file,
      JSON.stringify({
        auth: randomBytes(48).toString('base64url'),
        encryption: randomBytes(32).toString('base64'),
      }),
      { mode: 0o600, flag: 'wx' },
    );
  developmentSecrets = JSON.parse(readFileSync(file, 'utf8'));
}
export const config = {
  port: Number(process.env.PORT || 3100),
  host: process.env.HOST || '127.0.0.1',
  trustProxy: trustProxy === 'false' ? false : trustProxy,
  emailVerificationRequired: production,
  baseUrl: (process.env.BASE_URL || 'http://localhost:3100').replace(/\/$/, ''),
  database: resolve(dataDir, 'norby.sqlite'),
  secret: process.env.BETTER_AUTH_SECRET || developmentSecrets?.auth || '',
  dataKey: Buffer.from(
    process.env.DATA_ENCRYPTION_KEY || developmentSecrets?.encryption || '',
    'base64',
  ),
  staffEmails: (process.env.NORBY_STAFF_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  smtpUrl: process.env.SMTP_URL || '',
  mailFrom: process.env.MAIL_FROM || '',
  tpsiMode: process.env.TPSI_MODE || 'disabled',
};
if (config.secret.length < 32 || config.dataKey.length !== 32)
  throw new Error('Configure BETTER_AUTH_SECRET and DATA_ENCRYPTION_KEY before starting.');
if (
  production &&
  (!config.baseUrl.startsWith('https://') ||
    !config.smtpUrl ||
    !config.mailFrom ||
    !config.staffEmails.length)
)
  throw new Error(
    'Production requires HTTPS BASE_URL, SMTP_URL, MAIL_FROM and verified NORBY_STAFF_EMAILS.',
  );
if (!['disabled', 'test', 'production'].includes(config.tpsiMode))
  throw new Error('Invalid TPSI_MODE');
if (config.tpsiMode === 'production' && !production)
  throw new Error('Live TPSI requires NODE_ENV=production, HTTPS and verified user accounts.');
