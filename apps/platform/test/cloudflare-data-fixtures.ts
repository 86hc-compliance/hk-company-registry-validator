import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { Miniflare } from 'miniflare';
import { CloudflareCaseService } from '../cloudflare/cases.js';
import {
  applicationSchema,
  type Actor,
  type Currency,
  type CaseView,
  type FileKind,
} from '../shared/domain.js';

export const customer: Actor = { id: 'alice', email: 'alice@example.test', kind: 'customer' };
export const staff: Actor = { id: 'staff', email: 'staff@example.test', kind: 'staff' };
export const other: Actor = { id: 'bob', kind: 'customer' };
export const agent: Actor = {
  id: 'alice',
  kind: 'agent',
  clientId: 'test-agent',
  scopes: ['cases:read', 'cases:write'],
};
export const pdf = Buffer.from('%PDF-1.4\nFictional test document');
export const key = () => randomUUID();
export function application() {
  const id = randomUUID();
  return applicationSchema.parse({
    englishName: 'EXAMPLE TEST LIMITED',
    chineseName: '',
    businessCode: '620',
    businessDescription: 'Software testing',
    sourceOfFunds: 'Test fixture only',
    shareCurrency: 'HKD',
    shareCount: 100,
    shareCapital: '100',
    founderSignerId: id,
    people: [
      {
        id,
        surname: 'TEST',
        givenName: 'ALICE',
        chineseName: '',
        email: 'alice@example.test',
        nationality: 'TWN',
        birthDate: '1990-01-01',
        identityType: 'passport',
        identityNumber: 'TEST0001',
        address: {
          flat: '1',
          building: 'Test',
          street: '1 Example Road',
          district: 'Test city',
          country: 'TWN',
        },
        correspondence: {
          flat: '1',
          building: 'Test',
          street: '1 Example Road',
          district: 'Test city',
          country: 'TWN',
        },
        shares: 100,
        contribution: '100',
        director: true,
        officialUserId: 'FAKEUSER',
      },
    ],
  });
}

/** Real workerd-backed D1 and R2; each instance uses disposable, isolated storage. */
export async function createCloudflareBindings() {
  const mf = new Miniflare({
    cf: false,
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'norby-data-test',
          compatibilityDate: '2026-11-04',
          compatibilityFlags: ['nodejs_compat'],
          manifest: {
            mainModule: 'index.js',
            modulesRoot: '/',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default {fetch(){return new Response("ok")}}',
              },
            },
          },
          env: {
            DB: { type: 'd1', name: 'test-db' },
            DOCUMENTS: { type: 'r2', name: 'test-documents' },
          },
        },
      },
    ],
  });
  try {
    const db = (await mf.getD1Database('DB')) as unknown as D1Database;
    const bucket = (await mf.getR2Bucket('DOCUMENTS')) as unknown as R2Bucket;
    const migration = await readFile(
      new URL('../migrations/0001_cases.sql', import.meta.url),
      'utf8',
    );
    // Each statement is prepared separately: D1 exec treats newlines as statement boundaries.
    const statements = migration
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
    return {
      mf,
      db,
      bucket,
      dataKey: randomBytes(32).toString('base64'),
      dispose: () => mf.dispose(),
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
export async function cloudflareSetup(t: TestContext, currency: Currency = 'TWD') {
  const binding = await createCloudflareBindings();
  t.after(() => binding.dispose());
  const service = new CloudflareCaseService(binding.db, binding.bucket, binding.dataKey);
  await service.configurePrice(staff, {
    currency,
    service: 8001,
    government: 2000,
    bank: {
      company: 'Fictional entity',
      bank: 'Test bank',
      account: 'TEST-ONLY',
      swift: '',
      instructions: '',
    },
  });
  let c = await service.create(
    customer,
    { locale: 'zh-Hant', currency, data: application() },
    key(),
  );
  const action = async (name: string, values: Record<string, unknown> = {}, who = staff) => {
    c = await service.action(who, c.id, { action: name, version: c.version, ...values }, key());
    return c;
  };
  const upload = async (kind: FileKind, who = customer) => {
    c = await service.addFile(
      who,
      c.id,
      kind,
      `${kind}.pdf`,
      pdf,
      ['identity', 'address'].includes(kind) ? c.data.people[0].id : null,
    );
    return c;
  };
  const paid = async () => {
    await action('checkout', { checks: ['service_terms'] }, customer);
    await upload('payment_proof');
    await action('report_payment', { reference: 'TRANSFER-TEST' }, customer);
    await action('confirm_payment', { amount: c.quote!.total, reference: `DEPOSIT-${c.id}` });
    return c;
  };
  const approved = async () => {
    await paid();
    await upload('identity');
    await upload('address');
    await action('approve', {
      note: 'Test review evidence',
      checks: ['identity', 'beneficial_owners', 'business_purpose', 'screening'],
    });
    return c;
  };
  const signed = async () => {
    await approved();
    await service.recordValidation(c.id, c.revision, '<fixture/>');
    c = await service.get(customer, c.id);
    await service.recordSignature(c.id, c.revision, '<signed-fixture/>', true, c.version);
    c = await service.get(customer, c.id);
    return c;
  };
  return {
    ...binding,
    service,
    get c() {
      return c;
    },
    set c(value: CaseView) {
      c = value;
    },
    action,
    upload,
    paid,
    approved,
    signed,
  };
}
