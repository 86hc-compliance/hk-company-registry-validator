import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

let bundle: Promise<string> | undefined;
function workerBundle() {
  return (bundle ??= (async () => {
    const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
    const result = await build({
      entryPoints: ['cloudflare/index.ts'],
      write: false,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      conditions: ['workerd', 'worker', 'browser'],
      target: 'es2022',
      external: ['node:*', 'cloudflare:*'],
      banner: {
        js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire('/index.mjs');",
      },
      plugins: [
        {
          name: 'node-builtins',
          setup(builder) {
            builder.onResolve({ filter: /^[a-z]/ }, ({ path }) =>
              builtins.has(path) ? { path: `node:${path}`, external: true } : undefined,
            );
          },
        },
      ],
    });
    return result.outputFiles[0].text;
  })());
}

export async function createHttpWorker(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'norby-worker-http-'));
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><title>Norby test SPA</title><div id="root"></div>',
  );
  const vars = {
    APP_ENV: 'test',
    BASE_URL: 'http://localhost:3000',
    TPSI_MODE: 'disabled',
    BETTER_AUTH_SECRET: 'test-secret-not-for-production-test-secret-123',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    NORBY_STAFF_EMAILS: 'ops@example.test',
    MAIL_FROM: 'Norby <noreply@example.test>',
    ...overrides,
  };
  const mf = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'norby-http-test',
          compatibilityDate: '2026-11-04',
          manifest: {
            mainModule: 'index.mjs',
            modules: { 'index.mjs': { type: 'esm', contents: await workerBundle() } },
          },
          assets: { directory, hasUserWorker: true, runWorkerFirst: true },
          env: {
            DB: { type: 'd1', name: 'test-db' },
            DOCUMENTS: { type: 'r2', name: 'test-documents' },
            ASSETS: { type: 'assets' },
            ...Object.fromEntries(
              Object.entries(vars).map(([key, value]) => [key, { type: 'text' as const, value }]),
            ),
          },
        },
      },
    ],
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const name of ['0001_cases.sql', '0002_auth.sql']) {
      const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
      await db.batch(
        sql
          .replace(/^--.*$/gm, '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((statement) => db.prepare(statement)),
      );
    }
    return {
      mf,
      db,
      base: vars.BASE_URL,
      dispose: async () => {
        await mf.dispose();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
