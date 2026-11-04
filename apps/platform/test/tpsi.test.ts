import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { SignedXml } from 'xml-crypto';
import {
  buildNnc1,
  parseReceipt,
  parseStatus,
  parseSoap,
  processJob,
  signRegistryXml,
  verifyRegistrySignature,
  nextSigner,
  signingReview,
  TpsiClient,
} from '../server/tpsi';
import { application, setup, customer } from './fixtures';

const wrap = (content: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cr="http://interfaces.service.webservice.icris3e.cr.gov.hk/"><soap:Body>${content}</soap:Body></soap:Envelope>`;
test('NNC1 mapping escapes user content and requires official accounts and organisation settings', () => {
  const data = application();
  const org = {
    contactUrl: '',
    secretaryName: 'Test Secretary Limited',
    secretaryChineseName: '',
    secretaryBrn: '12345678',
    tcspLicence: 'TEST-ONLY',
    secretaryEmail: 'ops@example.test',
    hkPhone: '12345678',
    office: {
      flat: '1',
      building: 'Test',
      street: '1 Test Road',
      district: 'CENTRAL',
      country: 'HKG',
    },
  };
  data.englishName = 'A & B <TEST> Limited';
  const xml = buildNnc1(data, org, new Date('2026-11-04T00:00:00Z'));
  assert.ok(xml.includes('A &amp; B &lt;TEST&gt; Limited'));
  assert.ok(xml.includes('<cr:signatoryDate>04/11/2026</cr:signatoryDate>'));
  assert.ok(xml.includes('<cr:amt>100</cr:amt>'));
  data.people[0].identityType = 'hkid';
  for (const number of ['A123456(7)', 'A1234567', ' A 123456(7) ']) {
    data.people[0].identityNumber = number;
    const hkidXml = buildNnc1(data, org);
    assert.ok(hkidXml.includes('<cr:hkid>A123456</cr:hkid>'));
    assert.ok(hkidXml.includes('<cr:hkidChkDtg>7</cr:hkidChkDtg>'));
  }
  for (const number of ['a123456(7)', 'A12345(7)', 'A(1234567']) {
    data.people[0].identityNumber = number;
    assert.throws(() => buildNnc1(data, org), /INCOMPLETE_APPLICATION/);
  }
  data.people[0].identityNumber = 'AB123456(A)';
  const hkidXml = buildNnc1(data, org);
  assert.ok(hkidXml.includes('<cr:hkid>AB123456</cr:hkid>'));
  assert.ok(hkidXml.includes('<cr:hkidChkDtg>A</cr:hkidChkDtg>'));
  data.people[0].officialUserId = '';
  assert.throws(() => buildNnc1(data, org), /OFFICIAL_ACCOUNTS_REQUIRED/);
});
test('SOAP rejects entities and faults; incomplete receipts and empty status never mean success', () => {
  assert.throws(
    () => parseSoap('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x/>'),
    /INVALID_REGISTRY_RESPONSE/,
  );
  assert.throws(
    () => parseSoap(wrap('<soap:Fault><faultstring>Rejected</faultstring></soap:Fault>')),
    /REGISTRY_REJECTED_REQUEST/,
  );
  assert.throws(
    () =>
      parseReceipt(
        wrap(
          '<cr:submitFormResponse><cr:receipt><cr:caseNo>00001</cr:caseNo></cr:receipt></cr:submitFormResponse>',
        ),
      ),
    /INVALID_REGISTRY_RECEIPT/,
  );
  assert.equal(
    parseStatus(
      wrap('<cr:enquireDocStatusResponse><cr:result/></cr:enquireDocStatusResponse>'),
      '00001',
    ),
    'unknown',
  );
  const r = parseReceipt(
    wrap(
      '<cr:submitFormResponse><cr:receipt><cr:caseNo>00001</cr:caseNo><cr:pymtRefNo>00002</cr:pymtRefNo><cr:totalAmount>3975.00</cr:totalAmount><cr:brNo>01234567</cr:brNo></cr:receipt></cr:submitFormResponse>',
    ),
  );
  assert.deepEqual(r, { caseNo: '00001', reference: '00002', amount: 397500, brn: '01234567' });
});
test('submission timeout is preserved for reconciliation and never automatically retried', async () => {
  const f = setup();
  f.approved();
  f.service.recordValidation(f.c.id, f.c.revision, '<fixture/>');
  f.c = f.service.get(customer, f.c.id);
  f.service.recordSignature(f.c.id, f.c.revision, '<fixture/>', true, f.c.version);
  f.c = f.service.get(customer, f.c.id);
  f.action('queue_submission');
  const job = f.service.nextJob()!;
  let calls = 0;
  await processJob(f.service, job, {
    submit: async () => {
      calls++;
      throw new Error('timeout');
    },
  } as unknown as TpsiClient);
  f.c = f.service.get(customer, f.c.id);
  assert.equal(f.c.status, 'verification_required');
  assert.equal(calls, 1);
  assert.equal(f.service.nextJob(), undefined);
  assert.equal(f.c.ledger.length, 1);
  assert.throws(() => f.action('queue_submission'), /SUBMISSION_NOT_READY/);
  assert.throws(() => f.action('reject', { note: 'No automatic refund' }), /INVALID_STATE/);
  f.db.close();
});
test('interrupted in-flight submissions are not requeued after restart', () => {
  const f = setup();
  f.approved();
  f.service.recordValidation(f.c.id, f.c.revision, '<fixture/>');
  f.c = f.service.get(customer, f.c.id);
  f.service.recordSignature(f.c.id, f.c.revision, '<fixture/>', true, f.c.version);
  f.c = f.service.get(customer, f.c.id);
  f.action('queue_submission');
  f.service.nextJob();
  f.service.recoverInterruptedJobs();
  assert.equal(f.service.get(customer, f.c.id).status, 'verification_required');
  assert.equal(f.service.nextJob(), undefined);
  f.db.close();
});
test('TPSI uses GET authentication and a bounded, single SOAP POST without automatic retry', async () => {
  const seen: { url: string; options: RequestInit }[] = [];
  const fetcher = async (url: any, options: any) => {
    seen.push({ url: String(url), options });
    return seen.length === 1
      ? Response.json({ access_token: 'fixture-token' })
      : new Response(
          wrap('<cr:enquireDocStatusResponse><cr:result/></cr:enquireDocStatusResponse>'),
        );
  };
  const client = new TpsiClient({
    mode: 'test',
    user: 'FAKE',
    password: 'fixture-only',
    deposit: 'FAKE',
    fetch: fetcher as typeof fetch,
  });
  await client.status('0001', '00000001');
  assert.equal(seen[0].options.method, 'GET');
  assert.match(seen[0].url, /apitest\.cr\.gov\.hk/);
  assert.equal(seen[1].options.method, 'POST');
  assert.equal(seen[1].options.redirect, 'error');
  assert.ok(seen[1].options.signal);
  assert.ok(!String(seen[1].options.body).includes('fixture-only'));
});
test('Registry signatures detect tampering and PIN signatures follow director-before-founder order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'norby-crypto-test-'));
  try {
    const key = join(directory, 'key.pem'),
      cert = join(directory, 'cert.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=Fictional Test Registry',
      ],
      { stdio: 'ignore' },
    );
    const privateKey = readFileSync(key),
      publicCert = readFileSync(cert);
    const data = application();
    const xml = `<cr:submission xmlns:cr="http://interfaces.service.webservice.icris3e.cr.gov.hk/" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><cr:EForm id="eForm"><cr:formModel id="formData"><cr:indDir id="S1"><cr:name>TEST ALICE</cr:name></cr:indDir></cr:formModel><cr:formDataSignatures/></cr:EForm><cr:EFormSignatures></cr:EFormSignatures></cr:submission>`;
    const sign = new SignedXml({
      privateKey,
      publicCert,
      canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    });
    sign.addReference({
      xpath: "//*[@id='formData']",
      transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    sign.computeSignature(xml, {
      prefix: 'ds',
      attrs: { id: 'CR' },
      location: { reference: "//*[local-name()='EFormSignatures']", action: 'append' },
    });
    const signed = sign.getSignedXml();
    assert.ok(verifyRegistrySignature(signed));
    assert.throws(() => verifyRegistrySignature(signed.replace('TEST ALICE', 'OTHER PERSON')));
    const f = setup();
    f.c = { ...f.c, data };
    assert.equal(nextSigner(f.c, signed)?.uri, 'S1');
    const consent = signRegistryXml(signed, 'FAKEUSER', 'fixture-password', 'S1');
    const review = signingReview(consent, 'FormSigner');
    assert.ok(review.some((r) => r.value === 'TEST ALICE'));
    assert.ok(
      review.every(
        (r) =>
          !['UserCredentialHash', 'UserSignature', 'EncryptionKey', 'SignatureValue'].includes(
            r.key,
          ),
      ),
    );
    assert.equal(nextSigner(f.c, consent)?.uri, 'FormSigner');
    assert.ok(!consent.includes('fixture-password'));
    assert.throws(
      () => signRegistryXml(consent, 'FAKEUSER', 'fixture-password', 'S1'),
      /SIGNATURE_ALREADY_PRESENT/,
    );
    const complete = signRegistryXml(consent, 'FAKEUSER', 'fixture-password', 'FormSigner');
    assert.equal(nextSigner(f.c, complete), null);
    f.db.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
