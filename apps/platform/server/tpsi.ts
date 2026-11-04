import {
  createCipheriv,
  createHash,
  publicEncrypt,
  constants,
  randomBytes,
  randomInt,
  X509Certificate,
} from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { config } from './config.js';
import type { CaseService } from './cases.js';
import {
  requireCondition,
  DomainError,
  minorUnits,
  applicationIssues,
  normalizeHkid,
  type Application,
  type Address,
  type OrganisationSettings,
  type CaseView,
  type Actor,
} from '../shared/domain.js';

const NS = 'http://interfaces.service.webservice.icris3e.cr.gov.hk/';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const escapeXml = (s: unknown) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const tag = (name: string, value: unknown) => `<cr:${name}>${escapeXml(value)}</cr:${name}>`;
const group = (name: string, content: string) => `<cr:${name}>${content}</cr:${name}>`;
const envelope = (method: string, content: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><cr:${method} xmlns:cr="${NS}" xmlns:ds="${DS}">${content}</cr:${method}></soap:Body></soap:Envelope>`;
const address = (a: Address, name = 'stdAddress') =>
  group(
    name,
    tag('flatFlrBlk', a.flat) +
      tag('bldg', a.building) +
      tag('stEstLotVlg', a.street) +
      tag('dstCtyStatePostal', a.district) +
      tag('ctryRegion', a.country),
  );
const fields = (v: Record<string, unknown>) =>
  Object.entries(v)
    .map(([k, v]) => tag(k, v))
    .join('');
export function buildNnc1(data: Application, org: OrganisationSettings, date = new Date()) {
  requireCondition(applicationIssues(data).length === 0, 'INCOMPLETE_APPLICATION');
  const founder = data.people.find((p) => p.id === data.founderSignerId)!;
  requireCondition(
    founder.officialUserId && data.people.filter((p) => p.director).every((p) => p.officialUserId),
    'OFFICIAL_ACCOUNTS_REQUIRED',
  );
  requireCondition(
    org.secretaryName &&
      /^\d{8}$/.test(org.secretaryBrn) &&
      org.tcspLicence &&
      org.office.street &&
      org.office.country === 'HKG' &&
      org.secretaryEmail &&
      /^\d{8}$/.test(org.hkPhone),
    'ORGANISATION_NOT_CONFIGURED',
  );
  const localDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
  const shareholders = data.people
    .filter((p) => p.shares > 0)
    .map((p) =>
      group(
        'shareHolder',
        fields({
          personType: 'P',
          chiName: p.chineseName,
          engSurName: p.surname,
          engOtherName: p.givenName,
          engName: '',
        }) +
          address(p.address) +
          group(
            'shareCapitalList',
            group(
              'shareCapital',
              fields({
                classOfShare: 'Ordinary',
                totalNo: p.shares,
                currCode: data.shareCurrency,
                amt: p.contribution,
              }),
            ),
          ),
      ),
    )
    .join('');
  const directors = data.people
    .filter((p) => p.director)
    .map((p, i) => {
      const hkid = p.identityType === 'hkid' ? normalizeHkid(p.identityNumber) : '';
      requireCondition(hkid !== null, 'INVALID_HKID');
      return (
        `<cr:indDir id="S${i + 1}">` +
        fields({
          chiName: p.chineseName,
          surNameEng: p.surname,
          otherNameEng: p.givenName,
          prevNameChi: p.previousChineseName,
          prevNameEng: p.previousEnglishName,
          aliasNameChi: p.aliasChineseName,
          aliasNameEng: p.aliasEnglishName,
        }) +
        address(p.correspondence, 'correspondingAddress') +
        fields({
          email: p.email,
          hkid: hkid.slice(0, -1),
          hkidChkDtg: hkid.slice(-1),
          passportCtry: hkid ? '' : p.passportCountry || p.nationality,
          passportNo: hkid ? '' : p.identityNumber,
          consentSigned: 'Y',
          selectPersonId: p.officialUserId,
          selectPersonName: `${p.surname}, ${p.givenName}`,
          selectCapacityDesc: 'Director',
        }) +
        address(p.address) +
        '</cr:indDir>'
      );
    })
    .join('');
  const model =
    fields({
      language: 'E',
      coyStatus: 'P',
      aaLang: 'M',
      sampleAA: 'B',
      proposedCoySecure: 'false',
      intendedEngName: data.englishName,
      intendedChiName: data.chineseName,
      bnCode: data.businessCode,
      bnDesc: '',
    }) +
    address(org.office) +
    fields({ email: org.secretaryEmail, telNo: org.hkPhone }) +
    group(
      'shareCapitals',
      group(
        'shareCapital',
        fields({
          classOfShare: 'Ordinary',
          issuedShareCapital: data.shareCapital,
          currCode: data.shareCurrency,
          amt: data.shareCount,
          paidUpShareCapital: data.shareCapital,
          remainUnpaid: 0,
          particluarOfRights: 'Ordinary',
        }),
      ),
    ) +
    group('shareHolderList', shareholders) +
    group(
      'corpSecList',
      group(
        'corpSec',
        fields({ chiName: org.secretaryChineseName, engName: org.secretaryName }) +
          address(org.office, 'correspondingAddress') +
          fields({
            email: org.secretaryEmail,
            ubino: org.secretaryBrn,
            tcspNo: org.tcspLicence,
            exempted: 'N',
            reason: '',
          }),
      ),
    ) +
    group('indDirList', directors) +
    fields({
      totalPageNo: '',
      brcYear: 1,
      associatedCapacityDesc: '',
      associatedPersonId: '',
      associatedPersonName: '',
      selectAssoBrNo: '',
      selectCapacityDesc: 'Founder Member',
      selectPersonId: founder.officialUserId,
      selectPersonName: `${founder.surname}, ${founder.givenName}`,
      signatoryDate: localDate,
    });
  return envelope(
    'validateForm',
    `<cr:submission><cr:EForm id="eForm"><cr:formModel id="formData">${model}</cr:formModel><cr:formDataSignatures/></cr:EForm><cr:EFormSignatures></cr:EFormSignatures></cr:submission>`,
  );
}
export function parseSoap(xml: string): Record<string, any> {
  requireCondition(
    xml.length < 4_000_000 &&
      !/<!DOCTYPE|<!ENTITY/i.test(xml) &&
      XMLValidator.validate(xml) === true,
    'INVALID_REGISTRY_RESPONSE',
    502,
  );
  const result = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
  }).parse(xml);
  const body = result.Envelope?.Body;
  requireCondition(body && typeof body === 'object', 'INVALID_REGISTRY_RESPONSE', 502);
  requireCondition(!body.Fault, 'REGISTRY_REJECTED_REQUEST', 422);
  return body;
}
export function submissionFrom(xml: string) {
  parseSoap(xml);
  const match = xml.match(/<cr:submission(?:\s[^>]*)?>[\s\S]*?<\/cr:submission>/);
  requireCondition(match, 'INVALID_REGISTRY_RESPONSE', 502);
  return match[0].replace(
    /<cr:submission(?:\s[^>]*)?>/,
    `<cr:submission xmlns:cr="${NS}" xmlns:ds="${DS}">`,
  );
}
export function parseReceipt(xml: string) {
  const receipt = parseSoap(xml).submitFormResponse?.receipt;
  requireCondition(
    receipt &&
      typeof receipt.caseNo === 'string' &&
      receipt.caseNo &&
      receipt.pymtRefNo &&
      receipt.totalAmount &&
      /^\d+(\.\d{1,2})?$/.test(receipt.totalAmount),
    'INVALID_REGISTRY_RECEIPT',
    502,
  );
  return {
    caseNo: receipt.caseNo,
    reference: receipt.pymtRefNo,
    amount: minorUnits(receipt.totalAmount, 'HKD'),
    brn: receipt.brNo || undefined,
  };
}
export function parseStatus(
  xml: string,
  caseNo: string,
): 'Lodged' | 'Pending re-lodged' | 'Re-lodged' | 'unknown' {
  const response = parseSoap(xml).enquireDocStatusResponse;
  requireCondition(response !== undefined, 'INVALID_REGISTRY_RESPONSE', 502);
  const documents = response?.result?.documentList?.document;
  const list = Array.isArray(documents) ? documents : documents ? [documents] : [];
  const relevant = list.filter((d) => d.caseNo === caseNo);
  if (!relevant.length) return 'unknown';
  if (relevant.some((d) => d.documentStatus === 'Pending re-lodged')) return 'Pending re-lodged';
  if (relevant.every((d) => d.documentStatus === 'Lodged')) return 'Lodged';
  if (relevant.every((d) => ['Lodged', 'Re-lodged'].includes(d.documentStatus))) return 'Re-lodged';
  return 'unknown';
}
export type TpsiOptions = {
  mode: 'test' | 'production';
  user: string;
  password: string;
  deposit: string;
  fetch?: typeof fetch;
  timeout?: number;
};
export class TpsiClient {
  private fetcher: typeof fetch;
  private origin: string;
  constructor(private options: TpsiOptions) {
    this.fetcher = options.fetch || fetch;
    this.origin =
      options.mode === 'test' ? 'https://apitest.cr.gov.hk' : 'https://www.e-services.cr.gov.hk';
  }
  private async token() {
    const r = await this.fetcher(`${this.origin}/ICRIS3EF/oauth/token.do?scope=tpsi`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.options.user}:${sha(this.options.password)}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    requireCondition(r.ok, 'TPSI_AUTH_FAILED', 502);
    const v = (await r.json()) as { access_token?: string };
    requireCondition(v.access_token, 'TPSI_AUTH_FAILED', 502);
    return v.access_token;
  }
  private async request(path: string, xml: string) {
    const token = await this.token();
    const response = await this.fetcher(`${this.origin}/ICRIS3EF/tpsi/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/xml; charset=utf-8' },
      body: xml,
      signal: AbortSignal.timeout(this.options.timeout || 120000),
      redirect: 'error',
    });
    requireCondition(response.ok, 'REGISTRY_HTTP_ERROR', 502);
    const result = await response.text();
    parseSoap(result);
    return result;
  }
  async validate(xml: string) {
    const response = await this.request('validateFormNnc1', xml);
    requireCondition(
      parseSoap(response).validateFormResponse?.submission,
      'REGISTRY_VALIDATION_FAILED',
      422,
    );
    const submission = submissionFrom(response);
    verifyRegistrySignature(submission);
    return submission;
  }
  async verify(xml: string) {
    const r = await this.request('verifyPinSigningNnc1', envelope('verifyPinSigning', xml));
    requireCondition(
      parseSoap(r).verifyPinSigningResponse?.result === 'Pin Signature(s) Verified Successfully.',
      'REGISTRY_SIGNATURE_REJECTED',
      422,
    );
  }
  async submit(xml: string) {
    requireCondition(this.options.deposit, 'DEPOSIT_NOT_CONFIGURED');
    const body = xml.replace(
      '</cr:submission>',
      tag('depositAccountNo', this.options.deposit) + '</cr:submission>',
    );
    return this.request('submitFormNnc1', envelope('submitForm', body));
  }
  async status(caseNo: string, brn: string) {
    return this.request(
      'docStatusEnquiry',
      envelope(
        'enquireDocStatus',
        group(
          'criteria',
          fields({
            brNo: brn,
            caseNo,
            submissionDateStart: '',
            submissionDateEnd: '',
            documentRefNo: '',
          }),
        ),
      ),
    );
  }
  async balance() {
    const r = await this.request(
      'enquireDepositAccount',
      envelope(
        'enquireDepositAccount',
        group('depositRequest', tag('accountNo', this.options.deposit)),
      ),
    );
    return parseSoap(r).enquireDepositAccountResponse?.result?.accountBalance;
  }
}
function xmlDocument(xml: string) {
  requireCondition(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'INVALID_REGISTRY_RESPONSE');
  return new DOMParser({
    onError: () => {
      throw new DomainError('INVALID_REGISTRY_RESPONSE');
    },
  }).parseFromString(xml, 'text/xml');
}
/** Only operates on the Registry response retrieved by our authenticated HTTPS client. */
export function verifyRegistrySignature(xml: string) {
  const doc = xmlDocument(xml);
  const signatures = Array.from(doc.getElementsByTagNameNS(DS, 'Signature')).filter(
    (n) => n.getAttribute('id') === 'CR',
  );
  requireCondition(signatures.length === 1, 'INVALID_REGISTRY_SIGNATURE', 502);
  const signature = signatures[0];
  const cert = signature.getElementsByTagNameNS(DS, 'X509Certificate')[0]?.textContent;
  requireCondition(cert, 'INVALID_REGISTRY_SIGNATURE', 502);
  const pem = `-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`;
  const verifier = new SignedXml({ publicCert: pem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(new XMLSerializer().serializeToString(signature));
  requireCondition(
    verifier.getReferences().length === 1 &&
      verifier.getReferences()[0].uri === '#formData' &&
      verifier.checkSignature(xml),
    'INVALID_REGISTRY_SIGNATURE',
    502,
  );
  return new X509Certificate(pem).publicKey;
}
/** Wire format follows the TPSIT v1.0.6 sample, including its double-base64 ECB credential field. */
export function signRegistryXml(xml: string, username: string, password: string, uri: string) {
  requireCondition(uri === 'FormSigner' || /^S\d+$/.test(uri), 'INVALID_SIGNATURE_TARGET');
  const publicKey = verifyRegistrySignature(xml);
  const doc = xmlDocument(xml);
  const targetId = uri === 'FormSigner' ? 'eForm' : uri;
  const targets = Array.from(doc.getElementsByTagName('*')).filter(
    (n) => n.getAttribute('id') === targetId,
  );
  requireCondition(targets.length === 1, 'INVALID_SIGNATURE_TARGET');
  const object = new XMLSerializer().serializeToString(targets[0]);
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const random32 = Array.from({ length: 32 }, () => alphabet[randomInt(alphabet.length)]).join('');
  const credential = createCipheriv('aes-256-ecb', Buffer.from(random32), null);
  const raw = Buffer.concat([
    credential.update(username + random32 + sha(password), 'utf8'),
    credential.final(),
  ]).toString('base64');
  const userHash = Buffer.from(raw).toString('base64');
  const gcmKey = randomBytes(32),
    iv = randomBytes(12);
  const gcm = createCipheriv('aes-256-gcm', gcmKey, iv);
  const ciphertext = Buffer.concat([
    gcm.update(sha(object + userHash), 'utf8'),
    gcm.final(),
    gcm.getAuthTag(),
  ]);
  const encodedGcm = `{ciphertextBase64:"${ciphertext.toString('base64')}",ivBase64:"${iv.toString('base64')}",gcmKeyBase64:"${gcmKey.toString('base64')}"}`;
  const encryptedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(random32),
  ).toString('base64');
  const pin = `<cr:PinSign URI="#${targetId}">${fields({ UserCredentialHash: userHash, UserSignature: Buffer.from(encodedGcm).toString('base64'), EncryptionKey: encryptedKey })}</cr:PinSign>`;
  const container = uri === 'FormSigner' ? 'EFormSignatures' : 'formDataSignatures';
  requireCondition(
    doc.getElementsByTagNameNS(NS, container).length === 1,
    'INVALID_SIGNATURE_CONTAINER',
  );
  requireCondition(
    !Array.from(doc.getElementsByTagNameNS(NS, 'PinSign')).some(
      (n) => n.getAttribute('URI') === `#${targetId}`,
    ),
    'SIGNATURE_ALREADY_PRESENT',
  );
  const empty = new RegExp(`<cr:${container}\\s*/>`);
  return empty.test(xml)
    ? xml.replace(empty, group(container, pin))
    : xml.replace(`</cr:${container}>`, pin + `</cr:${container}>`);
}
export function nextSigner(c: CaseView, xml: string) {
  const signed = new Set(
    Array.from(xmlDocument(xml).getElementsByTagNameNS(NS, 'PinSign')).map((n) =>
      n.getAttribute('URI'),
    ),
  );
  const directors = c.data.people.filter((p) => p.director);
  for (let i = 0; i < directors.length; i++)
    if (!signed.has(`#S${i + 1}`)) return { person: directors[i], uri: `S${i + 1}` };
  if (!signed.has('#eForm'))
    return {
      person: c.data.people.find((p) => p.id === c.data.founderSignerId)!,
      uri: 'FormSigner',
    };
  return null;
}
export function signingReview(xml: string, uri: string) {
  const doc = xmlDocument(xml);
  const target = Array.from(doc.getElementsByTagName('*')).find(
    (n) => n.getAttribute('id') === (uri === 'FormSigner' ? 'formData' : uri),
  );
  requireCondition(target, 'INVALID_SIGNATURE_TARGET');
  const rows: { path: string[]; key: string; value: string }[] = [];
  const walk = (node: XmlElement, path: string[]) => {
    const children = Array.from(node.childNodes).filter((n) => n.nodeType === 1) as XmlElement[];
    if (!children.length) {
      const value = node.textContent?.trim();
      if (value) rows.push({ path, key: node.localName!, value });
      return;
    }
    const seen = new Map<string, number>();
    for (const child of children) {
      const name = child.localName!;
      seen.set(name, (seen.get(name) || 0) + 1);
      const repeated = children.filter((n) => n.localName === name).length > 1;
      walk(
        child,
        node === target
          ? []
          : [...path, `${node.localName}${repeated ? ` ${seen.get(name)}` : ''}`],
      );
    }
  };
  walk(target, []);
  return rows;
}
export function tpsiReady() {
  const modeReady =
    config.tpsiMode === 'production'
      ? process.env.TPSI_TEST_DATA_ONLY !== 'true'
      : config.tpsiMode === 'test' && process.env.TPSI_TEST_DATA_ONLY === 'true';
  return (
    modeReady &&
    !!process.env.TPSI_USER_ID &&
    !!process.env.TPSI_PASSWORD &&
    !!process.env.TPSI_DEPOSIT_ACCOUNT
  );
}
export function liveClient() {
  requireCondition(tpsiReady(), 'TPSI_NOT_CONFIGURED', 503);
  return new TpsiClient({
    mode: config.tpsiMode as 'test' | 'production',
    user: process.env.TPSI_USER_ID!,
    password: process.env.TPSI_PASSWORD!,
    deposit: process.env.TPSI_DEPOSIT_ACCOUNT!,
  });
}
export function signingContext(cases: CaseService, id: string, actor: Actor) {
  requireCondition(
    actor.kind === 'customer' || actor.kind === 'staff',
    'HUMAN_CONFIRMATION_REQUIRED',
    403,
  );
  const c = cases.internalCase(id);
  requireCondition(c.status === 'awaiting_signatures' && c.signingReady, 'SIGNING_NOT_READY');
  const xml = cases.tpsiXml(id),
    next = nextSigner(c, xml);
  requireCondition(next, 'SIGNING_COMPLETE');
  requireCondition(
    actor.email && actor.email.toLowerCase() === next.person.email.toLowerCase(),
    'SIGNER_ACCOUNT_REQUIRED',
    403,
  );
  return { c, xml, next };
}
const activeSignatures = new Set<string>();
export async function signCase(
  cases: CaseService,
  id: string,
  actor: Actor,
  version: number,
  password: string,
) {
  requireCondition(!activeSignatures.has(id), 'SIGNING_IN_PROGRESS');
  activeSignatures.add(id);
  try {
    const { c, xml, next } = signingContext(cases, id, actor);
    requireCondition(c.version === version, 'VERSION_CONFLICT');
    const signed = signRegistryXml(xml, next.person.officialUserId, password, next.uri);
    await liveClient().verify(signed);
    cases.recordSignature(id, c.revision, signed, next.uri === 'FormSigner', c.version);
    return { signed: true };
  } finally {
    activeSignatures.delete(id);
  }
}
export async function processJob(
  cases: CaseService,
  job: NonNullable<ReturnType<CaseService['nextJob']>>,
  client: TpsiClient,
) {
  try {
    const c = cases.internalCase(job.case_id);
    if (job.operation === 'validate') {
      const xml = buildNnc1(c.data, cases.organisation());
      cases.recordValidation(c.id, job.revision, await client.validate(xml));
    } else if (job.operation === 'submit') {
      requireCondition(c.revision === job.revision && c.status === 'submitting', 'STALE_REVISION');
      const raw = await client.submit(cases.tpsiXml(c.id, true));
      cases.recordSubmission(c.id, parseReceipt(raw), raw);
    } else if (job.operation === 'status') {
      requireCondition(c.registryCaseNo, 'CASE_REFERENCE_REQUIRED');
      cases.recordStatus(
        c.id,
        parseStatus(await client.status(c.registryCaseNo, c.brn || ''), c.registryCaseNo),
      );
    } else throw new DomainError('UNKNOWN_JOB');
    cases.finishJob(job.id);
  } catch (e) {
    if (job.operation === 'submit') cases.submissionUncertain(job.case_id);
    cases.finishJob(job.id, e instanceof DomainError ? e.code : 'REGISTRY_CONNECTION_FAILED');
  }
}
export function startWorker(cases: CaseService) {
  cases.recoverInterruptedJobs();
  let stopped = false,
    busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy || !tpsiReady()) return;
    busy = true;
    try {
      const job = cases.nextJob();
      if (job) await processJob(cases, job, liveClient());
    } finally {
      busy = false;
    }
  }, 1000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
