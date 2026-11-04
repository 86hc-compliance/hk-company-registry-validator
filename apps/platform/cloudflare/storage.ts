import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { DomainError } from '../shared/domain.js';

export type SqlValue = string | number | null | Uint8Array | ArrayBuffer;
export type StoredBytes = number[] | Uint8Array | ArrayBuffer;

export function bytes(value: StoredBytes): Buffer {
  return Array.isArray(value)
    ? Buffer.from(value)
    : Buffer.from(
        new Uint8Array(
          value instanceof ArrayBuffer
            ? value
            : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
        ),
      );
}

export function statement(db: D1Database, sql: string, ...values: SqlValue[]) {
  return db
    .prepare(sql)
    .bind(...values.map((value) => (value instanceof Uint8Array ? Array.from(value) : value)));
}

export function digest(value: string | Uint8Array) {
  return createHash('sha256').update(Buffer.from(value)).digest('hex');
}

export class Vault {
  private key: Buffer;
  constructor(key: string) {
    this.key = Buffer.from(key, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to 32 bytes');
  }
  seal(value: string | Uint8Array, context: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }
  open(value: StoredBytes, context: string): Buffer {
    const input = bytes(value);
    const cipher = createDecipheriv('aes-256-gcm', this.key, input.subarray(0, 12));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(input.subarray(12, 28));
    return Buffer.concat([cipher.update(Buffer.from(input.subarray(28))), cipher.final()]);
  }
}

/** D1 batches are transactions. A failed CHECK guard rolls back every statement. */
export class Mutation {
  private writes: D1PreparedStatement[] = [];
  private guards: { id: string; predicate: string; values: SqlValue[]; code: string }[] = [];
  constructor(private db: D1Database) {}
  prepare(sql: string) {
    return {
      run: (...values: SqlValue[]) => {
        this.writes.push(statement(this.db, sql, ...values));
      },
    };
  }
  guard(predicate: string, values: SqlValue[], code: string) {
    this.guards.push({ id: randomUUID(), predicate, values, code });
  }
  caseVersion(id: string, version: number, code = 'VERSION_CONFLICT') {
    this.guard('EXISTS (SELECT 1 FROM norby_cases WHERE id=? AND version=?)', [id, version], code);
  }
  async commit() {
    const guards = this.guards.map((g) =>
      statement(
        this.db,
        `INSERT INTO norby_transaction_guards (id, valid) VALUES (?, CASE WHEN (${g.predicate}) THEN 1 ELSE 0 END)`,
        g.id,
        ...g.values,
      ),
    );
    const cleanup = this.guards.map((g) =>
      statement(this.db, 'DELETE FROM norby_transaction_guards WHERE id=?', g.id),
    );
    try {
      const results = await this.db.batch([...guards, ...this.writes, ...cleanup]);
      if (results.some((r) => !r.success)) throw new Error('D1_BATCH_FAILED');
    } catch (error) {
      // Resolve a guard failure without treating connectivity errors as proof of rollback.
      if (/CHECK constraint failed/.test(String(error))) {
        for (const guard of this.guards) {
          const row = await statement(
            this.db,
            `SELECT CASE WHEN (${guard.predicate}) THEN 1 ELSE 0 END AS valid`,
            ...guard.values,
          ).first<{ valid: number }>();
          if (!row?.valid) throw new DomainError(guard.code, 409);
        }
      }
      if (/UNIQUE constraint failed: norby_ledger/.test(String(error)))
        throw new DomainError('DUPLICATE_REFERENCE', 409);
      if (/UNIQUE constraint failed: norby_jobs.case_id/.test(String(error)))
        throw new DomainError('JOB_IN_PROGRESS', 409);
      throw error;
    }
  }
}
