import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config';

export const worker = defineWorker(({ mode }) => {
  const production = mode === 'production';
  const name = production ? 'norby-platform' : 'norby-platform-staging';
  return {
    name,
    entrypoint: './cloudflare/index.ts',
    compatibilityDate: '2026-11-04',
    compatibilityFlags: ['nodejs_compat'],
    workersDev: !production,
    previewUrls: false,
    domains: production ? ['norby.tw', 'www.norby.tw'] : [],
    assets: { notFoundHandling: 'single-page-application', runWorkerFirst: true },
    env: {
      DB: bindings.d1({
        name: `${name}-db`,
        ...(production ? { id: '9e9e5438-7f38-4157-b2a6-414736d9e972' } : {}),
      }),
      DOCUMENTS: bindings.r2({ name: `${name}-documents` }),
      ASSETS: bindings.assets(),
      REGISTRY_JOBS: bindings.workflow({
        name: `${name}-registry-jobs`,
        worker: name,
        exportName: 'RegistryJobsWorkflow',
      }),
      EMAIL: bindings.sendEmail({ allowedSenderAddresses: ['noreply@norby.tw'] }),
      APP_ENV: bindings.text<string>(
        production ? 'production' : mode === 'test' ? 'test' : 'development',
      ),
      BASE_URL: bindings.text<string>(
        production ? 'https://www.norby.tw' : 'http://localhost:8787',
      ),
      BETTER_AUTH_SECRET: bindings.secret(),
      DATA_ENCRYPTION_KEY: bindings.secret(),
      NORBY_STAFF_EMAILS: bindings.secret(),
      MAIL_FROM: bindings.text<string>('Norby <noreply@norby.tw>'),
      TPSI_MODE: bindings.text<string>('disabled'),
      TPSI_USER_ID: bindings.text<string>(''),
      TPSI_DEPOSIT_ACCOUNT: bindings.text<string>(''),
      TPSI_TEST_DATA_ONLY: bindings.text<string>('false'),
      TPSI_PASSWORD: process.env.NORBY_ENABLE_TPSI === '1' ? bindings.secret() : undefined,
    },
    exports: {
      RegistryJobsWorkflow: exports.workflow({
        name: `${name}-registry-jobs`,
        concurrency: { limit: 5 },
      }),
    },
    triggers: production ? [triggers.scheduled({ schedule: '* * * * *' })] : [],
    limits: { cpuMs: 30_000 },
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 0.1 },
    },
  };
});

export default defineConfig({ accountId: '8ce005e499815aa5f2235b62dbf1c5ce', worker });
