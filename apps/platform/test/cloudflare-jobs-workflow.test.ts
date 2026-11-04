import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { application } from './cloudflare-data-fixtures';

type Status = {
  workflow: { status: string; output?: { jobId: string; result: string; code?: string } };
  jobStatus: string;
  caseStatus: string;
  governmentDebits: number;
};

test('real Workflow duplicate dispatch and restart cannot repeat an ambiguous official submission', async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('./cloudflare-jobs-workflow-fixture.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['cloudflare:*'],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire('/worker.mjs');",
    },
  });
  let tokenRequests = 0,
    submissions = 0;
  const mf = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'norby-workflow-test',
          compatibilityDate: '2026-11-04',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'worker.mjs',
            modules: { 'worker.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } },
          },
          exports: { RegistryJobsWorkflow: { type: 'workflow', name: 'norby-workflow-test-jobs' } },
          env: {
            DB: { type: 'd1', name: 'test-workflow-db' },
            DOCUMENTS: { type: 'r2', name: 'test-workflow-documents' },
            REGISTRY_JOBS: {
              type: 'workflow',
              name: 'norby-workflow-test-jobs',
              worker: 'norby-workflow-test',
              exportName: 'RegistryJobsWorkflow',
            },
            DATA_ENCRYPTION_KEY: { type: 'text', value: randomBytes(32).toString('base64') },
            APP_ENV: { type: 'text', value: 'test' },
            TPSI_MODE: { type: 'text', value: 'test' },
            TPSI_TEST_DATA_ONLY: { type: 'text', value: 'true' },
            TPSI_USER_ID: { type: 'text', value: 'FICTIONAL' },
            TPSI_PASSWORD: { type: 'text', value: 'fixture-password' },
            TPSI_DEPOSIT_ACCOUNT: { type: 'text', value: 'FAKE' },
          },
        },
        dev: {
          outboundService: {
            type: 'fetcher',
            async handler(request) {
              // No network request reaches the Registry: all egress is intercepted here.
              const url = new URL(request.url);
              assert.equal(url.hostname, 'apitest.cr.gov.hk');
              if (url.pathname.endsWith('/oauth/token.do')) {
                tokenRequests++;
                assert.equal(request.method, 'GET');
                return new MiniflareResponse(JSON.stringify({ access_token: 'fictional-token' }), {
                  headers: { 'Content-Type': 'application/json' },
                });
              }
              assert.ok(url.pathname.endsWith('/tpsi/submitFormNnc1'));
              assert.equal(request.method, 'POST');
              submissions++;
              return new MiniflareResponse('Fictional ambiguous upstream failure', { status: 502 });
            },
          },
        },
      },
    ],
  });
  try {
    const db = await mf.getD1Database('DB');
    const sql = await readFile(new URL('../migrations/0001_cases.sql', import.meta.url), 'utf8');
    await db.batch(
      sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => db.prepare(part)),
    );
    const seeded = await mf.dispatchFetch('https://local.test/seed', {
      method: 'POST',
      body: JSON.stringify(application()),
    });
    assert.equal(seeded.status, 200, await seeded.clone().text());
    const { jobId } = (await seeded.json()) as { jobId: string };
    await Promise.all([
      mf.dispatchFetch('https://local.test/dispatch'),
      mf.dispatchFetch('https://local.test/dispatch'),
    ]);
    const status = async () =>
      (await (await mf.dispatchFetch(`https://local.test/status?id=${jobId}`)).json()) as Status;
    const completed = async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const value = await status();
        if (value.workflow.status === 'complete') return value;
        assert.notEqual(value.workflow.status, 'errored');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('Workflow did not finish');
    };
    const first = await completed();
    assert.equal(first.jobStatus, 'failed');
    assert.equal(first.caseStatus, 'verification_required');
    assert.equal(first.governmentDebits, 0);
    assert.equal(tokenRequests, 1);
    assert.equal(submissions, 1);
    assert.deepEqual(first.workflow.output, {
      jobId,
      result: 'failed',
      code: 'REGISTRY_HTTP_ERROR',
    });
    await mf.dispatchFetch(`https://local.test/restart?id=${jobId}`);
    const replay = await completed();
    assert.deepEqual(replay.workflow.output, { jobId, result: 'skipped' });
    assert.equal(replay.caseStatus, 'verification_required');
    assert.equal(submissions, 1);
    assert.equal(tokenRequests, 1);
    assert.equal(JSON.stringify(replay).includes('fixture-password'), false);
  } finally {
    await mf.dispose();
  }
});
