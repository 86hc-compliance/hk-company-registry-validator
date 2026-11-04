PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS norby_cases (
  id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL,
  status TEXT NOT NULL, locale TEXT NOT NULL, currency TEXT NOT NULL, version INTEGER NOT NULL,
  revision INTEGER NOT NULL, data BLOB NOT NULL, quote TEXT, paid INTEGER NOT NULL DEFAULT 0,
  approved_revision INTEGER, validated_xml TEXT, signed_xml TEXT, signed_revision INTEGER,
  registry_case_no TEXT, brn TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS norby_prices (currency TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS norby_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS norby_files (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), kind TEXT NOT NULL,
  name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, person_id TEXT,
  object_key TEXT NOT NULL UNIQUE, uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS norby_events (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), actor_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL, client_id TEXT, action TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS norby_ledger (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), kind TEXT NOT NULL,
  currency TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), reference TEXT NOT NULL,
  entity TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(case_id,kind), UNIQUE(kind,entity,reference)
);
CREATE TABLE IF NOT EXISTS norby_operations (
  actor_id TEXT NOT NULL, key TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
  PRIMARY KEY(actor_id,key)
);
CREATE TABLE IF NOT EXISTS norby_jobs (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), operation TEXT NOT NULL,
  revision INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  lease_token TEXT, lease_expires_at INTEGER, result_committed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS norby_jobs_one_active ON norby_jobs(case_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS norby_jobs_one_submission ON norby_jobs(case_id,revision) WHERE operation='submit';
CREATE INDEX IF NOT EXISTS norby_jobs_pending ON norby_jobs(status,created_at);
CREATE INDEX IF NOT EXISTS norby_cases_owner ON norby_cases(owner_id);
CREATE INDEX IF NOT EXISTS norby_files_case ON norby_files(case_id);
CREATE INDEX IF NOT EXISTS norby_events_case ON norby_events(case_id);
CREATE TABLE IF NOT EXISTS norby_revocations (
  user_id TEXT NOT NULL, client_id TEXT NOT NULL, revoked_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,client_id)
);
CREATE TABLE IF NOT EXISTS norby_registry_receipts (
  case_id TEXT PRIMARY KEY REFERENCES norby_cases(id), object_key TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS norby_notifications (
  event_id TEXT PRIMARY KEY REFERENCES norby_events(id), case_id TEXT NOT NULL REFERENCES norby_cases(id),
  attempts INTEGER NOT NULL DEFAULT 0, sent_at TEXT, next_attempt_at TEXT NOT NULL, error TEXT,
  lease_token TEXT, lease_expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS norby_notifications_pending ON norby_notifications(sent_at,next_attempt_at);
CREATE TABLE IF NOT EXISTS norby_signing_leases (
  case_id TEXT PRIMARY KEY REFERENCES norby_cases(id), token TEXT NOT NULL, expires_at INTEGER NOT NULL
);
-- This CHECK is an assertion inside each atomic D1 batch, not a long-lived lock.
CREATE TABLE IF NOT EXISTS norby_transaction_guards (
  id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1)
);
-- An upload becomes visible only when its metadata and this committed marker are atomically written.
CREATE TABLE IF NOT EXISTS norby_objects (
  id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES norby_cases(id), object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','committed','cleanup')),
  expires_at INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS norby_objects_cleanup ON norby_objects(status,expires_at);
