import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { CloudflareCaseService } from './cases.js';
import type { CloudflareEnv } from './env.js';
import { processClaimedJob, type JobResult } from './jobs.js';
import { deliverNotifications } from './notifications.js';
import { liveClient, tpsiReady } from './tpsi.js';

export type RegistryJobParams = { jobId: string };
const service = (env: CloudflareEnv) =>
  new CloudflareCaseService(env.DB, env.DOCUMENTS, env.DATA_ENCRYPTION_KEY);

/** Only the opaque job ID is persisted by Workflows; XML and credentials stay in the step. */
export class RegistryJobsWorkflow extends WorkflowEntrypoint<CloudflareEnv, RegistryJobParams> {
  async run(event: WorkflowEvent<RegistryJobParams>, step: WorkflowStep): Promise<JobResult> {
    return step.do(
      'process-registry-job',
      { retries: { limit: 0, delay: '1 second' }, timeout: '5 minutes' },
      async (): Promise<JobResult> => {
        const { jobId } = event.payload;
        if (!tpsiReady(this.env)) return { jobId, result: 'skipped', code: 'TPSI_NOT_CONFIGURED' };
        const cases = service(this.env);
        try {
          // The D1 claim fences Workflow replay as well as duplicate dispatch.
          // The longer lease allows an interrupted five-minute step to settle.
          const job = await cases.claimJob(jobId, 10 * 60_000);
          if (!job) return { jobId, result: 'skipped' };
          return await processClaimedJob(cases, job, liveClient(this.env));
        } catch {
          // Workflow error persistence must never capture XML, credentials, or PII.
          throw new Error('REGISTRY_JOB_INTERRUPTED');
        }
      },
    );
  }
}

/** Persisting a job and dispatching it are separate; cron repairs any missed dispatch. */
export async function dispatchJobs(env: CloudflareEnv): Promise<void> {
  if (!tpsiReady(env)) return;
  const cases = service(env);
  for (const job of await cases.pendingJobs(25)) {
    const id = `registry-${job.id}`;
    try {
      await env.REGISTRY_JOBS.create({
        id,
        params: { jobId: job.id },
        retention: { successRetention: '1 day', errorRetention: '7 days' },
      });
    } catch {
      try {
        const instance = await env.REGISTRY_JOBS.get(id);
        const state = await instance.status();
        if (['complete', 'errored', 'terminated'].includes(state.status)) {
          // Only recoverable validation/status jobs can return to queued.
          // Interrupted submission jobs become failed + verification_required.
          if ((await cases.job(job.id))?.status === 'queued') await instance.restart();
        }
      } catch {
        // The transactional outbox remains queued; a later cron can dispatch it.
        console.error(JSON.stringify({ event: 'registry_dispatch_deferred', jobId: job.id }));
      }
    }
  }
}

export async function runScheduled(env: CloudflareEnv): Promise<void> {
  const cases = service(env);
  await cases.recoverInterruptedJobs(Date.now());
  await dispatchJobs(env);
  await deliverNotifications(env);
  await cases.cleanupOrphanObjects();
}
