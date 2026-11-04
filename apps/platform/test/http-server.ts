import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function startHttpServer(env: Record<string, string> = {}) {
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  const port = (reserve.address() as { port: number }).port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const directory = mkdtempSync(join(tmpdir(), 'norby-http-regression-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      BASE_URL: base,
      DATA_DIRECTORY: directory,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NORBY_STAFF_EMAILS: 'ops@example.test',
      SMTP_URL: '',
      MAIL_FROM: '',
      TPSI_MODE: 'disabled',
      TPSI_TEST_DATA_ONLY: 'true',
      TPSI_USER_ID: '',
      TPSI_PASSWORD: '',
      TPSI_DEPOSIT_ACCOUNT: '',
      TRUST_PROXY: '',
      ...env,
    },
    stdio: 'pipe',
  });
  let logs = '';
  child.stdout.on('data', (value) => {
    logs += value.toString();
  });
  child.stderr.on('data', (value) => {
    logs += value.toString();
  });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGTERM');
      await exited;
    }
    rmSync(directory, { recursive: true, force: true });
  };
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { base, close };
    } catch {}
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await close();
  throw new Error(`HTTP server did not start: ${logs}`);
}
