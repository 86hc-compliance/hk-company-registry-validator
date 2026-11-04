import { randomBytes, randomUUID } from 'node:crypto';
import { openDatabase, Vault } from '../server/storage';
import { CaseService } from '../server/cases';
import { applicationSchema, type Actor, type Currency, type CaseView } from '../shared/domain';

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
export function setup(currency: Currency = 'TWD') {
  const db = openDatabase(':memory:');
  const service = new CaseService(db, new Vault(randomBytes(32)));
  service.configurePrice(staff, {
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
  let c = service.create(customer, { locale: 'zh-Hant', currency, data: application() }, key());
  const action = (name: string, values: Record<string, unknown> = {}, who = staff) => {
    c = service.action(who, c.id, { action: name, version: c.version, ...values }, key());
    return c;
  };
  const upload = (kind: 'identity' | 'address' | 'payment_proof' | 'ci' | 'br', who = customer) => {
    c = service.addFile(
      who,
      c.id,
      kind,
      `${kind}.pdf`,
      pdf,
      ['identity', 'address'].includes(kind) ? c.data.people[0].id : null,
    );
    return c;
  };
  const paid = () => {
    action('checkout', { checks: ['service_terms'] }, customer);
    upload('payment_proof');
    action('report_payment', { reference: 'TRANSFER-TEST' }, customer);
    action('confirm_payment', { amount: c.quote!.total, reference: 'DEPOSIT-TEST' });
    return c;
  };
  const approved = () => {
    paid();
    upload('identity');
    upload('address');
    action('approve', {
      note: 'Test review evidence',
      checks: ['identity', 'beneficial_owners', 'business_purpose', 'screening'],
    });
    return c;
  };
  return {
    db,
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
  };
}
