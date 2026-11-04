import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`
    CREATE TABLE IF NOT EXISTS norby_cases (
      id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL,
      status TEXT NOT NULL, locale TEXT NOT NULL, currency TEXT NOT NULL, version INTEGER NOT NULL,
      revision INTEGER NOT NULL, data BLOB NOT NULL, quote TEXT, paid INTEGER NOT NULL DEFAULT 0,
      approved_revision INTEGER, validated_xml BLOB, signed_xml BLOB, signed_revision INTEGER,
      registry_case_no TEXT, brn TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS norby_prices (currency TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS norby_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS norby_files (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), kind TEXT NOT NULL,
      name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, person_id TEXT, content BLOB NOT NULL,
      uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS norby_events (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), actor_id TEXT NOT NULL,
      actor_kind TEXT NOT NULL, client_id TEXT, action TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS norby_ledger (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), kind TEXT NOT NULL,
      currency TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), reference TEXT NOT NULL,
      entity TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(case_id,kind), UNIQUE(kind,entity,reference)
    );
    CREATE TABLE IF NOT EXISTS norby_operations (
      actor_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(actor_id,key)
    );
    CREATE TABLE IF NOT EXISTS norby_jobs (
      id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), operation TEXT NOT NULL,
      revision INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS norby_cases_owner ON norby_cases(owner_id);
    CREATE INDEX IF NOT EXISTS norby_files_case ON norby_files(case_id);
    CREATE INDEX IF NOT EXISTS norby_events_case ON norby_events(case_id);
    CREATE TABLE IF NOT EXISTS norby_revocations (user_id TEXT NOT NULL, client_id TEXT NOT NULL, revoked_at INTEGER NOT NULL, PRIMARY KEY(user_id,client_id));
    CREATE TABLE IF NOT EXISTS norby_registry_receipts (case_id TEXT PRIMARY KEY REFERENCES norby_cases(id), content BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS norby_notifications (event_id TEXT PRIMARY KEY REFERENCES norby_events(id), case_id TEXT NOT NULL REFERENCES norby_cases(id), attempts INTEGER NOT NULL DEFAULT 0, sent_at TEXT, next_attempt_at TEXT NOT NULL, error TEXT);
  `);
  return db;
}
export class Vault {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to 32 bytes');
  }
  seal(value: Buffer | string, context: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  }
  open(value: Buffer, context: string): Buffer {
    const cipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
  }
}
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
