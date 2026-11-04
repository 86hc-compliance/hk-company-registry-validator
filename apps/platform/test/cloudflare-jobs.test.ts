import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processClaimedJob, type RegistryClient } from '../cloudflare/jobs';
import { signCase, TpsiClient, tpsiReady, type TpsiEnvironment } from '../cloudflare/tpsi';
import type { Job, JobLease } from '../cloudflare/cases';
import { setup, customer, agent } from './fixtures';

const env: TpsiEnvironment = {
  APP_ENV: 'test',
  TPSI_MODE: 'test',
  TPSI_TEST_DATA_ONLY: 'true',
  TPSI_USER_ID: 'FICTIONAL',
  TPSI_PASSWORD: 'fixture-password',
  TPSI_DEPOSIT_ACCOUNT: 'FAKE',
};
const wrap = (value: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cr="http://interfaces.service.webservice.icris3e.cr.gov.hk/"><soap:Body>${value}</soap:Body></soap:Envelope>`;
function submissionFixture() {
  const fixture = setup();
  fixture.approved();
  fixture.service.recordValidation(fixture.c.id, fixture.c.revision, '<fixture/>');
  fixture.c = fixture.service.get(customer, fixture.c.id);
  fixture.service.recordSignature(
    fixture.c.id,
    fixture.c.revision,
    '<fixture/>',
    true,
    fixture.c.version,
  );
  fixture.c = fixture.service.get(customer, fixture.c.id);
  fixture.action('queue_submission');
  const queued = fixture.service.nextJob()!;
  const job: Job = {
    ...queued,
    operation: 'submit',
    status: 'running',
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    lease_token: 'fixture-lease',
    lease_expires_at: Date.now() + 60_000,
  };
  const leases: (JobLease | undefined)[] = [];
  const service: Parameters<typeof processClaimedJob>[0] = {
    internalCase: async (id) => fixture.service.internalCase(id),
    organisation: async () => fixture.service.organisation(),
    tpsiXml: async (id, signed) => fixture.service.tpsiXml(id, signed),
    recordValidation: async (id, revision, xml, lease) => {
      leases.push(lease);
      fixture.service.recordValidation(id, revision, xml);
    },
    recordSubmission: async (id, receipt, raw, lease) => {
      leases.push(lease);
      fixture.service.recordSubmission(id, receipt, raw);
    },
    recordStatus: async (id, status, lease) => {
      leases.push(lease);
      fixture.service.recordStatus(id, status);
    },
    submissionUncertain: async (id, lease) => {
      leases.push(lease);
      fixture.service.submissionUncertain(id);
    },
    finishJob: async (id, error, token) => {
      assert.equal(token, job.lease_token);
      fixture.service.finishJob(id, error);
    },
  };
  return { ...fixture, job, service, leases };
}
const unexpected = async (): Promise<never> => {
  throw new Error('Unexpected Registry request');
};

test('Cloudflare submission timeout requires reconciliation with a fenced single attempt', async () => {
  const fixture = submissionFixture();
  try {
    let attempts = 0;
    const client: RegistryClient = {
      validate: unexpected,
      status: unexpected,
      submit: async () => {
        attempts++;
        throw new Error('Network failure with confidential response body');
      },
    };
    const result = await processClaimedJob(fixture.service, fixture.job, client);
    assert.deepEqual(result, {
      jobId: fixture.job.id,
      result: 'failed',
      code: 'REGISTRY_CONNECTION_FAILED',
    });
    assert.equal(attempts, 1);
    assert.equal(
      (await fixture.service.internalCase(fixture.job.case_id)).status,
      'verification_required',
    );
    assert.deepEqual(fixture.leases, [{ id: fixture.job.id, token: fixture.job.lease_token }]);
    assert.deepEqual(
      fixture.db.prepare('SELECT status FROM norby_jobs WHERE id=?').get(fixture.job.id),
      { status: 'failed' },
    );
    assert.equal((await fixture.service.internalCase(fixture.job.case_id)).ledger.length, 1);
  } finally {
    fixture.db.close();
  }
});

test('successful Cloudflare submission records the official receipt and government debit under the claim', async () => {
  const fixture = submissionFixture();
  try {
    const result = await processClaimedJob(fixture.service, fixture.job, {
      validate: unexpected,
      status: unexpected,
      submit: async () =>
        wrap(
          '<cr:submitFormResponse><cr:receipt><cr:caseNo>00001</cr:caseNo><cr:pymtRefNo>00002</cr:pymtRefNo><cr:totalAmount>3975.00</cr:totalAmount><cr:brNo>01234567</cr:brNo></cr:receipt></cr:submitFormResponse>',
        ),
    });
    assert.equal(result.result, 'completed');
    const recorded = await fixture.service.internalCase(fixture.job.case_id);
    assert.equal(recorded.status, 'submitted');
    assert.equal(recorded.registryCaseNo, '00001');
    assert.equal(recorded.ledger.find((row) => row.kind === 'government_debit')?.amount, 397500);
    assert.deepEqual(fixture.leases, [{ id: fixture.job.id, token: fixture.job.lease_token }]);
  } finally {
    fixture.db.close();
  }
});

test('stale revisions and expired claims never reach the Registry', async () => {
  const fixture = submissionFixture();
  try {
    let requests = 0;
    const request = async () => {
      requests++;
      return '';
    };
    const result = await processClaimedJob(
      fixture.service,
      { ...fixture.job, operation: 'validate', revision: fixture.job.revision + 1 },
      { validate: request, submit: request, status: request },
    );
    assert.equal(result.code, 'STALE_REVISION');
    await assert.rejects(
      processClaimedJob(
        fixture.service,
        { ...fixture.job, lease_expires_at: Date.now() - 1 },
        { validate: request, submit: request, status: request },
      ),
      /JOB_LEASE_EXPIRED/,
    );
    assert.equal(requests, 0);
  } finally {
    fixture.db.close();
  }
});

test('TPSI live credentials require the explicit production environment and correct test-data guard', () => {
  assert.equal(tpsiReady(env), true);
  assert.equal(tpsiReady({ ...env, TPSI_TEST_DATA_ONLY: 'false' }), false);
  assert.equal(tpsiReady({ ...env, TPSI_MODE: 'production', TPSI_TEST_DATA_ONLY: 'false' }), false);
  assert.equal(
    tpsiReady({
      ...env,
      APP_ENV: 'production',
      TPSI_MODE: 'production',
      TPSI_TEST_DATA_ONLY: 'false',
    }),
    true,
  );
  assert.equal(tpsiReady({ ...env, APP_ENV: 'production', TPSI_MODE: 'production' }), false);
  assert.equal(tpsiReady({ ...env, TPSI_PASSWORD: '' }), false);
  assert.equal(tpsiReady({ ...env, TPSI_MODE: 'disabled' }), false);
});

test('automation cannot enter the live signing path or acquire a signer lease', async () => {
  let calls = 0;
  const blocked = async (): Promise<never> => {
    calls++;
    throw new Error('Must not touch storage');
  };
  await assert.rejects(
    signCase(
      {
        internalCase: blocked,
        tpsiXml: blocked,
        claimSigning: blocked,
        recordSignature: blocked,
        releaseSigning: blocked,
      },
      'fixture-case',
      agent,
      1,
      'never-store-this',
      env,
    ),
    /HUMAN_CONFIRMATION_REQUIRED/,
  );
  assert.equal(calls, 0);
});

test('TPSI responses have a streaming size bound and a failed request is not retried', async () => {
  let requests = 0;
  const client = new TpsiClient({
    mode: 'test',
    user: 'FICTIONAL',
    password: 'fixture-password',
    deposit: 'FAKE',
    fetch: async () => {
      requests++;
      return requests === 1
        ? Response.json({ access_token: 'test-token' })
        : new Response('x'.repeat(4_000_001));
    },
  });
  await assert.rejects(client.status('00001', '00000001'), /INVALID_REGISTRY_RESPONSE/);
  assert.equal(requests, 2);
});
