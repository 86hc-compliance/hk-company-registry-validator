import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  applicationSchema,
  applicationIssues,
  emptyApplication,
  defaultOrganisation,
  currencySchema,
  localeSchema,
  makeQuote,
  requireCondition,
  DomainError,
  type Actor,
  type CaseView,
  type Application,
  type CaseStatus,
  type Price,
  type Quote,
  type FileKind,
  type OrganisationSettings,
} from '../shared/domain.js';
import { digest, Vault } from './storage.js';

type Row = {
  id: string;
  reference: string;
  owner_id: string;
  status: CaseStatus;
  locale: 'en' | 'zh-Hant';
  currency: 'HKD' | 'USD' | 'TWD';
  version: number;
  revision: number;
  data: Buffer;
  quote: string | null;
  paid: number;
  approved_revision: number | null;
  validated_xml: Buffer | null;
  signed_xml: Buffer | null;
  signed_revision: number | null;
  registry_case_no: string | null;
  brn: string | null;
  created_at: string;
  updated_at: string;
};
const now = () => new Date().toISOString();
const internal: Actor = { id: 'tpsi-worker', kind: 'system' };
export class CaseService {
  constructor(
    public db: Database.Database,
    private vault: Vault,
  ) {}
  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM norby_cases WHERE id=?').get(id) as Row | undefined;
    requireCondition(row, 'CASE_NOT_FOUND', 404);
    return row;
  }
  private access(actor: Actor, row: Row, write = false) {
    requireCondition(
      actor.kind === 'staff' || actor.kind === 'system' || row.owner_id === actor.id,
      'CASE_NOT_FOUND',
      404,
    );
    if (actor.kind === 'agent')
      requireCondition(
        actor.scopes?.includes(write ? 'cases:write' : 'cases:read'),
        'INSUFFICIENT_SCOPE',
        403,
      );
  }
  private staff(actor: Actor) {
    requireCondition(actor.kind === 'staff', 'STAFF_REQUIRED', 403);
  }
  private human(actor: Actor) {
    requireCondition(
      actor.kind === 'customer' || actor.kind === 'staff',
      'HUMAN_CONFIRMATION_REQUIRED',
      403,
    );
  }
  private event(row: Row, actor: Actor, action: string, note = '') {
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO norby_events VALUES (?,?,?,?,?,?,?,?)')
      .run(id, row.id, actor.id, actor.kind, actor.clientId || null, action, note, now());
    if (
      [
        'confirm_payment',
        'request_information',
        'approve',
        'reject',
        'confirm_refund',
        'official_submission_receipt',
        'submission_result_unknown',
        'official_status_updated',
        'complete',
      ].includes(action)
    )
      this.db
        .prepare(
          'INSERT INTO norby_notifications (event_id,case_id,next_attempt_at) VALUES (?,?,?)',
        )
        .run(id, row.id, now());
  }
  private change(row: Row, status: CaseStatus) {
    this.db
      .prepare('UPDATE norby_cases SET status=?,version=version+1,updated_at=? WHERE id=?')
      .run(status, now(), row.id);
  }
  private operation<T>(actor: Actor, key: string, input: unknown, run: () => T): T {
    requireCondition(/^[A-Za-z0-9_-]{16,100}$/.test(key), 'IDEMPOTENCY_KEY_REQUIRED', 400);
    const fingerprint = digest(JSON.stringify(input));
    return this.db.transaction(() => {
      const prior = this.db
        .prepare('SELECT * FROM norby_operations WHERE actor_id=? AND key=?')
        .get(actor.id, key) as { fingerprint: string; result: string } | undefined;
      if (prior) {
        requireCondition(prior.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT');
        return JSON.parse(prior.result) as T;
      }
      const result = run();
      this.db
        .prepare('INSERT INTO norby_operations VALUES (?,?,?,?)')
        .run(actor.id, key, fingerprint, JSON.stringify(result));
      return result;
    })();
  }
  create(actor: Actor, input: unknown, key: string): CaseView {
    const value = z
      .object({
        locale: localeSchema,
        currency: currencySchema,
        data: applicationSchema.optional(),
      })
      .strict()
      .parse(input);
    if (actor.kind === 'agent')
      requireCondition(actor.scopes?.includes('cases:write'), 'INSUFFICIENT_SCOPE', 403);
    const result = this.operation(actor, key, { operation: 'create', value }, () => {
      const id = randomUUID();
      const date = now();
      const reference = `NB-${date.slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`;
      this.db
        .prepare(
          'INSERT INTO norby_cases (id,reference,owner_id,status,locale,currency,version,revision,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          reference,
          actor.id,
          'draft',
          value.locale,
          value.currency,
          1,
          1,
          this.vault.seal(JSON.stringify(value.data || emptyApplication), id),
          date,
          date,
        );
      this.event(this.row(id), actor, 'case_created');
      return { id };
    });
    return this.get(actor, result.id);
  }
  get(actor: Actor, id: string): CaseView {
    const r = this.row(id);
    this.access(actor, r);
    const data = applicationSchema.parse(JSON.parse(this.vault.open(r.data, id).toString()));
    return {
      id: r.id,
      reference: r.reference,
      ownerId: r.owner_id,
      status: r.status,
      locale: r.locale,
      currency: r.currency,
      version: r.version,
      revision: r.revision,
      data,
      quote: r.quote ? JSON.parse(r.quote) : null,
      paymentConfirmed: !!r.paid,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      registryCaseNo: r.registry_case_no,
      brn: r.brn,
      signingReady: !!r.validated_xml,
      issues: applicationIssues(data),
      files: this.db
        .prepare(
          'SELECT id,kind,name,type,size,person_id as personId,created_at as createdAt FROM norby_files WHERE case_id=? ORDER BY created_at DESC',
        )
        .all(id) as CaseView['files'],
      events: this.db
        .prepare(
          'SELECT id,action,actor_kind as actorKind,note,created_at as createdAt FROM norby_events WHERE case_id=? ORDER BY created_at DESC,rowid DESC',
        )
        .all(id) as CaseView['events'],
      ledger: this.db
        .prepare(
          'SELECT id,kind,currency,amount,reference,entity,created_at as createdAt FROM norby_ledger WHERE case_id=? ORDER BY created_at',
        )
        .all(id) as CaseView['ledger'],
    };
  }
  list(actor: Actor) {
    if (actor.kind === 'agent')
      requireCondition(actor.scopes?.includes('cases:read'), 'INSUFFICIENT_SCOPE', 403);
    const rows =
      actor.kind === 'staff'
        ? this.db.prepare('SELECT id FROM norby_cases ORDER BY updated_at DESC').all()
        : this.db
            .prepare('SELECT id FROM norby_cases WHERE owner_id=? ORDER BY updated_at DESC')
            .all(actor.id);
    return (rows as { id: string }[]).map((r) => this.get(actor, r.id));
  }
  update(actor: Actor, id: string, input: unknown, key: string) {
    const value = z
      .object({ version: z.number().int(), data: applicationSchema })
      .strict()
      .parse(input);
    this.operation(actor, key, { operation: 'update', id, value }, () => {
      const r = this.row(id);
      this.access(actor, r, true);
      requireCondition(r.version === value.version, 'VERSION_CONFLICT');
      requireCondition(
        ['draft', 'needs_information', 'awaiting_payment', 'payment_check'].includes(r.status),
        'CASE_LOCKED',
      );
      this.db
        .prepare(
          'UPDATE norby_cases SET data=?,revision=revision+1,version=version+1,validated_xml=NULL,signed_xml=NULL,signed_revision=NULL,approved_revision=NULL,updated_at=? WHERE id=?',
        )
        .run(this.vault.seal(JSON.stringify(value.data), id), now(), id);
      this.event(r, actor, 'information_updated');
      return { id };
    });
    return this.get(actor, id);
  }
  prices(): Price[] {
    return (this.db.prepare('SELECT payload FROM norby_prices').all() as { payload: string }[]).map(
      (p) => JSON.parse(p.payload),
    );
  }
  configurePrice(actor: Actor, input: unknown) {
    this.staff(actor);
    const value = z
      .object({
        currency: currencySchema,
        service: z.number().int().nonnegative().max(100000000000),
        government: z.number().int().nonnegative().max(100000000000),
        bank: z
          .object({
            company: z.string().trim().min(1).max(150),
            bank: z.string().trim().min(1).max(150),
            account: z.string().trim().min(1).max(100),
            swift: z.string().max(30),
            instructions: z.string().max(1000),
          })
          .strict(),
      })
      .strict()
      .parse(input);
    return this.db.transaction(() => {
      const previous = this.prices().find((p) => p.currency === value.currency);
      const price = { ...value, version: (previous?.version || 0) + 1 };
      makeQuote(price);
      this.db
        .prepare(
          'INSERT INTO norby_prices VALUES (?,?) ON CONFLICT(currency) DO UPDATE SET payload=excluded.payload',
        )
        .run(price.currency, JSON.stringify(price));
      return price;
    })();
  }
  organisation(): OrganisationSettings {
    const row = this.db
      .prepare("SELECT payload FROM norby_settings WHERE id='organisation'")
      .get() as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : defaultOrganisation;
  }
  configureOrganisation(actor: Actor, value: OrganisationSettings) {
    this.staff(actor);
    this.db
      .prepare(
        "INSERT INTO norby_settings VALUES ('organisation',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      )
      .run(JSON.stringify(value));
    return value;
  }
  private ledger(
    r: Row,
    actor: Actor,
    kind: string,
    currency: string,
    amount: number,
    reference: string,
    entity: string,
  ) {
    requireCondition(reference.trim().length >= 3, 'REFERENCE_REQUIRED', 400);
    this.db
      .prepare('INSERT INTO norby_ledger VALUES (?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), r.id, kind, currency, amount, reference.trim(), entity, actor.id, now());
  }
  action(actor: Actor, id: string, input: unknown, key: string) {
    const v = z
      .object({
        action: z.enum([
          'checkout',
          'report_payment',
          'confirm_payment',
          'request_information',
          'resubmit',
          'approve',
          'reject',
          'confirm_refund',
          'queue_validation',
          'queue_submission',
          'queue_status',
          'reconcile_submission',
          'complete',
        ]),
        version: z.number().int(),
        note: z.string().trim().max(2000).default(''),
        reference: z.string().trim().max(100).default(''),
        amount: z.number().int().positive().optional(),
        checks: z.array(z.string()).max(10).default([]),
        brn: z
          .string()
          .regex(/^\d{8}$/)
          .optional(),
        registryCaseNo: z.string().trim().max(30).optional(),
      })
      .strict()
      .parse(input);
    this.operation(actor, key, { operation: 'action', id, v }, () => {
      const r = this.row(id);
      this.access(actor, r, true);
      requireCondition(r.version === v.version, 'VERSION_CONFLICT');
      const c = this.get(actor, id);
      const q = c.quote;
      switch (v.action) {
        case 'checkout': {
          this.human(actor);
          requireCondition(r.status === 'draft', 'INVALID_STATE');
          requireCondition(c.issues.length === 0, 'INCOMPLETE_APPLICATION');
          requireCondition(v.checks.includes('service_terms'), 'TERMS_REQUIRED', 400);
          const price = this.prices().find((p) => p.currency === r.currency);
          requireCondition(price, 'PRICE_NOT_CONFIGURED');
          const quote = makeQuote(price);
          this.db
            .prepare('UPDATE norby_cases SET quote=? WHERE id=?')
            .run(JSON.stringify(quote), id);
          this.change(r, 'awaiting_payment');
          break;
        }
        case 'report_payment':
          this.human(actor);
          requireCondition(r.status === 'awaiting_payment', 'INVALID_STATE');
          requireCondition(v.reference.length >= 3, 'REFERENCE_REQUIRED');
          requireCondition(
            c.files.some((f) => f.kind === 'payment_proof'),
            'PAYMENT_PROOF_REQUIRED',
          );
          this.change(r, 'payment_check');
          break;
        case 'confirm_payment':
          this.staff(actor);
          requireCondition(
            ['awaiting_payment', 'payment_check'].includes(r.status) && q && !r.paid,
            'INVALID_STATE',
          );
          requireCondition(v.amount === q.total, 'PAYMENT_AMOUNT_MISMATCH');
          this.ledger(r, actor, 'customer_payment', r.currency, q.total, v.reference, q.entity);
          this.db.prepare('UPDATE norby_cases SET paid=1 WHERE id=?').run(id);
          this.change(r, 'under_review');
          break;
        case 'request_information':
          this.staff(actor);
          requireCondition(
            ['under_review', 'awaiting_signatures', 'ready_to_submit'].includes(r.status),
            'INVALID_STATE',
          );
          requireCondition(v.note, 'NOTE_REQUIRED');
          this.db
            .prepare(
              'UPDATE norby_cases SET approved_revision=NULL,validated_xml=NULL,signed_xml=NULL,signed_revision=NULL WHERE id=?',
            )
            .run(id);
          this.change(r, 'needs_information');
          break;
        case 'resubmit':
          requireCondition(r.status === 'needs_information' && r.paid, 'INVALID_STATE');
          requireCondition(c.issues.length === 0, 'INCOMPLETE_APPLICATION');
          this.change(r, 'under_review');
          break;
        case 'approve':
          this.staff(actor);
          requireCondition(r.status === 'under_review' && r.paid, 'INVALID_STATE');
          requireCondition(c.issues.length === 0, 'INCOMPLETE_APPLICATION');
          requireCondition(
            ['identity', 'beneficial_owners', 'business_purpose', 'screening'].every((x) =>
              v.checks.includes(x),
            ) && v.note,
            'REVIEW_CHECKS_REQUIRED',
          );
          requireCondition(
            c.data.people.every(
              (p) =>
                c.files.some((f) => f.personId === p.id && f.kind === 'identity') &&
                c.files.some((f) => f.personId === p.id && f.kind === 'address'),
            ),
            'KYC_DOCUMENTS_REQUIRED',
          );
          this.db.prepare('UPDATE norby_cases SET approved_revision=revision WHERE id=?').run(id);
          this.change(r, 'awaiting_signatures');
          break;
        case 'reject':
          this.staff(actor);
          requireCondition(
            [
              'under_review',
              'needs_information',
              'awaiting_signatures',
              'ready_to_submit',
            ].includes(r.status) && r.paid,
            'INVALID_STATE',
          );
          requireCondition(
            !this.db
              .prepare("SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit'")
              .get(id),
            'SUBMISSION_ALREADY_ATTEMPTED',
          );
          requireCondition(v.note, 'NOTE_REQUIRED');
          this.change(r, 'refund_pending');
          break;
        case 'confirm_refund':
          this.staff(actor);
          requireCondition(r.status === 'refund_pending' && q, 'INVALID_STATE');
          requireCondition(v.amount === q.total, 'FULL_REFUND_REQUIRED');
          this.ledger(r, actor, 'customer_refund', r.currency, q.total, v.reference, q.entity);
          this.change(r, 'refunded');
          break;
        case 'queue_validation':
          this.human(actor);
          requireCondition(
            r.status === 'awaiting_signatures' &&
              r.paid &&
              r.approved_revision === r.revision &&
              !r.validated_xml,
            'INVALID_STATE',
          );
          this.enqueue(r, 'validate');
          this.change(r, r.status);
          break;
        case 'queue_submission':
          this.staff(actor);
          requireCondition(
            r.status === 'ready_to_submit' &&
              r.paid &&
              r.approved_revision === r.revision &&
              r.signed_revision === r.revision &&
              r.signed_xml,
            'SUBMISSION_NOT_READY',
          );
          this.enqueue(r, 'submit');
          this.change(r, 'submitting');
          break;
        case 'queue_status':
          this.staff(actor);
          requireCondition(
            ['submitted', 'verification_required', 'needs_correction'].includes(r.status) &&
              r.registry_case_no,
            'CASE_REFERENCE_REQUIRED',
          );
          this.enqueue(r, 'status');
          this.change(r, r.status);
          break;
        case 'reconcile_submission':
          this.staff(actor);
          requireCondition(
            r.status === 'verification_required' &&
              r.paid &&
              !c.ledger.some((l) => l.kind === 'government_debit') &&
              this.db
                .prepare("SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit'")
                .get(id),
            'INVALID_STATE',
          );
          requireCondition(
            v.amount &&
              v.registryCaseNo &&
              v.note &&
              v.checks.includes('registry_receipt_verified') &&
              c.files.some((f) => f.kind === 'registry_receipt'),
            'RECEIPT_VERIFICATION_REQUIRED',
          );
          this.ledger(r, actor, 'government_debit', 'HKD', v.amount, v.reference, 'HK_TPSI');
          this.db
            .prepare('UPDATE norby_cases SET registry_case_no=?,brn=? WHERE id=?')
            .run(v.registryCaseNo, v.brn || null, id);
          this.change(r, 'submitted');
          break;
        case 'complete':
          this.staff(actor);
          requireCondition(
            ['submitted', 'verification_required'].includes(r.status),
            'INVALID_STATE',
          );
          requireCondition(
            c.files.some((f) => f.kind === 'ci') && c.files.some((f) => f.kind === 'br'),
            'CERTIFICATES_REQUIRED',
          );
          requireCondition(
            c.ledger.some((l) => l.kind === 'government_debit'),
            'GOVERNMENT_DEBIT_NOT_RECONCILED',
          );
          requireCondition(
            v.brn && v.registryCaseNo && v.note && v.checks.includes('certificates_verified'),
            'CERTIFICATE_VERIFICATION_REQUIRED',
          );
          this.db
            .prepare('UPDATE norby_cases SET brn=?,registry_case_no=? WHERE id=?')
            .run(v.brn, v.registryCaseNo, id);
          this.change(r, 'completed');
          break;
      }
      this.event(
        r,
        actor,
        v.action,
        v.note || (['report_payment'].includes(v.action) ? v.reference : ''),
      );
      return { id };
    });
    return this.get(actor, id);
  }
  addFile(
    actor: Actor,
    id: string,
    kind: FileKind,
    name: string,
    content: Buffer,
    personId: string | null,
  ) {
    return this.db.transaction(() => {
      const r = this.row(id);
      this.access(actor, r, true);
      this.human(actor);
      const cert = kind === 'ci' || kind === 'br' || kind === 'registry_receipt';
      if (cert) {
        this.staff(actor);
        requireCondition(
          ['submitted', 'verification_required'].includes(r.status),
          'INVALID_STATE',
        );
      } else
        requireCondition(
          [
            'draft',
            'awaiting_payment',
            'payment_check',
            'under_review',
            'needs_information',
          ].includes(r.status),
          'CASE_LOCKED',
        );
      requireCondition(
        content.length > 0 && content.length <= 10 * 1024 * 1024,
        'FILE_TOO_LARGE',
        413,
      );
      let type = '';
      if (content.subarray(0, 5).toString() === '%PDF-') type = 'application/pdf';
      else if (content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        type = 'image/png';
      else if (content.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) type = 'image/jpeg';
      requireCondition(type && (!cert || type === 'application/pdf'), 'UNSUPPORTED_FILE_TYPE', 415);
      if (['identity', 'address'].includes(kind))
        requireCondition(
          personId && this.get(actor, id).data.people.some((p) => p.id === personId),
          'PERSON_REQUIRED',
          400,
        );
      const fileId = randomUUID();
      const safeName = name.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'document';
      this.db
        .prepare('INSERT INTO norby_files VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(
          fileId,
          id,
          kind,
          safeName,
          type,
          content.length,
          personId,
          this.vault.seal(content, fileId),
          actor.id,
          now(),
        );
      this.change(r, r.status);
      this.event(r, actor, 'document_uploaded', kind);
      return this.get(actor, id);
    })();
  }
  file(actor: Actor, id: string, fileId: string) {
    this.access(actor, this.row(id));
    this.human(actor);
    const f = this.db
      .prepare('SELECT * FROM norby_files WHERE id=? AND case_id=?')
      .get(fileId, id) as { content: Buffer; name: string; type: string } | undefined;
    requireCondition(f, 'FILE_NOT_FOUND', 404);
    return { ...f, content: this.vault.open(f.content, fileId) };
  }
  private enqueue(r: Row, operation: string) {
    requireCondition(
      !this.db
        .prepare("SELECT 1 FROM norby_jobs WHERE case_id=? AND status IN ('queued','running')")
        .get(r.id),
      'JOB_IN_PROGRESS',
    );
    if (operation === 'submit')
      requireCondition(
        !this.db
          .prepare("SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit' AND revision=?")
          .get(r.id, r.revision),
        'SUBMISSION_ALREADY_ATTEMPTED',
      );
    const t = now();
    this.db
      .prepare('INSERT INTO norby_jobs VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), r.id, operation, r.revision, 'queued', null, t, t);
  }
  nextJob() {
    return this.db.transaction(() => {
      const job = this.db
        .prepare("SELECT * FROM norby_jobs WHERE status='queued' ORDER BY created_at LIMIT 1")
        .get() as { id: string; case_id: string; operation: string; revision: number } | undefined;
      if (job)
        this.db
          .prepare("UPDATE norby_jobs SET status='running',updated_at=? WHERE id=?")
          .run(now(), job.id);
      return job;
    })();
  }
  finishJob(jobId: string, error?: string) {
    this.db
      .prepare('UPDATE norby_jobs SET status=?,error=?,updated_at=? WHERE id=?')
      .run(error ? 'failed' : 'completed', error || null, now(), jobId);
    if (error) {
      const j = this.db.prepare('SELECT case_id FROM norby_jobs WHERE id=?').get(jobId) as {
        case_id: string;
      };
      this.event(this.row(j.case_id), internal, 'official_request_failed', error);
    }
  }
  internalCase(id: string) {
    return this.get(internal, id);
  }
  tpsiXml(id: string, signed = false) {
    const r = this.row(id);
    const v = signed ? r.signed_xml : r.validated_xml;
    requireCondition(v, 'VALIDATED_DOCUMENT_REQUIRED');
    return this.vault.open(v, `${id}:xml`).toString();
  }
  recordValidation(id: string, revision: number, xml: string) {
    this.db.transaction(() => {
      const r = this.row(id);
      requireCondition(
        r.revision === revision &&
          r.approved_revision === revision &&
          r.status === 'awaiting_signatures',
        'STALE_REVISION',
      );
      this.db
        .prepare('UPDATE norby_cases SET validated_xml=?,version=version+1,updated_at=? WHERE id=?')
        .run(this.vault.seal(xml, `${id}:xml`), now(), id);
      this.event(r, internal, 'official_validation_completed');
    })();
  }
  recordSignature(id: string, revision: number, xml: string, complete: boolean, version: number) {
    this.db.transaction(() => {
      const r = this.row(id);
      requireCondition(
        r.version === version &&
          r.revision === revision &&
          r.approved_revision === revision &&
          r.status === 'awaiting_signatures',
        'STALE_REVISION',
      );
      this.db
        .prepare('UPDATE norby_cases SET validated_xml=?,signed_xml=?,signed_revision=? WHERE id=?')
        .run(
          this.vault.seal(xml, `${id}:xml`),
          complete ? this.vault.seal(xml, `${id}:xml`) : null,
          complete ? revision : null,
          id,
        );
      this.change(r, complete ? 'ready_to_submit' : 'awaiting_signatures');
      this.event(r, internal, 'official_signature_verified');
    })();
  }
  recordSubmission(
    id: string,
    receipt: { caseNo: string; reference: string; amount: number; brn?: string },
    raw: string,
  ) {
    this.db.transaction(() => {
      const r = this.row(id);
      requireCondition(r.status === 'submitting', 'INVALID_STATE');
      this.ledger(
        r,
        internal,
        'government_debit',
        'HKD',
        receipt.amount,
        receipt.reference,
        'HK_TPSI',
      );
      this.db
        .prepare('INSERT INTO norby_registry_receipts VALUES (?,?,?)')
        .run(id, this.vault.seal(raw, `${id}:receipt`), now());
      this.db
        .prepare('UPDATE norby_cases SET registry_case_no=?,brn=? WHERE id=?')
        .run(receipt.caseNo, receipt.brn || null, id);
      this.change(r, 'submitted');
      this.event(r, internal, 'official_submission_receipt');
    })();
  }
  recordStatus(id: string, status: 'Lodged' | 'Pending re-lodged' | 'Re-lodged' | 'unknown') {
    const r = this.row(id);
    requireCondition(
      ['submitted', 'verification_required', 'needs_correction'].includes(r.status),
      'INVALID_STATE',
    );
    this.change(
      r,
      status === 'unknown'
        ? 'verification_required'
        : status === 'Pending re-lodged'
          ? 'needs_correction'
          : 'submitted',
    );
    this.event(r, internal, 'official_status_updated', status);
  }
  submissionUncertain(id: string) {
    const r = this.row(id);
    if (r.status === 'submitting') {
      this.change(r, 'verification_required');
      this.event(
        r,
        internal,
        'submission_result_unknown',
        'Norby must reconcile the official result before any further submission.',
      );
    }
  }
  recoverInterruptedJobs() {
    for (const j of this.db
      .prepare("SELECT id,case_id,operation FROM norby_jobs WHERE status='running'")
      .all() as { id: string; case_id: string; operation: string }[]) {
      if (j.operation === 'submit') this.submissionUncertain(j.case_id);
      this.finishJob(j.id, 'WORKER_INTERRUPTED');
    }
  }
}
