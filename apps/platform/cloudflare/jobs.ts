import { DomainError, requireCondition } from '../shared/domain.js';
import type { CloudflareCaseService, Job } from './cases.js';
import { buildNnc1, parseReceipt, parseStatus, type TpsiClient } from './tpsi.js';

type JobCases = Pick<
  CloudflareCaseService,
  | 'internalCase'
  | 'organisation'
  | 'tpsiXml'
  | 'recordValidation'
  | 'recordSubmission'
  | 'recordStatus'
  | 'submissionUncertain'
  | 'finishJob'
>;
export type RegistryClient = Pick<TpsiClient, 'validate' | 'submit' | 'status'>;
export type JobResult = {
  jobId: string;
  result: 'completed' | 'failed' | 'skipped';
  code?: string;
};

/** Runs one claimed, revision-bound operation. No network operation is retried here. */
export async function processClaimedJob(
  cases: JobCases,
  job: Job,
  client: RegistryClient,
): Promise<JobResult> {
  requireCondition(
    job.status === 'running' &&
      job.lease_token &&
      job.lease_expires_at &&
      job.lease_expires_at > Date.now(),
    'JOB_LEASE_EXPIRED',
  );
  const lease = { id: job.id, token: job.lease_token };
  try {
    const c = await cases.internalCase(job.case_id);
    requireCondition(c.revision === job.revision, 'STALE_REVISION');
    if (job.operation === 'validate') {
      requireCondition(c.status === 'awaiting_signatures', 'STALE_REVISION');
      const xml = buildNnc1(c.data, await cases.organisation());
      await cases.recordValidation(c.id, job.revision, await client.validate(xml), lease);
    } else if (job.operation === 'submit') {
      requireCondition(c.status === 'submitting', 'STALE_REVISION');
      const raw = await client.submit(await cases.tpsiXml(c.id, true));
      await cases.recordSubmission(c.id, parseReceipt(raw), raw, lease);
    } else if (job.operation === 'status') {
      requireCondition(
        ['submitted', 'verification_required', 'needs_correction'].includes(c.status),
        'INVALID_STATE',
      );
      requireCondition(c.registryCaseNo, 'CASE_REFERENCE_REQUIRED');
      const raw = await client.status(c.registryCaseNo, c.brn || '');
      await cases.recordStatus(c.id, parseStatus(raw, c.registryCaseNo), lease);
    } else {
      throw new DomainError('UNKNOWN_JOB');
    }
    await cases.finishJob(job.id, undefined, lease.token);
    return { jobId: job.id, result: 'completed' };
  } catch (error) {
    // A timeout, unreadable receipt, or failed commit can follow a real debit.
    // Keep the durable job running if either DB write fails: lease recovery
    // will reconcile the case and must never resubmit the official operation.
    if (job.operation === 'submit') await cases.submissionUncertain(job.case_id, lease);
    const code = error instanceof DomainError ? error.code : 'REGISTRY_CONNECTION_FAILED';
    await cases.finishJob(job.id, code, lease.token);
    return { jobId: job.id, result: 'failed', code };
  }
}
