import { z } from 'zod';

export const currencies = ['HKD', 'USD', 'TWD'] as const;
export type Currency = (typeof currencies)[number];
export const currencySchema = z.enum(currencies);
export const localeSchema = z.enum(['zh-Hant', 'en']);
export type Locale = z.infer<typeof localeSchema>;
const text = (max = 150) => z.string().trim().max(max);
export const addressSchema = z
  .object({
    flat: text(60),
    building: text(60),
    street: text(60),
    district: text(60),
    country: text(4),
  })
  .strict();
export type Address = z.infer<typeof addressSchema>;
export const emptyAddress: Address = {
  flat: '',
  building: '',
  street: '',
  district: '',
  country: '',
};
export const personSchema = z
  .object({
    id: z.string().uuid(),
    surname: text(50),
    givenName: text(110),
    chineseName: text(50),
    email: text(60),
    nationality: text(4),
    birthDate: text(10),
    identityType: z.enum(['passport', 'hkid']),
    identityNumber: text(25),
    address: addressSchema,
    correspondence: addressSchema,
    shares: z.number().int().min(0).max(999999999999),
    contribution: text(16),
    director: z.boolean(),
    officialUserId: text(16),
    passportCountry: text(3).default(''),
    previousEnglishName: text(160).default(''),
    previousChineseName: text(50).default(''),
    aliasEnglishName: text(160).default(''),
    aliasChineseName: text(50).default(''),
  })
  .strict();
export const applicationSchema = z
  .object({
    englishName: text(150),
    chineseName: text(150),
    businessCode: text(20),
    businessDescription: text(500),
    sourceOfFunds: text(1000),
    shareCurrency: text(3),
    shareCount: z.number().int().min(0).max(999999999999),
    shareCapital: text(16),
    founderSignerId: z.string(),
    people: z.array(personSchema).max(50),
  })
  .strict();
export type Application = z.infer<typeof applicationSchema>;
export const emptyApplication: Application = {
  englishName: '',
  chineseName: '',
  businessCode: '',
  businessDescription: '',
  sourceOfFunds: '',
  shareCurrency: 'HKD',
  shareCount: 0,
  shareCapital: '',
  founderSignerId: '',
  people: [],
};
export type Actor = {
  id: string;
  kind: 'customer' | 'staff' | 'agent' | 'system';
  email?: string;
  clientId?: string;
  scopes?: string[];
};
export const statuses = [
  'draft',
  'awaiting_payment',
  'payment_check',
  'under_review',
  'needs_information',
  'awaiting_signatures',
  'ready_to_submit',
  'submitting',
  'submitted',
  'needs_correction',
  'verification_required',
  'completed',
  'refund_pending',
  'refunded',
] as const;
export type CaseStatus = (typeof statuses)[number];
export const statusLabels: Record<CaseStatus, [string, string]> = {
  draft: ['準備資料', 'Preparing information'],
  awaiting_payment: ['待付款', 'Awaiting payment'],
  payment_check: ['待確認入帳', 'Checking payment'],
  under_review: ['Norby 審核中', 'Norby review'],
  needs_information: ['待補件', 'Information requested'],
  awaiting_signatures: ['準備簽署', 'Preparing signatures'],
  ready_to_submit: ['可正式提交', 'Ready to submit'],
  submitting: ['提交處理中', 'Submitting'],
  submitted: ['已提交註冊處', 'Filed with the Registry'],
  needs_correction: ['待補正', 'Correction required'],
  verification_required: ['待 Norby 核對', 'Norby verification required'],
  completed: ['已成立及交付', 'Incorporated & delivered'],
  refund_pending: ['全額退款處理中', 'Full refund in progress'],
  refunded: ['已全額退款', 'Fully refunded'],
};
export type Quote = {
  currency: Currency;
  entity: 'HK' | 'TW';
  service: number;
  government: number;
  tax: number;
  total: number;
  version: number;
  bank: BankDetails;
};
export type BankDetails = {
  company: string;
  bank: string;
  account: string;
  swift: string;
  instructions: string;
};
export type Price = {
  currency: Currency;
  service: number;
  government: number;
  version: number;
  bank: BankDetails;
};
export type FileKind =
  'identity' | 'address' | 'supporting' | 'payment_proof' | 'ci' | 'br' | 'registry_receipt';
export const fileKindSchema = z.enum([
  'identity',
  'address',
  'supporting',
  'payment_proof',
  'ci',
  'br',
  'registry_receipt',
]);
export type CaseFile = {
  id: string;
  kind: FileKind;
  name: string;
  type: string;
  size: number;
  personId: string | null;
  createdAt: string;
};
export type CaseEvent = {
  id: string;
  action: string;
  actorKind: string;
  note: string;
  createdAt: string;
};
export type LedgerEntry = {
  id: string;
  kind: 'customer_payment' | 'customer_refund' | 'government_debit';
  currency: Currency;
  amount: number;
  reference: string;
  entity: string;
  createdAt: string;
};
export type CaseView = {
  id: string;
  reference: string;
  ownerId: string;
  status: CaseStatus;
  locale: Locale;
  currency: Currency;
  version: number;
  revision: number;
  data: Application;
  quote: Quote | null;
  paymentConfirmed: boolean;
  files: CaseFile[];
  events: CaseEvent[];
  ledger: LedgerEntry[];
  createdAt: string;
  updatedAt: string;
  issues: string[];
  registryCaseNo: string | null;
  brn: string | null;
  signingReady: boolean;
};
export type OrganisationSettings = {
  contactUrl: string;
  secretaryName: string;
  secretaryChineseName: string;
  secretaryBrn: string;
  tcspLicence: string;
  secretaryEmail: string;
  office: Address;
  hkPhone: string;
};
export const defaultOrganisation: OrganisationSettings = {
  contactUrl: '',
  secretaryName: '',
  secretaryChineseName: '',
  secretaryBrn: '',
  tcspLicence: '',
  secretaryEmail: '',
  office: { ...emptyAddress, country: 'HKG' },
  hkPhone: '',
};

export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details: string[] = [],
  ) {
    super(code);
  }
}
export function requireCondition(value: unknown, code: string, status = 409): asserts value {
  if (!value) throw new DomainError(code, status);
}
export function minorUnits(value: string, currency: Currency): number {
  const digits = currency === 'TWD' ? 0 : 2;
  requireCondition(
    new RegExp(`^\\d{1,9}${digits ? '(?:\\.\\d{1,2})?' : ''}$`).test(value),
    'INVALID_AMOUNT',
    400,
  );
  const [whole, frac = ''] = value.split('.');
  return Number(BigInt(whole) * BigInt(10 ** digits) + BigInt(frac.padEnd(digits, '0') || '0'));
}
export function makeQuote(price: Price): Quote {
  for (const n of [price.service, price.government])
    requireCondition(Number.isSafeInteger(n) && n >= 0 && n <= 100000000000, 'INVALID_AMOUNT', 400);
  requireCondition(price.service + price.government > 0, 'PRICE_NOT_CONFIGURED');
  requireCondition(
    price.bank.company.trim() && price.bank.bank.trim() && price.bank.account.trim(),
    'BANK_NOT_CONFIGURED',
  );
  const base = price.service + price.government;
  const tax = price.currency === 'TWD' ? Number((BigInt(base) * 5n + 50n) / 100n) : 0;
  return {
    ...price,
    bank: { ...price.bank },
    entity: price.currency === 'TWD' ? 'TW' : 'HK',
    tax,
    total: base + tax,
  };
}
export function formatMoney(value: number, currency: Currency, locale: Locale = 'zh-Hant') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: currency === 'TWD' ? 0 : 2,
  }).format(value / (currency === 'TWD' ? 1 : 100));
}
// Accept compact numbers or a single parenthesized check character; keep case strict.
export function normalizeHkid(value: string): string | null {
  const match = /^([A-Z]{1,2}\d{6})(?:([0-9A])|\(([0-9A])\))$/.exec(value.replace(/\s/g, ''));
  return match ? match[1] + (match[2] || match[3]) : null;
}
export function applicationIssues(data: Application): string[] {
  const issues: string[] = [];
  if (!data.englishName && !data.chineseName) issues.push('company_name');
  if (data.englishName && !/\bLimited$/i.test(data.englishName)) issues.push('english_name_suffix');
  if (data.chineseName && !data.chineseName.endsWith('有限公司'))
    issues.push('chinese_name_suffix');
  if (!/^\d{3}$/.test(data.businessCode) || !data.businessDescription || !data.sourceOfFunds)
    issues.push('business_information');
  if (
    !/^[A-Z]{3}$/.test(data.shareCurrency) ||
    data.shareCount < 1 ||
    !/^\d{1,12}(\.\d{1,2})?$/.test(data.shareCapital) ||
    Number(data.shareCapital) <= 0
  )
    issues.push('share_capital');
  if (!data.people.length || data.people.some((p) => p.shares < 1 && !p.director))
    issues.push('founders');
  if (!data.people.some((p) => p.director)) issues.push('director');
  if (data.people.reduce((sum, p) => sum + p.shares, 0) !== data.shareCount)
    issues.push('share_allocation');
  const decimal100 = (s: string) =>
    /^\d{1,12}(\.\d{1,2})?$/.test(s)
      ? BigInt(s.split('.')[0]) * 100n + BigInt((s.split('.')[1] || '').padEnd(2, '0'))
      : -1n;
  if (
    data.people.filter((p) => p.shares > 0).some((p) => decimal100(p.contribution) < 0n) ||
    data.people
      .filter((p) => p.shares > 0)
      .reduce((sum, p) => sum + decimal100(p.contribution), 0n) !== decimal100(data.shareCapital)
  )
    issues.push('capital_allocation');
  if (!data.people.some((p) => p.id === data.founderSignerId && p.shares > 0))
    issues.push('founder_signer');
  for (const p of data.people) {
    if (
      !p.surname ||
      !p.givenName ||
      !z.email().safeParse(p.email).success ||
      !p.nationality ||
      !p.identityNumber ||
      !p.address.street ||
      !p.address.country
    )
      issues.push(`person:${p.id}`);
    if (p.identityType === 'hkid' && !normalizeHkid(p.identityNumber)) issues.push(`hkid:${p.id}`);
    if (p.director && (!p.birthDate || !p.correspondence.street || !p.correspondence.country))
      issues.push(`director:${p.id}`);
    if (p.director && p.birthDate) {
      const d = new Date(p.birthDate + 'T00:00:00Z');
      const threshold = new Date();
      threshold.setUTCFullYear(threshold.getUTCFullYear() - 18);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(p.birthDate) ||
        !Number.isFinite(d.getTime()) ||
        d.toISOString().slice(0, 10) !== p.birthDate ||
        d > threshold
      )
        issues.push(`director_age:${p.id}`);
    }
  }
  if (new Set(data.people.map((p) => p.id)).size !== data.people.length)
    issues.push('duplicate_person');
  const signers = data.people.filter((p) => p.director || p.id === data.founderSignerId);
  if (new Set(signers.map((p) => p.email.toLowerCase())).size !== signers.length)
    issues.push('unique_signer_email');
  return [...new Set(issues)];
}
