import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
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
  type CaseStatus,
  type Price,
  type FileKind,
  type OrganisationSettings,
} from '../shared/domain.js';
import { digest, Vault, Mutation, statement, type StoredBytes, type SqlValue } from './storage.js';

type Row = {
  id: string;
  reference: string;
  owner_id: string;
  status: CaseStatus;
  locale: 'en' | 'zh-Hant';
  currency: 'HKD' | 'USD' | 'TWD';
  version: number;
  revision: number;
  data: StoredBytes;
  quote: string | null;
  paid: number;
  approved_revision: number | null;
  validated_xml: string | null;
  signed_xml: string | null;
  signed_revision: number | null;
  registry_case_no: string | null;
  brn: string | null;
  created_at: string;
  updated_at: string;
};
export type Job = {
  id: string;
  case_id: string;
  operation: 'validate' | 'submit' | 'status';
  revision: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  error: string | null;
  created_at: string;
  updated_at: string;
  lease_token: string | null;
  lease_expires_at: number | null;
  result_committed_at?: string | null;
};
export type JobLease = { id: string; token: string };
type StoredObject = { id: string; object_key: string };
const now = () => new Date().toISOString();
const sqlNow = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const internal: Actor = { id: 'tpsi-worker', kind: 'system' };

/** All state, audit, outbox, ledger and idempotency writes commit in one guarded D1 batch. */
export class CloudflareCaseService {
  private vault: Vault;
  constructor(
    public db: D1Database,
    private bucket: R2Bucket,
    dataKey: string,
  ) {
    this.vault = new Vault(dataKey);
  }
  private async row(id: string): Promise<Row> {
    const row = await statement(this.db, 'SELECT * FROM norby_cases WHERE id=?', id).first<Row>();
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
  private event(tx: Mutation, row: Pick<Row, 'id'>, actor: Actor, action: string, note = '') {
    const id = randomUUID();
    tx.prepare('INSERT INTO norby_events VALUES (?,?,?,?,?,?,?,?)').run(
      id,
      row.id,
      actor.id,
      actor.kind,
      actor.clientId || null,
      action,
      note,
      now(),
    );
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
    ) {
      tx.prepare(
        'INSERT INTO norby_notifications (event_id,case_id,next_attempt_at) VALUES (?,?,?)',
      ).run(id, row.id, now());
    }
  }
  private change(tx: Mutation, row: Row, status: CaseStatus) {
    tx.prepare('UPDATE norby_cases SET status=?,version=version+1,updated_at=? WHERE id=?').run(
      status,
      now(),
      row.id,
    );
  }
  private async operation<T>(
    actor: Actor,
    key: string,
    input: unknown,
    run: (tx: Mutation) => Promise<T>,
  ): Promise<T> {
    requireCondition(/^[A-Za-z0-9_-]{16,100}$/.test(key), 'IDEMPOTENCY_KEY_REQUIRED', 400);
    const fingerprint = digest(JSON.stringify(input));
    const previous = async () => {
      const prior = await statement(
        this.db,
        'SELECT fingerprint,result FROM norby_operations WHERE actor_id=? AND key=?',
        actor.id,
        key,
      ).first<{ fingerprint: string; result: string }>();
      if (prior) requireCondition(prior.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT');
      return prior;
    };
    const prior = await previous();
    if (prior) return JSON.parse(prior.result) as T;
    const tx = new Mutation(this.db);
    try {
      const result = await run(tx);
      tx.prepare('INSERT INTO norby_operations VALUES (?,?,?,?)').run(
        actor.id,
        key,
        fingerprint,
        JSON.stringify(result),
      );
      await tx.commit();
      return result;
    } catch (error) {
      // A parallel request (or a committed response lost in transit) may already have completed this key.
      const committed = await previous();
      if (committed) return JSON.parse(committed.result) as T;
      throw error;
    }
  }
  async create(actor: Actor, input: unknown, key: string): Promise<CaseView> {
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
    const result = await this.operation(actor, key, { operation: 'create', value }, async (tx) => {
      const id = randomUUID(),
        date = now();
      const reference = `NB-${date.slice(0, 4)}-${randomUUID().slice(0, 8).toUpperCase()}`;
      tx.prepare(
        'INSERT INTO norby_cases (id,reference,owner_id,status,locale,currency,version,revision,data,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
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
      this.event(tx, { id }, actor, 'case_created');
      return { id };
    });
    return this.get(actor, result.id);
  }
  private async snapshot(actor: Actor, id: string): Promise<{ row: Row; view: CaseView }> {
    const rows = await this.db.batch([
      statement(this.db, 'SELECT * FROM norby_cases WHERE id=?', id),
      statement(
        this.db,
        'SELECT id,kind,name,type,size,person_id as personId,created_at as createdAt FROM norby_files WHERE case_id=? ORDER BY created_at DESC',
        id,
      ),
      statement(
        this.db,
        'SELECT id,action,actor_kind as actorKind,note,created_at as createdAt FROM norby_events WHERE case_id=? ORDER BY created_at DESC,rowid DESC',
        id,
      ),
      statement(
        this.db,
        'SELECT id,kind,currency,amount,reference,entity,created_at as createdAt FROM norby_ledger WHERE case_id=? ORDER BY created_at',
        id,
      ),
    ]);
    const r = rows[0].results[0] as unknown as Row | undefined;
    requireCondition(r, 'CASE_NOT_FOUND', 404);
    this.access(actor, r);
    return {
      row: r,
      view: this.view(
        r,
        rows[1].results as CaseView['files'],
        rows[2].results as CaseView['events'],
        rows[3].results as CaseView['ledger'],
      ),
    };
  }
  private view(
    r: Row,
    files: CaseView['files'],
    events: CaseView['events'],
    ledger: CaseView['ledger'],
  ): CaseView {
    const data = applicationSchema.parse(JSON.parse(this.vault.open(r.data, r.id).toString()));
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
      files,
      events,
      ledger,
    };
  }
  async get(actor: Actor, id: string): Promise<CaseView> {
    return (await this.snapshot(actor, id)).view;
  }
  async list(actor: Actor): Promise<CaseView[]> {
    if (actor.kind === 'agent')
      requireCondition(actor.scopes?.includes('cases:read'), 'INSUFFICIENT_SCOPE', 403);
    const owner = actor.kind === 'staff' ? '' : ' WHERE owner_id=?';
    const params: SqlValue[] = actor.kind === 'staff' ? [] : [actor.id];
    const scope = ` WHERE case_id IN (SELECT id FROM norby_cases${owner})`;
    // One consistent snapshot avoids both cross-case drift and N+1 D1 subrequests.
    const rows = await this.db.batch<Record<string, unknown>>([
      statement(this.db, `SELECT * FROM norby_cases${owner} ORDER BY updated_at DESC`, ...params),
      statement(
        this.db,
        `SELECT case_id,id,kind,name,type,size,person_id as personId,created_at as createdAt FROM norby_files${scope} ORDER BY created_at DESC`,
        ...params,
      ),
      statement(
        this.db,
        `SELECT case_id,id,action,actor_kind as actorKind,note,created_at as createdAt FROM norby_events${scope} ORDER BY created_at DESC,rowid DESC`,
        ...params,
      ),
      statement(
        this.db,
        `SELECT case_id,id,kind,currency,amount,reference,entity,created_at as createdAt FROM norby_ledger${scope} ORDER BY created_at`,
        ...params,
      ),
    ]);
    const group = <T>(records: Record<string, unknown>[]) => {
      const grouped = new Map<string, T[]>();
      for (const { case_id, ...record } of records) {
        const id = String(case_id),
          list = grouped.get(id) || [];
        list.push(record as T);
        grouped.set(id, list);
      }
      return grouped;
    };
    const files = group<CaseView['files'][number]>(rows[1].results);
    const events = group<CaseView['events'][number]>(rows[2].results);
    const ledger = group<CaseView['ledger'][number]>(rows[3].results);
    return (rows[0].results as unknown as Row[]).map((row) => {
      this.access(actor, row);
      return this.view(
        row,
        files.get(row.id) || [],
        events.get(row.id) || [],
        ledger.get(row.id) || [],
      );
    });
  }
  async update(actor: Actor, id: string, input: unknown, key: string) {
    const value = z
      .object({ version: z.number().int(), data: applicationSchema })
      .strict()
      .parse(input);
    await this.operation(actor, key, { operation: 'update', id, value }, async (tx) => {
      const r = await this.row(id);
      this.access(actor, r, true);
      requireCondition(r.version === value.version, 'VERSION_CONFLICT');
      requireCondition(
        ['draft', 'needs_information', 'awaiting_payment', 'payment_check'].includes(r.status),
        'CASE_LOCKED',
      );
      tx.caseVersion(id, r.version);
      tx.prepare(
        'UPDATE norby_cases SET data=?,revision=revision+1,version=version+1,validated_xml=NULL,signed_xml=NULL,signed_revision=NULL,approved_revision=NULL,updated_at=? WHERE id=?',
      ).run(this.vault.seal(JSON.stringify(value.data), id), now(), id);
      this.event(tx, r, actor, 'information_updated');
      return { id };
    });
    return this.get(actor, id);
  }
  async prices(): Promise<Price[]> {
    const rows = await statement(this.db, 'SELECT payload FROM norby_prices').all<{
      payload: string;
    }>();
    return rows.results.map((p) => JSON.parse(p.payload));
  }
  async configurePrice(actor: Actor, input: unknown): Promise<Price> {
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
    const price = { ...value, version: 1 };
    makeQuote(price);
    const row = await statement(
      this.db,
      `INSERT INTO norby_prices (currency,payload) VALUES (?,?) ON CONFLICT(currency) DO UPDATE SET payload=json_set(excluded.payload,'$.version',json_extract(norby_prices.payload,'$.version')+1) RETURNING payload`,
      price.currency,
      JSON.stringify(price),
    ).first<{ payload: string }>();
    requireCondition(row, 'PRICE_NOT_CONFIGURED');
    return JSON.parse(row.payload);
  }
  async organisation(): Promise<OrganisationSettings> {
    const row = await statement(
      this.db,
      "SELECT payload FROM norby_settings WHERE id='organisation'",
    ).first<{ payload: string }>();
    return row ? JSON.parse(row.payload) : defaultOrganisation;
  }
  async configureOrganisation(actor: Actor, value: OrganisationSettings) {
    this.staff(actor);
    await statement(
      this.db,
      "INSERT INTO norby_settings VALUES ('organisation',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
      JSON.stringify(value),
    ).run();
    return value;
  }
  private ledger(
    tx: Mutation,
    r: Row,
    actor: Actor,
    kind: string,
    currency: string,
    amount: number,
    reference: string,
    entity: string,
  ) {
    requireCondition(reference.trim().length >= 3, 'REFERENCE_REQUIRED', 400);
    tx.prepare('INSERT INTO norby_ledger VALUES (?,?,?,?,?,?,?,?,?)').run(
      randomUUID(),
      r.id,
      kind,
      currency,
      amount,
      reference.trim(),
      entity,
      actor.id,
      now(),
    );
  }
  private async hasSubmission(id: string) {
    return !!(await statement(
      this.db,
      "SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit'",
      id,
    ).first());
  }
  async action(actor: Actor, id: string, input: unknown, key: string) {
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
    await this.operation(actor, key, { operation: 'action', id, v }, async (tx) => {
      const { row: r, view: c } = await this.snapshot(actor, id);
      this.access(actor, r, true);
      requireCondition(r.version === v.version, 'VERSION_CONFLICT');
      tx.caseVersion(id, r.version);
      const q = c.quote;
      switch (v.action) {
        case 'checkout': {
          this.human(actor);
          requireCondition(r.status === 'draft', 'INVALID_STATE');
          requireCondition(c.issues.length === 0, 'INCOMPLETE_APPLICATION');
          requireCondition(v.checks.includes('service_terms'), 'TERMS_REQUIRED', 400);
          const price = (await this.prices()).find((p) => p.currency === r.currency);
          requireCondition(price, 'PRICE_NOT_CONFIGURED');
          const quote = makeQuote(price);
          tx.prepare('UPDATE norby_cases SET quote=? WHERE id=?').run(JSON.stringify(quote), id);
          this.change(tx, r, 'awaiting_payment');
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
          this.change(tx, r, 'payment_check');
          break;
        case 'confirm_payment':
          this.staff(actor);
          requireCondition(
            ['awaiting_payment', 'payment_check'].includes(r.status) && q && !r.paid,
            'INVALID_STATE',
          );
          requireCondition(v.amount === q.total, 'PAYMENT_AMOUNT_MISMATCH');
          this.ledger(tx, r, actor, 'customer_payment', r.currency, q.total, v.reference, q.entity);
          tx.prepare('UPDATE norby_cases SET paid=1 WHERE id=?').run(id);
          this.change(tx, r, 'under_review');
          break;
        case 'request_information':
          this.staff(actor);
          requireCondition(
            ['under_review', 'awaiting_signatures', 'ready_to_submit'].includes(r.status),
            'INVALID_STATE',
          );
          requireCondition(v.note, 'NOTE_REQUIRED');
          tx.prepare(
            'UPDATE norby_cases SET approved_revision=NULL,validated_xml=NULL,signed_xml=NULL,signed_revision=NULL WHERE id=?',
          ).run(id);
          this.change(tx, r, 'needs_information');
          break;
        case 'resubmit':
          requireCondition(r.status === 'needs_information' && r.paid, 'INVALID_STATE');
          requireCondition(c.issues.length === 0, 'INCOMPLETE_APPLICATION');
          this.change(tx, r, 'under_review');
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
          tx.prepare('UPDATE norby_cases SET approved_revision=revision WHERE id=?').run(id);
          this.change(tx, r, 'awaiting_signatures');
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
          requireCondition(!(await this.hasSubmission(id)), 'SUBMISSION_ALREADY_ATTEMPTED');
          requireCondition(v.note, 'NOTE_REQUIRED');
          this.change(tx, r, 'refund_pending');
          break;
        case 'confirm_refund':
          this.staff(actor);
          requireCondition(r.status === 'refund_pending' && q, 'INVALID_STATE');
          requireCondition(v.amount === q.total, 'FULL_REFUND_REQUIRED');
          this.ledger(tx, r, actor, 'customer_refund', r.currency, q.total, v.reference, q.entity);
          this.change(tx, r, 'refunded');
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
          await this.enqueue(tx, r, 'validate');
          this.change(tx, r, r.status);
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
          await this.enqueue(tx, r, 'submit');
          this.change(tx, r, 'submitting');
          break;
        case 'queue_status':
          this.staff(actor);
          requireCondition(
            ['submitted', 'verification_required', 'needs_correction'].includes(r.status) &&
              r.registry_case_no,
            'CASE_REFERENCE_REQUIRED',
          );
          await this.enqueue(tx, r, 'status');
          this.change(tx, r, r.status);
          break;
        case 'reconcile_submission':
          this.staff(actor);
          requireCondition(
            r.status === 'verification_required' &&
              r.paid &&
              !c.ledger.some((l) => l.kind === 'government_debit') &&
              (await this.hasSubmission(id)),
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
          this.ledger(tx, r, actor, 'government_debit', 'HKD', v.amount, v.reference, 'HK_TPSI');
          tx.prepare('UPDATE norby_cases SET registry_case_no=?,brn=? WHERE id=?').run(
            v.registryCaseNo,
            v.brn || null,
            id,
          );
          this.change(tx, r, 'submitted');
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
          tx.prepare('UPDATE norby_cases SET brn=?,registry_case_no=? WHERE id=?').run(
            v.brn,
            v.registryCaseNo,
            id,
          );
          this.change(tx, r, 'completed');
          break;
      }
      this.event(
        tx,
        r,
        actor,
        v.action,
        v.note || (['report_payment'].includes(v.action) ? v.reference : ''),
      );
      return { id };
    });
    return this.get(actor, id);
  }
  /** Reserve before upload, so interrupted uploads remain discoverable and safe to collect. */
  private async putObject(
    caseId: string,
    value: string | Uint8Array,
    context: string,
  ): Promise<StoredObject> {
    const object = { id: randomUUID(), object_key: `cases/${caseId}/${randomUUID()}` };
    await statement(
      this.db,
      "INSERT INTO norby_objects (id,case_id,object_key,status,expires_at,created_at) VALUES (?,?,?,'pending',?,?)",
      object.id,
      caseId,
      object.object_key,
      Date.now() + 60 * 60 * 1000,
      now(),
    ).run();
    try {
      await this.bucket.put(object.object_key, this.vault.seal(value, context), {
        httpMetadata: { contentType: 'application/octet-stream' },
        customMetadata: { encryption: 'aes-256-gcm-v1' },
      });
      return object;
    } catch (error) {
      await this.discardObject(object).catch(() => {});
      throw error;
    }
  }
  private commitObject(tx: Mutation, object: StoredObject) {
    tx.guard(
      "EXISTS (SELECT 1 FROM norby_objects WHERE id=? AND status='pending')",
      [object.id],
      'UPLOAD_EXPIRED',
    );
    tx.prepare("UPDATE norby_objects SET status='committed',expires_at=NULL WHERE id=?").run(
      object.id,
    );
  }
  private async discardObject(object: StoredObject): Promise<void> {
    const claimed = await statement(
      this.db,
      "UPDATE norby_objects SET status='cleanup',expires_at=0 WHERE id=? AND status IN ('pending','cleanup') RETURNING object_key",
      object.id,
    ).first<{ object_key: string }>();
    if (!claimed) return; // Committed objects are never deleted, including after an ambiguous D1 response.
    await this.bucket.delete(claimed.object_key);
    // Retain a tombstone: an upload whose response was lost can still finish after a delete.
    // Rechecking tombstones also collects those late writes without ever touching committed data.
    await statement(
      this.db,
      "UPDATE norby_objects SET expires_at=? WHERE id=? AND status='cleanup'",
      Date.now() + 6 * 60 * 60 * 1000,
      object.id,
    ).run();
  }
  private async commitStored(tx: Mutation, object: StoredObject): Promise<void> {
    this.commitObject(tx, object);
    try {
      await tx.commit();
    } catch (error) {
      // The marker commits in the same transaction as the visible data. It resolves lost responses.
      let committed = false;
      try {
        const state = await statement(
          this.db,
          'SELECT status FROM norby_objects WHERE id=?',
          object.id,
        ).first<{ status: string }>();
        committed = state?.status === 'committed';
        if (!committed) await this.discardObject(object);
      } catch {
        /* Leave the encrypted object journaled if either service is unavailable. */
      }
      if (!committed) throw error;
    }
  }
  async cleanupOrphanObjects(before = Date.now()): Promise<number> {
    const objects = await statement(
      this.db,
      "SELECT id,object_key FROM norby_objects WHERE status IN ('pending','cleanup') AND expires_at<=? ORDER BY expires_at LIMIT 50",
      Math.min(before, Date.now()),
    ).all<StoredObject>();
    let removed = 0;
    for (const object of objects.results) {
      await this.discardObject(object);
      removed++;
    }
    return removed;
  }
  private async readObject(key: string, context: string): Promise<Buffer> {
    const object = await this.bucket.get(key);
    requireCondition(object, 'FILE_NOT_FOUND', 404);
    return this.vault.open(await object.arrayBuffer(), context);
  }
  async addFile(
    actor: Actor,
    id: string,
    kind: FileKind,
    name: string,
    value: Buffer | Uint8Array,
    personId: string | null,
  ) {
    const { row: r, view } = await this.snapshot(actor, id);
    this.access(actor, r, true);
    this.human(actor);
    const cert = kind === 'ci' || kind === 'br' || kind === 'registry_receipt';
    if (cert) {
      this.staff(actor);
      requireCondition(['submitted', 'verification_required'].includes(r.status), 'INVALID_STATE');
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
    const content = Buffer.from(value);
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
        personId && view.data.people.some((p) => p.id === personId),
        'PERSON_REQUIRED',
        400,
      );
    const fileId = randomUUID();
    const safeName = name.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'document';
    const object = await this.putObject(id, content, fileId);
    const tx = new Mutation(this.db);
    tx.caseVersion(id, r.version);
    tx.prepare(
      'INSERT INTO norby_files (id,case_id,kind,name,type,size,person_id,object_key,uploaded_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      fileId,
      id,
      kind,
      safeName,
      type,
      content.length,
      personId,
      object.object_key,
      actor.id,
      now(),
    );
    this.change(tx, r, r.status);
    this.event(tx, r, actor, 'document_uploaded', kind);
    await this.commitStored(tx, object);
    return this.get(actor, id);
  }
  async file(
    actor: Actor,
    id: string,
    fileId: string,
  ): Promise<{ content: Buffer; name: string; type: string }> {
    this.access(actor, await this.row(id));
    this.human(actor);
    const file = await statement(
      this.db,
      'SELECT name,type,object_key FROM norby_files WHERE id=? AND case_id=?',
      fileId,
      id,
    ).first<{ name: string; type: string; object_key: string }>();
    requireCondition(file, 'FILE_NOT_FOUND', 404);
    return {
      name: file.name,
      type: file.type,
      content: await this.readObject(file.object_key, fileId),
    };
  }
  private async enqueue(tx: Mutation, r: Row, operation: Job['operation']) {
    const active = await statement(
      this.db,
      "SELECT 1 FROM norby_jobs WHERE case_id=? AND status IN ('queued','running')",
      r.id,
    ).first();
    requireCondition(!active, 'JOB_IN_PROGRESS');
    tx.guard(
      "NOT EXISTS (SELECT 1 FROM norby_jobs WHERE case_id=? AND status IN ('queued','running'))",
      [r.id],
      'JOB_IN_PROGRESS',
    );
    if (operation === 'submit') {
      const previous = await statement(
        this.db,
        "SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit' AND revision=?",
        r.id,
        r.revision,
      ).first();
      requireCondition(!previous, 'SUBMISSION_ALREADY_ATTEMPTED');
      tx.guard(
        "NOT EXISTS (SELECT 1 FROM norby_jobs WHERE case_id=? AND operation='submit' AND revision=?)",
        [r.id, r.revision],
        'SUBMISSION_ALREADY_ATTEMPTED',
      );
    }
    const t = now();
    tx.prepare(
      'INSERT INTO norby_jobs (id,case_id,operation,revision,status,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(randomUUID(), r.id, operation, r.revision, 'queued', null, t, t);
  }
  async pendingJobs(limit = 25): Promise<Job[]> {
    const rows = await statement(
      this.db,
      "SELECT * FROM norby_jobs WHERE status='queued' ORDER BY created_at LIMIT ?",
      Math.max(1, Math.min(100, Math.trunc(limit))),
    ).all<Job>();
    return rows.results;
  }
  async job(id: string): Promise<Job | null> {
    return statement(this.db, 'SELECT * FROM norby_jobs WHERE id=?', id).first<Job>();
  }
  async claimJob(id: string, leaseMs = 600000): Promise<Job | null> {
    requireCondition(
      Number.isFinite(leaseMs) && leaseMs > 0 && leaseMs <= 3600000,
      'INVALID_LEASE',
      400,
    );
    return statement(
      this.db,
      `UPDATE norby_jobs SET status='running',lease_token=?,lease_expires_at=${sqlNow}+?,updated_at=? WHERE id=? AND status='queued' RETURNING *`,
      randomUUID(),
      leaseMs,
      now(),
      id,
    ).first<Job>();
  }
  async nextJob(): Promise<Job | null> {
    for (const job of await this.pendingJobs(10)) {
      const claimed = await this.claimJob(job.id);
      if (claimed) return claimed;
    }
    return null;
  }
  private jobGuard(
    tx: Mutation,
    caseId: string,
    lease: JobLease | undefined,
    operation?: Job['operation'],
    recordResult = false,
  ) {
    if (!lease) return;
    const predicate = `EXISTS (SELECT 1 FROM norby_jobs WHERE id=? AND case_id=? AND lease_token=? AND status='running' AND lease_expires_at>${sqlNow}${operation ? ' AND operation=?' : ''}${recordResult ? ' AND result_committed_at IS NULL' : ''})`;
    const values: SqlValue[] = [lease.id, caseId, lease.token];
    if (operation) values.push(operation);
    tx.guard(predicate, values, 'JOB_LEASE_LOST');
    if (recordResult)
      tx.prepare('UPDATE norby_jobs SET result_committed_at=? WHERE id=?').run(now(), lease.id);
  }
  async finishJob(jobId: string, error?: string, leaseToken?: string): Promise<void> {
    const job = await this.job(jobId);
    requireCondition(job, 'JOB_NOT_FOUND', 404);
    // Leased jobs may only be finished by the claimant. Repeated acknowledgements are harmless.
    requireCondition(leaseToken && job.lease_token === leaseToken, 'JOB_LEASE_LOST');
    if (job.status === 'completed' || job.status === 'failed') return;
    const tx = new Mutation(this.db);
    this.jobGuard(tx, job.case_id, { id: jobId, token: leaseToken });
    tx.prepare('UPDATE norby_jobs SET status=?,error=?,updated_at=? WHERE id=?').run(
      error ? 'failed' : 'completed',
      error || null,
      now(),
      jobId,
    );
    if (error) this.event(tx, { id: job.case_id }, internal, 'official_request_failed', error);
    await tx.commit();
  }
  async internalCase(id: string): Promise<CaseView> {
    return this.get(internal, id);
  }
  async tpsiXml(id: string, signed = false): Promise<string> {
    const row = await this.row(id);
    const key = signed ? row.signed_xml : row.validated_xml;
    requireCondition(key, 'VALIDATED_DOCUMENT_REQUIRED');
    return (await this.readObject(key, `${id}:xml`)).toString();
  }
  async recordValidation(
    id: string,
    revision: number,
    xml: string,
    lease?: JobLease,
  ): Promise<void> {
    const r = await this.row(id);
    requireCondition(
      r.revision === revision &&
        r.approved_revision === revision &&
        r.status === 'awaiting_signatures',
      'STALE_REVISION',
    );
    const object = await this.putObject(id, xml, `${id}:xml`);
    const tx = new Mutation(this.db);
    tx.caseVersion(id, r.version, 'STALE_REVISION');
    this.jobGuard(tx, id, lease, 'validate', true);
    tx.prepare(
      'UPDATE norby_cases SET validated_xml=?,version=version+1,updated_at=? WHERE id=?',
    ).run(object.object_key, now(), id);
    this.event(tx, r, internal, 'official_validation_completed');
    await this.commitStored(tx, object);
  }
  async claimSigning(
    id: string,
    actor: Actor,
    version: number,
    token: string,
    expiresAt: number,
  ): Promise<boolean> {
    this.human(actor);
    const r = await this.row(id);
    requireCondition(
      r.version === version &&
        r.status === 'awaiting_signatures' &&
        r.validated_xml &&
        r.approved_revision === r.revision,
      'STALE_REVISION',
    );
    const data = applicationSchema.parse(JSON.parse(this.vault.open(r.data, id).toString()));
    requireCondition(
      actor.email &&
        data.people.some(
          (p) =>
            (p.director || p.id === data.founderSignerId) &&
            p.email.toLowerCase() === actor.email!.toLowerCase(),
        ),
      'SIGNER_ACCOUNT_REQUIRED',
      403,
    );
    requireCondition(
      token.length >= 16 &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now() &&
        expiresAt <= Date.now() + 3600000,
      'INVALID_LEASE',
      400,
    );
    const result = await statement(
      this.db,
      `INSERT INTO norby_signing_leases (case_id,token,expires_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM norby_cases WHERE id=? AND version=? AND status='awaiting_signatures' AND validated_xml IS NOT NULL) ON CONFLICT(case_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE norby_signing_leases.expires_at<=${sqlNow} RETURNING token`,
      id,
      token,
      expiresAt,
      id,
      version,
    ).first<{ token: string }>();
    return result?.token === token;
  }
  async releaseSigning(id: string, token: string): Promise<void> {
    await statement(
      this.db,
      'DELETE FROM norby_signing_leases WHERE case_id=? AND token=?',
      id,
      token,
    ).run();
  }
  async recordSignature(
    id: string,
    revision: number,
    xml: string,
    complete: boolean,
    version: number,
    leaseToken?: string,
  ): Promise<void> {
    const r = await this.row(id);
    requireCondition(
      r.version === version &&
        r.revision === revision &&
        r.approved_revision === revision &&
        r.status === 'awaiting_signatures',
      'STALE_REVISION',
    );
    const object = await this.putObject(id, xml, `${id}:xml`);
    const tx = new Mutation(this.db);
    tx.caseVersion(id, version, 'STALE_REVISION');
    if (leaseToken)
      tx.guard(
        `EXISTS (SELECT 1 FROM norby_signing_leases WHERE case_id=? AND token=? AND expires_at>${sqlNow})`,
        [id, leaseToken],
        'SIGNING_LEASE_LOST',
      );
    tx.prepare(
      'UPDATE norby_cases SET validated_xml=?,signed_xml=?,signed_revision=? WHERE id=?',
    ).run(object.object_key, complete ? object.object_key : null, complete ? revision : null, id);
    this.change(tx, r, complete ? 'ready_to_submit' : 'awaiting_signatures');
    this.event(tx, r, internal, 'official_signature_verified');
    await this.commitStored(tx, object);
  }
  async recordSubmission(
    id: string,
    receipt: { caseNo: string; reference: string; amount: number; brn?: string },
    raw: string,
    lease?: JobLease,
  ): Promise<void> {
    const r = await this.row(id);
    requireCondition(r.status === 'submitting', 'INVALID_STATE');
    requireCondition(
      Number.isSafeInteger(receipt.amount) && receipt.amount > 0,
      'INVALID_AMOUNT',
      400,
    );
    const object = await this.putObject(id, raw, `${id}:receipt`);
    const tx = new Mutation(this.db);
    tx.caseVersion(id, r.version);
    this.jobGuard(tx, id, lease, 'submit', true);
    this.ledger(
      tx,
      r,
      internal,
      'government_debit',
      'HKD',
      receipt.amount,
      receipt.reference,
      'HK_TPSI',
    );
    tx.prepare(
      'INSERT INTO norby_registry_receipts (case_id,object_key,created_at) VALUES (?,?,?)',
    ).run(id, object.object_key, now());
    tx.prepare('UPDATE norby_cases SET registry_case_no=?,brn=? WHERE id=?').run(
      receipt.caseNo,
      receipt.brn || null,
      id,
    );
    this.change(tx, r, 'submitted');
    this.event(tx, r, internal, 'official_submission_receipt');
    await this.commitStored(tx, object);
  }
  async recordStatus(
    id: string,
    status: 'Lodged' | 'Pending re-lodged' | 'Re-lodged' | 'unknown',
    lease?: JobLease,
  ): Promise<void> {
    const r = await this.row(id);
    requireCondition(
      ['submitted', 'verification_required', 'needs_correction'].includes(r.status),
      'INVALID_STATE',
    );
    const tx = new Mutation(this.db);
    tx.caseVersion(id, r.version);
    this.jobGuard(tx, id, lease, 'status', true);
    this.change(
      tx,
      r,
      status === 'unknown'
        ? 'verification_required'
        : status === 'Pending re-lodged'
          ? 'needs_correction'
          : 'submitted',
    );
    this.event(tx, r, internal, 'official_status_updated', status);
    await tx.commit();
  }
  async submissionUncertain(id: string, lease?: JobLease): Promise<void> {
    const r = await this.row(id);
    if (r.status !== 'submitting') return;
    const tx = new Mutation(this.db);
    tx.caseVersion(id, r.version);
    this.jobGuard(tx, id, lease, 'submit');
    this.change(tx, r, 'verification_required');
    this.event(
      tx,
      r,
      internal,
      'submission_result_unknown',
      'Norby must reconcile the official result before any further submission.',
    );
    await tx.commit();
  }
  async recoverInterruptedJobs(cutoff = Date.now()): Promise<number> {
    const rows = await statement(
      this.db,
      "SELECT * FROM norby_jobs WHERE status='running' AND lease_expires_at<=? LIMIT 50",
      Math.min(cutoff, Date.now()),
    ).all<Job>();
    let recovered = 0;
    for (const job of rows.results) {
      const r = await this.row(job.case_id);
      const tx = new Mutation(this.db);
      tx.caseVersion(r.id, r.version);
      tx.guard(
        `EXISTS (SELECT 1 FROM norby_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_expires_at<=? AND lease_expires_at<=${sqlNow})`,
        [job.id, job.lease_token, cutoff],
        'JOB_LEASE_LOST',
      );
      if (!job.result_committed_at && job.operation === 'submit' && r.status === 'submitting') {
        this.change(tx, r, 'verification_required');
        this.event(
          tx,
          r,
          internal,
          'submission_result_unknown',
          'Norby must reconcile the official result before any further submission.',
        );
      }
      if (job.result_committed_at) {
        // A result and its marker commit together. A lost acknowledgement must not repeat it.
        tx.prepare(
          "UPDATE norby_jobs SET status='completed',error=NULL,updated_at=? WHERE id=?",
        ).run(now(), job.id);
      } else if (job.operation === 'submit') {
        tx.prepare(
          "UPDATE norby_jobs SET status='failed',error='WORKER_INTERRUPTED',updated_at=? WHERE id=?",
        ).run(now(), job.id);
        this.event(tx, r, internal, 'official_request_failed', 'WORKER_INTERRUPTED');
      } else {
        // Validation and status queries are safe to repeat only when no result was persisted.
        tx.prepare(
          "UPDATE norby_jobs SET status='queued',error=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?",
        ).run(now(), job.id);
      }
      try {
        await tx.commit();
        recovered++;
      } catch (error) {
        if (!(
          error instanceof DomainError &&
          ['VERSION_CONFLICT', 'JOB_LEASE_LOST'].includes(error.code)
        ))
          throw error;
      }
    }
    return recovered;
  }
}
export { CloudflareCaseService as CaseService };
