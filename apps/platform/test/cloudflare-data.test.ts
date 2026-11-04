import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareCaseService } from '../cloudflare/cases.js';
import { Mutation, statement } from '../cloudflare/storage.js';
import {
  cloudflareSetup,
  createCloudflareBindings,
  customer,
  other,
  agent,
  staff,
  pdf,
  key,
  application,
} from './cloudflare-data-fixtures.js';

test('D1 creation idempotency, owner and OAuth scopes survive concurrent isolates', async (t) => {
  const f = await cloudflareSetup(t);
  const service2 = new CloudflareCaseService(f.db, f.bucket, f.dataKey);
  const input = { locale: 'en', currency: 'TWD' },
    operationKey = key();
  const [a, b] = await Promise.all([
    f.service.create(customer, input, operationKey),
    service2.create(customer, input, operationKey),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(a.events.length, 1);
  await assert.rejects(
    f.service.create(customer, { ...input, currency: 'USD' }, operationKey),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(f.service.get(other, f.c.id), /CASE_NOT_FOUND/);
  assert.deepEqual(await f.service.list(other), []);
  await assert.rejects(f.service.get({ ...agent, scopes: [] }, f.c.id), /INSUFFICIENT_SCOPE/);
  await assert.rejects(
    f.service.update(
      { ...agent, scopes: ['cases:read'] },
      f.c.id,
      { version: f.c.version, data: f.c.data },
      key(),
    ),
    /INSUFFICIENT_SCOPE/,
  );
  await assert.rejects(
    f.service.action(
      agent,
      f.c.id,
      { action: 'checkout', version: f.c.version, checks: ['service_terms'] },
      key(),
    ),
    /HUMAN_CONFIRMATION_REQUIRED/,
  );
  const raw = await statement(f.db, 'SELECT data FROM norby_cases WHERE id=?', f.c.id).first<{
    data: number[];
  }>();
  assert.ok(raw && !Buffer.from(raw.data).includes(Buffer.from('TEST0001')));
});

test('D1 assertion rolls back every write and concurrent mutations retain one ledger/event/outbox', async (t) => {
  const f = await cloudflareSetup(t);
  const before = f.c;
  const tx = new Mutation(f.db);
  tx.caseVersion(before.id, before.version + 99);
  tx.prepare("UPDATE norby_cases SET status='completed' WHERE id=?").run(before.id);
  tx.prepare('INSERT INTO norby_operations VALUES (?,?,?,?)').run(customer.id, key(), 'bad', '{}');
  await assert.rejects(tx.commit(), /VERSION_CONFLICT/);
  assert.equal((await f.service.get(customer, before.id)).status, 'draft');
  assert.equal(
    (await statement(f.db, 'SELECT count(*) AS n FROM norby_transaction_guards').first<{
      n: number;
    }>())!.n,
    0,
  );
  await f.action('checkout', { checks: ['service_terms'] }, customer);
  const input = {
    action: 'confirm_payment',
    version: f.c.version,
    amount: f.c.quote!.total,
    reference: 'CONCURRENT-PAYMENT',
  };
  const otherInstance = new CloudflareCaseService(f.db, f.bucket, f.dataKey);
  const paymentKey = key();
  await Promise.all([
    f.service.action(staff, f.c.id, input, paymentKey),
    otherInstance.action(staff, f.c.id, input, paymentKey),
  ]);
  f.c = await f.service.get(customer, f.c.id);
  assert.equal(f.c.status, 'under_review');
  assert.equal(f.c.ledger.length, 1);
  assert.equal(f.c.events.filter((e) => e.action === 'confirm_payment').length, 1);
  assert.equal(
    (await statement(f.db, 'SELECT count(*) AS n FROM norby_notifications').first<{ n: number }>())!
      .n,
    1,
  );
  await f.action('reject', { note: 'Review declined' });
  await assert.rejects(
    f.action('confirm_refund', { amount: 1, reference: 'REFUND-WRONG' }),
    /FULL_REFUND_REQUIRED/,
  );
  const refundInput = {
    action: 'confirm_refund',
    version: f.c.version,
    amount: f.c.quote!.total,
    reference: 'CONCURRENT-REFUND',
  };
  const refunds = await Promise.allSettled([
    f.service.action(staff, f.c.id, refundInput, key()),
    otherInstance.action(staff, f.c.id, refundInput, key()),
  ]);
  assert.equal(refunds.filter((r) => r.status === 'fulfilled').length, 1);
  assert.match(
    String((refunds.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason),
    /VERSION_CONFLICT/,
  );
  const result = await f.service.get(customer, f.c.id);
  assert.equal(result.status, 'refunded');
  assert.equal(result.ledger.filter((l) => l.kind === 'customer_refund').length, 1);
  assert.equal(result.ledger[0].amount, result.ledger[1].amount);
});

test('accepted price is immutable and ledger references cannot be reused across cases', async (t) => {
  const f = await cloudflareSetup(t);
  await f.action('checkout', { checks: ['service_terms'] }, customer);
  const quote = f.c.quote;
  const { version: _version, ...price } = (await f.service.prices())[0];
  const prices = await Promise.all([
    f.service.configurePrice(staff, { ...price, service: 99 }),
    f.service.configurePrice(staff, { ...price, service: 100 }),
  ]);
  assert.deepEqual(prices.map((p) => p.version).sort(), [2, 3]);
  assert.deepEqual((await f.service.get(customer, f.c.id)).quote, quote);
  await f.action('confirm_payment', { amount: quote!.total, reference: 'ONE-BANK-TRANSFER' });
  let second = await f.service.create(
    customer,
    { locale: 'en', currency: 'TWD', data: application() },
    key(),
  );
  second = await f.service.action(
    customer,
    second.id,
    { action: 'checkout', version: second.version, checks: ['service_terms'] },
    key(),
  );
  const failedKey = key();
  await assert.rejects(
    f.service.action(
      staff,
      second.id,
      {
        action: 'confirm_payment',
        version: second.version,
        amount: second.quote!.total,
        reference: 'ONE-BANK-TRANSFER',
      },
      failedKey,
    ),
    /DUPLICATE_REFERENCE/,
  );
  const unchanged = await f.service.get(customer, second.id);
  assert.equal(unchanged.status, 'awaiting_payment');
  assert.equal(unchanged.paymentConfirmed, false);
  assert.equal(unchanged.ledger.length, 0);
  assert.equal(
    unchanged.events.some((e) => e.action === 'confirm_payment'),
    false,
  );
  assert.equal(
    await statement(
      f.db,
      'SELECT 1 FROM norby_operations WHERE actor_id=? AND key=?',
      staff.id,
      failedKey,
    ).first(),
    null,
  );
});

test('R2 encrypts Chinese filenames and document bytes; ownership and AEAD prevent disclosure', async (t) => {
  const f = await cloudflareSetup(t);
  f.c = await f.service.addFile(
    customer,
    f.c.id,
    'identity',
    '身分證明.pdf',
    pdf,
    f.c.data.people[0].id,
  );
  const file = f.c.files[0];
  assert.equal(file.name, '身分證明.pdf');
  const downloaded = await f.service.file(customer, f.c.id, file.id);
  assert.equal(downloaded.name, '身分證明.pdf');
  assert.deepEqual(downloaded.content, pdf);
  const metadata = await statement(
    f.db,
    'SELECT object_key FROM norby_files WHERE id=?',
    file.id,
  ).first<{ object_key: string }>();
  const encrypted = Buffer.from(await (await f.bucket.get(metadata!.object_key))!.arrayBuffer());
  assert.ok(!encrypted.includes(pdf));
  await assert.rejects(f.service.file(other, f.c.id, file.id), /CASE_NOT_FOUND/);
  await assert.rejects(f.service.file(agent, f.c.id, file.id), /HUMAN_CONFIRMATION_REQUIRED/);
  const wrongKey = new CloudflareCaseService(
    f.db,
    f.bucket,
    Buffer.alloc(32, 7).toString('base64'),
  );
  await assert.rejects(wrongKey.file(customer, f.c.id, file.id));
  encrypted[encrypted.length - 1] ^= 1;
  await f.bucket.put(metadata!.object_key, encrypted);
  await assert.rejects(f.service.file(customer, f.c.id, file.id));
});

test('R2 upload failure and stale case rollback do not expose metadata or leave live objects', async (t) => {
  const f = await cloudflareSetup(t);
  const baseVersion = f.c.version;
  const failingBucket = new Proxy(f.bucket, {
    get(target, property) {
      if (property === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          await target.put(...args);
          throw new Error('R2 response lost');
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const failing = new CloudflareCaseService(f.db, failingBucket, f.dataKey);
  await assert.rejects(
    failing.addFile(customer, f.c.id, 'payment_proof', 'proof.pdf', pdf, null),
    /R2 response lost/,
  );
  assert.equal((await f.service.get(customer, f.c.id)).version, baseVersion);
  assert.equal((await f.bucket.list()).objects.length, 0);
  let changed = false;
  const racingBucket = new Proxy(f.bucket, {
    get(target, property) {
      if (property === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          const result = await target.put(...args);
          if (!changed) {
            changed = true;
            await f.service.update(
              customer,
              f.c.id,
              { version: baseVersion, data: f.c.data },
              key(),
            );
          }
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const racing = new CloudflareCaseService(f.db, racingBucket, f.dataKey);
  await assert.rejects(
    racing.addFile(customer, f.c.id, 'payment_proof', 'proof.pdf', pdf, null),
    /VERSION_CONFLICT/,
  );
  assert.equal((await f.service.get(customer, f.c.id)).files.length, 0);
  assert.equal((await f.bucket.list()).objects.length, 0);
  assert.equal(
    (await statement(
      f.db,
      "SELECT count(*) AS n FROM norby_objects WHERE status='committed'",
    ).first<{ n: number }>())!.n,
    0,
  );
});

test('committed upload survives an ambiguous D1 response and cleanup never deletes it', async (t) => {
  const f = await cloudflareSetup(t);
  let loseNextBatch = false;
  const db = new Proxy(f.db, {
    get(target, property) {
      if (property === 'batch')
        return async (statements: D1PreparedStatement[]) => {
          const result = await target.batch(statements);
          if (loseNextBatch) {
            loseNextBatch = false;
            throw new Error('D1 response lost after commit');
          }
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const bucket = new Proxy(f.bucket, {
    get(target, property) {
      if (property === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          const result = await target.put(...args);
          loseNextBatch = true;
          return result;
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const service = new CloudflareCaseService(db, bucket, f.dataKey);
  const c = await service.addFile(customer, f.c.id, 'payment_proof', '付款證明.pdf', pdf, null);
  assert.equal(c.files.length, 1);
  await service.cleanupOrphanObjects(Date.now() + 10_000_000);
  assert.deepEqual((await service.file(customer, c.id, c.files[0].id)).content, pdf);
  assert.equal((await f.bucket.list()).objects.length, 1);
});

test('durable signing lease permits one signer and fences stale or expired responses', async (t) => {
  const f = await cloudflareSetup(t);
  await f.approved();
  await f.service.recordValidation(f.c.id, f.c.revision, '<validated/>');
  f.c = await f.service.get(customer, f.c.id);
  const second = new CloudflareCaseService(f.db, f.bucket, f.dataKey);
  const tokens = [key(), key()];
  const claims = await Promise.all(
    tokens.map((token, i) =>
      (i ? second : f.service).claimSigning(
        f.c.id,
        customer,
        f.c.version,
        token,
        Date.now() + 60_000,
      ),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = tokens[claims.findIndex(Boolean)],
    loser = tokens[claims.findIndex((v) => !v)];
  await assert.rejects(
    f.service.claimSigning(
      f.c.id,
      { ...other, email: 'other@example.test' },
      f.c.version,
      key(),
      Date.now() + 60_000,
    ),
    /SIGNER_ACCOUNT_REQUIRED/,
  );
  await assert.rejects(
    f.service.recordSignature(f.c.id, f.c.revision, '<wrong/>', true, f.c.version, loser),
    /SIGNING_LEASE_LOST/,
  );
  assert.equal(await f.service.tpsiXml(f.c.id), '<validated/>');
  await statement(
    f.db,
    'UPDATE norby_signing_leases SET expires_at=0 WHERE case_id=?',
    f.c.id,
  ).run();
  const renewed = key();
  assert.equal(
    await second.claimSigning(f.c.id, customer, f.c.version, renewed, Date.now() + 60_000),
    true,
  );
  await f.service.releaseSigning(f.c.id, winner);
  await assert.rejects(
    f.service.recordSignature(f.c.id, f.c.revision, '<stale/>', true, f.c.version, winner),
    /SIGNING_LEASE_LOST/,
  );
  await second.recordSignature(f.c.id, f.c.revision, '<signed/>', true, f.c.version, renewed);
  assert.equal((await f.service.get(customer, f.c.id)).status, 'ready_to_submit');
  assert.equal(await f.service.tpsiXml(f.c.id, true), '<signed/>');
});

test('job claim is atomic, recovery is expiry-only, and expired submissions never requeue', async (t) => {
  const f = await cloudflareSetup(t);
  await f.signed();
  await f.action('queue_submission');
  const [queued] = await f.service.pendingJobs();
  const claims = await Promise.all([
    f.service.claimJob(queued.id),
    new CloudflareCaseService(f.db, f.bucket, f.dataKey).claimJob(queued.id),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  const job = claims.find(Boolean)!;
  assert.equal(await f.service.recoverInterruptedJobs(Date.now()), 0);
  await statement(f.db, 'UPDATE norby_jobs SET lease_expires_at=0 WHERE id=?', job.id).run();
  await assert.rejects(
    f.service.recordSubmission(
      f.c.id,
      { caseNo: 'TEST-CASE', reference: 'TEST-RECEIPT', amount: 10000 },
      '<receipt/>',
      { id: job.id, token: job.lease_token! },
    ),
    /JOB_LEASE_LOST/,
  );
  assert.equal(
    (await f.service.get(customer, f.c.id)).ledger.some((l) => l.kind === 'government_debit'),
    false,
  );
  assert.equal(await f.service.recoverInterruptedJobs(Date.now()), 1);
  f.c = await f.service.get(customer, f.c.id);
  assert.equal(f.c.status, 'verification_required');
  assert.equal((await f.service.job(job.id))!.status, 'failed');
  assert.equal(await f.service.claimJob(job.id), null);
  assert.deepEqual(await f.service.pendingJobs(), []);
  await assert.rejects(f.action('queue_submission'), /SUBMISSION_NOT_READY/);
  assert.equal(await f.service.recoverInterruptedJobs(Date.now()), 0);
});

test('committed government receipt survives lost job acknowledgement and certificates complete delivery', async (t) => {
  const f = await cloudflareSetup(t);
  await f.signed();
  await f.action('queue_submission');
  const job = await f.service.claimJob((await f.service.pendingJobs())[0].id);
  assert.ok(job?.lease_token);
  await f.service.recordSubmission(
    f.c.id,
    { caseNo: 'TEST-REGISTRY', reference: 'GOVERNMENT-RECEIPT', amount: 397500, brn: '12345678' },
    '<receipt/>',
    { id: job.id, token: job.lease_token },
  );
  await statement(f.db, 'UPDATE norby_jobs SET lease_expires_at=0 WHERE id=?', job.id).run();
  await f.service.recoverInterruptedJobs(Date.now());
  f.c = await f.service.get(customer, f.c.id);
  assert.equal(f.c.status, 'submitted');
  assert.deepEqual(
    f.c.ledger.map((l) => l.currency),
    ['TWD', 'HKD'],
  );
  assert.equal(
    f.c.events.some((e) => e.action === 'submission_result_unknown'),
    false,
  );
  await assert.rejects(f.action('complete'), /CERTIFICATES_REQUIRED/);
  await f.upload('ci', staff);
  await f.upload('br', staff);
  await f.action('complete', {
    note: 'Official records verified',
    checks: ['certificates_verified'],
    brn: '12345678',
    registryCaseNo: 'TEST-REGISTRY',
  });
  assert.equal(f.c.status, 'completed');
  assert.equal(f.c.ledger.filter((l) => l.kind === 'government_debit').length, 1);
});

test('expired R2 reservations retain cleanup tombstones for late upload completions', async (t) => {
  const f = await cloudflareSetup(t);
  const objectId = key(),
    objectKey = `cases/${f.c.id}/expired`;
  await statement(
    f.db,
    "INSERT INTO norby_objects (id,case_id,object_key,status,expires_at,created_at) VALUES (?,?,?,'pending',0,?)",
    objectId,
    f.c.id,
    objectKey,
    new Date().toISOString(),
  ).run();
  await f.bucket.put(objectKey, Buffer.from('encrypted orphan'));
  assert.equal(await f.service.cleanupOrphanObjects(), 1);
  assert.equal(await f.bucket.get(objectKey), null);
  assert.equal(
    (await statement(f.db, 'SELECT status FROM norby_objects WHERE id=?', objectId).first<{
      status: string;
    }>())!.status,
    'cleanup',
  );
  // An R2 put may finish after its lost response and the first cleanup attempt.
  await f.bucket.put(objectKey, Buffer.from('late encrypted upload'));
  await statement(f.db, 'UPDATE norby_objects SET expires_at=0 WHERE id=?', objectId).run();
  assert.equal(await f.service.cleanupOrphanObjects(), 1);
  assert.equal(await f.bucket.get(objectKey), null);
});

test('Registry XML uses R2 beyond the D1 row limit and review changes invalidate its revision', async (t) => {
  const f = await cloudflareSetup(t);
  await f.approved();
  const xml = `<fixture>${'x'.repeat(2 * 1024 * 1024 + 100)}</fixture>`;
  await f.service.recordValidation(f.c.id, f.c.revision, xml);
  f.c = await f.service.get(customer, f.c.id);
  assert.equal(await f.service.tpsiXml(f.c.id), xml);
  const pointer = await statement(
    f.db,
    'SELECT validated_xml FROM norby_cases WHERE id=?',
    f.c.id,
  ).first<{ validated_xml: string }>();
  assert.ok(pointer!.validated_xml.startsWith(`cases/${f.c.id}/`));
  const previous = f.c;
  await f.action('request_information', { note: 'Correct address' });
  await assert.rejects(
    f.service.recordSignature(f.c.id, previous.revision, xml, true, previous.version),
    /STALE_REVISION/,
  );
  f.c = await f.service.update(customer, f.c.id, { version: f.c.version, data: f.c.data }, key());
  assert.equal(f.c.signingReady, false);
  await assert.rejects(f.service.tpsiXml(f.c.id), /VALIDATED_DOCUMENT_REQUIRED/);
  assert.deepEqual(await f.service.list(customer), [f.c]);
  assert.deepEqual(await f.service.list(agent), [f.c]);
  assert.deepEqual(await f.service.list(staff), [f.c]);
});

test('D1 foreign keys reject orphan audit rows and roll back preceding writes in the batch', async (t) => {
  const f = await cloudflareSetup(t);
  const tx = new Mutation(f.db);
  tx.prepare("UPDATE norby_cases SET status='completed' WHERE id=?").run(f.c.id);
  tx.prepare('INSERT INTO norby_events VALUES (?,?,?,?,?,?,?,?)').run(
    key(),
    key(),
    staff.id,
    staff.kind,
    null,
    'orphan',
    '',
    new Date().toISOString(),
  );
  await assert.rejects(tx.commit(), /FOREIGN KEY constraint failed/);
  assert.equal((await f.service.get(customer, f.c.id)).status, 'draft');
  assert.equal((await statement(f.db, 'PRAGMA foreign_key_check').all()).results.length, 0);
});

test('encryption envelope remains compatible with the local Node backend', async () => {
  const { randomBytes } = await import('node:crypto');
  const { Vault: LocalVault } = await import('../server/storage.js');
  const { Vault: WorkerVault } = await import('../cloudflare/storage.js');
  const keyBytes = randomBytes(32),
    context = 'case:file:fixture';
  const local = new LocalVault(keyBytes),
    worker = new WorkerVault(keyBytes.toString('base64'));
  const plaintext = Buffer.from('身分證明 Test secret');
  assert.deepEqual(worker.open(local.seal(plaintext, context), context), plaintext);
  assert.deepEqual(local.open(worker.seal(plaintext, context), context), plaintext);
  assert.throws(() => worker.open(local.seal(plaintext, context), 'other-context'));
});

test('uncommitted validation leases requeue but committed validation is never replayed', async (t) => {
  const f = await cloudflareSetup(t);
  await f.approved();
  await f.action('queue_validation', {}, customer);
  const queued = (await f.service.pendingJobs())[0];
  const first = (await f.service.claimJob(queued.id))!;
  await statement(f.db, 'UPDATE norby_jobs SET lease_expires_at=0 WHERE id=?', first.id).run();
  assert.equal(await f.service.recoverInterruptedJobs(), 1);
  assert.equal((await f.service.job(first.id))!.status, 'queued');
  assert.equal((await f.service.job(first.id))!.lease_token, null);
  const second = (await f.service.claimJob(first.id))!;
  assert.notEqual(second.lease_token, first.lease_token);
  await assert.rejects(
    f.service.recordValidation(f.c.id, f.c.revision, '<expired/>', {
      id: first.id,
      token: first.lease_token!,
    }),
    /JOB_LEASE_LOST/,
  );
  await f.service.recordValidation(f.c.id, f.c.revision, '<validated/>', {
    id: second.id,
    token: second.lease_token!,
  });
  assert.ok((await f.service.job(second.id))!.result_committed_at);
  await statement(f.db, 'UPDATE norby_jobs SET lease_expires_at=0 WHERE id=?', second.id).run();
  await f.service.recoverInterruptedJobs();
  assert.equal((await f.service.job(second.id))!.status, 'completed');
  assert.equal(await f.service.claimJob(second.id), null);
  assert.equal(await f.service.tpsiXml(f.c.id), '<validated/>');
  assert.deepEqual(await f.service.pendingJobs(), []);
});
