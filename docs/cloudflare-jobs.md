# Cloudflare Registry jobs and transactional email

The Cloudflare entrypoint exports `RegistryJobsWorkflow` and binds it as `REGISTRY_JOBS`. D1 stores the durable job/outbox records; R2 stores encrypted Registry XML and receipts. The existing Node server remains available separately.

## Deployment state

`TPSI_MODE` is `disabled`; this migration does not configure real Registry credentials or make an official submission. `TPSI_USER_ID`, `TPSI_PASSWORD`, and `TPSI_DEPOSIT_ACCOUNT` must all be present before TPSI becomes ready. The password is a Worker secret. The configuration includes that secret binding when built with `NORBY_ENABLE_TPSI=1`.

Test mode requires `TPSI_TEST_DATA_ONLY=true`. Live TPSI requires `APP_ENV=production`, `TPSI_MODE=production`, and test-data mode off. Production email verification remains required when TPSI is in test mode.

The production scheduled handler runs every minute. It recovers expired job leases, dispatches queued jobs, delivers pending notices, and removes journaled orphan R2 objects. Staging has no automatic scheduled trigger in the deployment configuration.

## Official submission safety

- Workflow input contains only `{ jobId }`. Each step atomically claims the D1 job and checks the current case revision before contacting the Registry.
- The processing step has zero retries and a five-minute timeout. Its D1 lease lasts ten minutes. Result writes and completion are fenced by the lease token.
- A validation, status, or submission result records `result_committed_at` in the same D1 transaction. Recovery completes an interrupted job whose result already committed. Uncommitted validation/status jobs can be queued again without overwriting a successful result.
- An ambiguous submission, unreadable receipt, or interrupted submission moves a still-submitting case to `verification_required`. It is **never automatically submitted again**. A durable unique constraint also prevents another submission for that case revision.
- Staff must reconcile the actual Registry result and payment through the case workflow. Do not reset submission jobs to `queued`, delete their records, or replay the official HTTP request. Restarting the Cloudflare Workflow alone cannot bypass the D1 claim.

The live human signing request has its own five-minute D1 lease and exact-version check. Agent/OAuth actors cannot sign. Signer passwords remain in the live request's memory; they are never Workflow parameters, step outputs, D1 values, logs, or notification content. The encrypted signature fields required by TPSI remain part of the encrypted Registry XML.

## Retention and logs

Application-created Workflow instances retain state for one day after completion and seven days after a runtime error. Their persisted output is only the job ID, outcome, and a fixed error code. The durable D1 job record continues to prevent resubmission after Workflow retention expires. Case audit/financial records have separate persistence; this Workflow retention does not delete them.

The job layer logs dispatch failures with an opaque job ID. It never logs SOAP XML, token responses, credentials, identity data, or raw upstream errors. The HTTP configuration redacts query strings. Keep Email Sending preview capture disabled because verification/reset email bodies contain authentication links.

## Email delivery and recovery

`EMAIL.send()` uses Cloudflare Email Sending with `MAIL_FROM` and `BASE_URL`; the sending domain must be onboarded and the sender allowed by the binding. Authentication emails are sent during the request. Case notices come from the D1 transactional outbox and contain only the case reference, current status, and a sign-in link, in the case's language.

Outbox claims are atomic across concurrent Workers. Delivery attempts acquire a five-minute lease and use exponential backoff, with at most six attempts. An expired lease becomes eligible again. An email may be delivered twice if the provider accepts it immediately before a crash prevents the D1 acknowledgement; the delivery contract is at least once. `X-Norby-Event` provides correlation. Cloudflare controls `Message-ID`.

Use these read-only queries to inspect stalled work without selecting customer content:

```sql
SELECT operation,status,error,COUNT(*) AS count
FROM norby_jobs GROUP BY operation,status,error;

SELECT COUNT(*) AS exhausted_notices
FROM norby_notifications WHERE sent_at IS NULL AND attempts>=6;
```

Resolve sender/domain/provider issues before deliberately retrying exhausted notices. Email delivery recovery must never reset official submission jobs.

## Verification performed

Tests exercise real local workerd, native D1/R2, and a real Workflow instance. They verify XML-signature tamper detection, director-before-founder signing, RSA PKCS#1 and AES-ECB/GCM interoperability, concurrent dispatch, ambiguous submission recovery, replay prevention, outbox leases/backoff, and bilingual HTML/text messages. Official-network egress is intercepted by local fixtures; email sending is simulated. These tests establish runtime compatibility and application behavior, not production Registry acceptance or real inbox delivery.

The production `cf build` and local `cf workers check --prebuilt` also pass. Native fetch is bound to its global receiver, and redirects use `manual` with explicit non-success rejection, so credentials are never forwarded to a redirect target.

References: [Workflow API and retention](https://developers.cloudflare.com/workflows/build/workers-api/), [Workers crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/), [Email Sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [allowed email headers](https://developers.cloudflare.com/email-service/reference/headers/).
