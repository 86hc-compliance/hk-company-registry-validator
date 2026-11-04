# Norby data on Cloudflare

The Cloudflare deployment uses its own D1 database (`DB`) and private R2 bucket (`DOCUMENTS`). The local Node backend continues to use local SQLite. Cloudflare stores document bytes, Registry XML and receipts in R2, with pointers and ownership metadata in D1.

## Initial deployment

Apply `apps/platform/migrations/0001_cases.sql` and the auth migration to the dedicated production database. This deployment starts empty; there is no existing real application data to import. **Do not import the local preview/demo SQLite database, test accounts, fictional payments, test certificates, or test Registry receipts into production.** Configure real prices, bank details and organisation settings through the staff interface. An unconfigured price blocks checkout.

Keep the R2 bucket private: no `r2.dev` access or public custom domain. Downloads pass through the authenticated Worker and enforce case ownership or staff access. OAuth agents cannot download identity files or perform human/staff confirmation actions.

A future migration of real legacy data requires a reviewed converter. Copying the SQLite file or executing its SQL dump is insufficient: local document BLOBs must become encrypted R2 objects, file/XML pointers must be converted, and all IDs, revisions, ledger references, audit events and submission-attempt records must be preserved.

## Encryption key and format

`DATA_ENCRYPTION_KEY` is a Worker secret containing a base64-encoded, cryptographically random 32-byte key. Keep a recoverable copy in the organisation's secret manager, separately from database/object backups. Losing it makes application data, documents, XML and receipts unreadable. Replacing it with a random value does not rotate existing data.

The AES-256-GCM envelope contains a 12-byte random IV, 16-byte authentication tag and ciphertext. Authenticated context is the case ID for application data, file ID for uploads, `${caseId}:xml` for Registry XML, and `${caseId}:receipt` for official receipts. The format is compatible with the local backend when the same key and context are supplied. Explicit Buffer input supports Workers' Node crypto implementation.

Object keys contain generated IDs, never customer names or filenames. Original filenames remain UTF-8 metadata in D1. Authentication rejects modified bytes, incorrect keys and cross-file substitution. Future key rotation must re-encrypt and verify every stored value; this release does not implement online rotation.

## Transactions and concurrency

Case-state changes, ledger entries, audit events, notification outbox rows and idempotency results commit in one D1 `batch()`. A CHECK-constrained assertion inside the batch verifies the expected case version and relevant job/signing lease. A failed assertion or foreign key rolls back every statement. D1 supplies [atomic batch execution](https://developers.cloudflare.com/d1/worker-api/d1-database/) and [enforced foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

SQL uniqueness enforces one ledger entry of each kind per case, unique references within each ledger kind/entity, one active job per case, and one submission attempt per revision. Accepted quotes stay independent from later price edits. `norby_operations` preserves each actor's idempotency key and request fingerprint; retries return the original result.

A case list uses one four-query snapshot including files, events and ledger. Direct D1 bindings are used without replica sessions. Application data stays encrypted in D1; large XML, receipts and documents use R2 to avoid D1's [2 MB row/value limit](https://developers.cloudflare.com/d1/platform/limits/).

## R2 failures and cleanup

An upload reserves a `norby_objects` row, then writes encrypted bytes to R2. Its visible metadata/pointer and `committed` marker share one guarded D1 transaction. Lost D1 responses are resolved by checking this marker. A failed/stale write claims the reservation for cleanup, fencing any later commit. R2 provides [strong object consistency](https://developers.cloudflare.com/r2/reference/consistency/).

The scheduler calls `cleanupOrphanObjects()` for up to 50 eligible entries per run. Pending reservations expire after one hour. Cleanup tombstones remain and are checked every six hours: a PUT whose response was lost might finish after the first delete. Committed objects, including earlier Registry XML versions, are retained. Do not add an age-based lifecycle deletion rule for production `cases/` objects without an explicit retention design.

## Registry recovery

An atomic `queued → running` claim issues a random token and ten-minute lease. Workflow steps have a five-minute timeout and no automatic external-operation retries. Result persistence checks the lease and atomically sets `result_committed_at` with the result.

When a lease expires:

- A committed result makes the job `completed`; its Registry operation is not repeated.
- An uncommitted validation/status query returns to `queued` with its lease cleared.
- An uncommitted submission becomes `failed`. A case still `submitting` becomes `verification_required`; an already submitted/completed case is preserved.

Never manually requeue a submission or delete its attempt history to allow another submission. A timeout may follow a real debit. Staff must obtain the official receipt and reconcile its case/reference/amount through the application before delivering verified certificates. Signing uses a separate durable lease, exact case version and authenticated signer email. Signer passwords never enter D1, R2 or Workflow payloads.

## Backups and restores

D1 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is automatic; current retention is [30 days on Workers Paid and 7 days on Free](https://developers.cloudflare.com/d1/platform/limits/). Record a bookmark before migrations and test restoration in isolation. Use Cloudflare's dashboard/API and the repository's current `cf` tooling; inspect installed CLI help for administrative syntax.

A recoverable backup requires a D1 export/bookmark, its R2 object keys/ciphertext, and the matching encryption key. D1 recovery does not restore R2 or secrets. Retain independent encrypted R2 copies with checksum inventories. An independent backup-copy schedule remains an operator responsibility; these modules do not provision one. Apply retention locks to a backup bucket so production orphan cleanup remains usable; see [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

Before restoring production, pause mutation traffic, Registry dispatch and orphan cleanup, then preserve the latest D1 export and R2 inventory. Restore matching database/object/key material in isolation first. Verify foreign keys, owner access, an encrypted download, ledger balances and known Registry receipts before resuming traffic.

**Database rollback does not undo bank transfers, refunds, email delivery or Registry submissions.** Reconcile operations after the restore point against the preserved latest database and external records before allowing them to execute again. An earlier database can omit a later submission-attempt guard: restore that history and reconcile uncertain submissions before enabling TPSI dispatch.

## Validation

`apps/platform/test/cloudflare-data.test.ts` uses real local workerd D1/R2 bindings to test concurrent idempotency, transaction/foreign-key rollback, payment/refund/reference uniqueness, quote immutability, owner/agent scopes, Chinese filenames, authenticated encryption, large XML, R2 failure/late-upload cleanup, durable signer leases, and crash recovery before/after result commit. The separate full Worker suite tests the deployed runtime path and crypto compatibility.
