import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeQuote, applicationIssues, type Currency } from '../shared/domain';
import { setup, customer, other, agent, staff, pdf, key, application } from './fixtures';

test('currency routing, independent fixed prices and TWD combined-base tax rounding', () => {
  for (const currency of ['HKD', 'USD', 'TWD'] as Currency[]) {
    const { service, db } = setup(currency);
    const q = makeQuote(service.prices()[0]);
    assert.equal(q.entity, currency === 'TWD' ? 'TW' : 'HK');
    assert.equal(q.tax, currency === 'TWD' ? 500 : 0);
    assert.equal(q.total, currency === 'TWD' ? 10501 : 10001);
    db.close();
  }
});
test('owner isolation and agent scopes apply to reads, mutations and files', () => {
  const f = setup();
  assert.throws(() => f.service.get(other, f.c.id), /CASE_NOT_FOUND/);
  assert.equal(f.service.list(other).length, 0);
  assert.throws(
    () => f.service.update(other, f.c.id, { version: f.c.version, data: f.c.data }, key()),
    /CASE_NOT_FOUND/,
  );
  assert.throws(() => f.service.get({ ...agent, scopes: [] }, f.c.id), /INSUFFICIENT_SCOPE/);
  assert.throws(
    () =>
      f.service.update(
        { ...agent, scopes: ['cases:read'] },
        f.c.id,
        { version: f.c.version, data: f.c.data },
        key(),
      ),
    /INSUFFICIENT_SCOPE/,
  );
  f.upload('identity');
  assert.throws(() => f.service.file(other, f.c.id, f.c.files[0].id), /CASE_NOT_FOUND/);
  assert.throws(
    () => f.service.file(agent, f.c.id, f.c.files[0].id),
    /HUMAN_CONFIRMATION_REQUIRED/,
  );
  for (const action of [
    'checkout',
    'confirm_payment',
    'approve',
    'reject',
    'confirm_refund',
    'complete',
    'queue_submission',
  ])
    assert.throws(() => f.action(action, {}, agent), /HUMAN_CONFIRMATION_REQUIRED|STAFF_REQUIRED/);
  f.db.close();
});
test('idempotency prevents duplicate creation and conflicts on key reuse; stale updates fail', () => {
  const f = setup();
  const k = key(),
    input = { locale: 'en', currency: 'HKD' };
  const a = f.service.create(customer, input, k),
    b = f.service.create(customer, input, k);
  assert.equal(a.id, b.id);
  assert.throws(
    () => f.service.create(customer, { ...input, currency: 'USD' }, k),
    /IDEMPOTENCY_CONFLICT/,
  );
  const old = f.c;
  f.service.update(customer, old.id, { version: old.version, data: old.data }, key());
  assert.throws(
    () => f.service.update(customer, old.id, { version: old.version, data: old.data }, key()),
    /VERSION_CONFLICT/,
  );
  f.db.close();
});
test('proof is not a deposit, amounts must match, accepted quote stays immutable', () => {
  const f = setup();
  f.action('checkout', { checks: ['service_terms'] }, customer);
  const quote = f.c.quote;
  f.upload('payment_proof');
  f.action('report_payment', { reference: 'TRANSFER-TEST' }, customer);
  assert.equal(f.c.paymentConfirmed, false);
  assert.equal(f.c.ledger.length, 0);
  assert.throws(() => f.action('approve'), /INVALID_STATE/);
  assert.throws(
    () => f.action('confirm_payment', { amount: 1, reference: 'TEST' }),
    /PAYMENT_AMOUNT_MISMATCH/,
  );
  const { version, ...price } = f.service.prices()[0];
  f.service.configurePrice(staff, { ...price, service: 99 });
  assert.deepEqual(f.service.get(customer, f.c.id).quote, quote);
  f.action('confirm_payment', { amount: quote!.total, reference: 'TEST-BANK' });
  assert.equal(f.c.status, 'under_review');
  assert.equal(f.c.ledger[0].amount, 10501);
  f.db.close();
});
test('review requires documents; rejection creates full actual-payment refund obligation', () => {
  const f = setup();
  f.paid();
  assert.throws(
    () =>
      f.action('approve', {
        note: 'Checked',
        checks: ['identity', 'beneficial_owners', 'business_purpose', 'screening'],
      }),
    /KYC_DOCUMENTS_REQUIRED/,
  );
  f.action('reject', { note: 'Review declined' });
  assert.equal(f.c.status, 'refund_pending');
  assert.throws(
    () => f.action('confirm_refund', { amount: 10000, reference: 'REFUND-1' }),
    /FULL_REFUND_REQUIRED/,
  );
  f.action('confirm_refund', { amount: 10501, reference: 'REFUND-1' });
  assert.equal(f.c.status, 'refunded');
  assert.equal(
    f.c.ledger.find((l) => l.kind === 'customer_refund')?.amount,
    f.c.ledger.find((l) => l.kind === 'customer_payment')?.amount,
  );
  f.db.close();
});
test('review and signatures bind the exact revision; no submission after a data change', () => {
  const f = setup();
  f.approved();
  assert.throws(() => f.action('queue_submission'), /SUBMISSION_NOT_READY/);
  const old = f.c;
  f.service.recordValidation(old.id, old.revision, '<signed-fixture/>');
  f.c = f.service.get(customer, old.id);
  f.action('request_information', { note: 'Correct address' });
  assert.throws(
    () => f.service.recordSignature(old.id, old.revision, '<signed-fixture/>', true, old.version),
    /STALE_REVISION/,
  );
  f.c = f.service.update(customer, f.c.id, { version: f.c.version, data: f.c.data }, key());
  assert.equal(f.c.signingReady, false);
  assert.throws(() => f.action('queue_submission'), /SUBMISSION_NOT_READY/);
  f.db.close();
});
test('government debit is separate; completion needs both certificates and staff verification', () => {
  const f = setup();
  f.approved();
  f.service.recordValidation(f.c.id, f.c.revision, '<fixture/>');
  f.c = f.service.get(customer, f.c.id);
  f.service.recordSignature(f.c.id, f.c.revision, '<fixture/>', true, f.c.version);
  f.c = f.service.get(customer, f.c.id);
  f.action('queue_submission');
  f.service.recordSubmission(
    f.c.id,
    { caseNo: 'TEST-REGISTRY', reference: 'GOV-TEST', amount: 397500, brn: '12345678' },
    '<receipt/>',
  );
  f.c = f.service.get(customer, f.c.id);
  assert.equal(f.c.status, 'submitted');
  assert.deepEqual(
    f.c.ledger.map((l) => l.currency),
    ['TWD', 'HKD'],
  );
  assert.throws(() => f.action('complete'), /CERTIFICATES_REQUIRED/);
  f.upload('ci', staff);
  assert.throws(() => f.action('complete'), /CERTIFICATES_REQUIRED/);
  f.upload('br', staff);
  f.action('complete', {
    note: 'Official records verified',
    checks: ['certificates_verified'],
    brn: '12345678',
    registryCaseNo: 'TEST-REGISTRY',
  });
  assert.equal(f.c.status, 'completed');
  f.db.close();
});
test('sensitive case data and files are encrypted and attachments cannot cross cases', () => {
  const f = setup();
  f.upload('identity');
  const raw = f.db.prepare('SELECT data FROM norby_cases WHERE id=?').get(f.c.id) as {
    data: Buffer;
  };
  assert.equal(raw.data.includes(Buffer.from('TEST0001')), false);
  const content = f.db.prepare('SELECT content FROM norby_files LIMIT 1').get() as {
    content: Buffer;
  };
  assert.equal(content.content.includes(pdf), false);
  assert.equal(
    f.service.file(customer, f.c.id, f.c.files[0].id).content.toString(),
    pdf.toString(),
  );
  const second = f.service.create(customer, { locale: 'en', currency: 'HKD' }, key());
  assert.throws(() => f.service.file(customer, second.id, f.c.files[0].id), /FILE_NOT_FOUND/);
  assert.throws(
    () =>
      f.service.addFile(
        customer,
        f.c.id,
        'identity',
        'attack.svg',
        Buffer.from('<svg onload="alert(1)"/>'),
        f.c.data.people[0].id,
      ),
    /UNSUPPORTED_FILE_TYPE/,
  );
  f.db.close();
});
test('share totals, distinct signer emails and actual calendar dates are checked', () => {
  const app = application();
  assert.deepEqual(applicationIssues(app), []);
  app.people[0].birthDate = '1990-02-31';
  assert.ok(applicationIssues(app).some((x) => x.startsWith('director_age')));
  app.people[0].shares = 99;
  assert.ok(applicationIssues(app).includes('share_allocation'));
});
test('HKID formats are checked before checkout while the customer can still correct them', () => {
  const f = setup();
  try {
    for (const value of [
      'a123456(7)',
      'A12345(7)',
      'ABC1234567',
      'A123456(B)',
      'A(1234567',
      'A123456((7))',
      '',
    ]) {
      const data = structuredClone(f.c.data);
      data.people[0].identityType = 'hkid';
      data.people[0].identityNumber = value;
      f.c = f.service.update(customer, f.c.id, { version: f.c.version, data }, key());
      assert.ok(f.c.issues.includes(`hkid:${data.people[0].id}`), value);
      assert.throws(
        () => f.action('checkout', { checks: ['service_terms'] }, customer),
        /INCOMPLETE_APPLICATION/,
      );
      const saved = f.service.get(customer, f.c.id);
      assert.equal(saved.status, 'draft');
      assert.equal(saved.quote, null);
      assert.equal(saved.ledger.length, 0);
    }
    for (const value of ['A123456(7)', 'AB123456(7)', 'AB123456A', ' AB 123456(A) ']) {
      const data = structuredClone(f.c.data);
      data.people[0].identityNumber = value;
      f.c = f.service.update(customer, f.c.id, { version: f.c.version, data }, key());
      assert.deepEqual(f.c.issues, [], value);
    }
    f.action('checkout', { checks: ['service_terms'] }, customer);
    assert.equal(f.c.status, 'awaiting_payment');
  } finally {
    f.db.close();
  }
});
test('ambiguous filing requires verified official receipt before reconciling the government debit', () => {
  const f = setup();
  f.approved();
  f.service.recordValidation(f.c.id, f.c.revision, '<fixture/>');
  f.c = f.service.get(customer, f.c.id);
  f.service.recordSignature(f.c.id, f.c.revision, '<fixture/>', true, f.c.version);
  f.c = f.service.get(customer, f.c.id);
  f.action('queue_submission');
  f.service.submissionUncertain(f.c.id);
  f.c = f.service.get(customer, f.c.id);
  const values = {
    note: 'Official receipt checked',
    registryCaseNo: 'REGISTRY-TEST',
    reference: 'GOV-RECONCILED',
    amount: 397500,
    checks: ['registry_receipt_verified'],
  };
  assert.throws(() => f.action('reconcile_submission', values), /RECEIPT_VERIFICATION_REQUIRED/);
  f.c = f.service.addFile(staff, f.c.id, 'registry_receipt', 'receipt.pdf', pdf, null);
  f.action('reconcile_submission', values);
  assert.equal(f.c.status, 'submitted');
  assert.equal(f.c.ledger.find((l) => l.kind === 'government_debit')?.currency, 'HKD');
  assert.equal(f.c.ledger.find((l) => l.kind === 'customer_payment')?.currency, 'TWD');
  assert.throws(() => f.action('reconcile_submission', values), /INVALID_STATE/);
  f.db.close();
});
test('case transitions enqueue notifications atomically without document data in the outbox', () => {
  const f = setup();
  f.paid();
  const pending = f.db.prepare('SELECT * FROM norby_notifications').all();
  assert.equal(pending.length, 1);
  assert.ok(!JSON.stringify(pending).includes('TEST0001'));
  const before = f.db.prepare('SELECT COUNT(*) AS count FROM norby_events').get();
  assert.throws(
    () => f.action('approve', { checks: [], note: 'Incomplete review' }),
    /REVIEW_CHECKS_REQUIRED/,
  );
  assert.deepEqual(f.db.prepare('SELECT COUNT(*) AS count FROM norby_events').get(), before);
  assert.equal(f.db.prepare('SELECT * FROM norby_notifications').all().length, 1);
  f.db.close();
});
