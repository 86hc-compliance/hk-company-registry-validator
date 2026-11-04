import { CloudflareCaseService } from '../cloudflare/cases';
import type { CloudflareEnv } from '../cloudflare/env';
import { dispatchJobs } from '../cloudflare/workflows';
import type { Application } from '../shared/domain';

export { RegistryJobsWorkflow } from '../cloudflare/workflows';

/** Local integration entrypoint only; never included in the application build. */
export default {
  async fetch(request: Request, env: CloudflareEnv) {
    const url = new URL(request.url);
    const cases = new CloudflareCaseService(env.DB, env.DOCUMENTS, env.DATA_ENCRYPTION_KEY);
    if (url.pathname === '/seed') {
      const data = (await request.json()) as Application;
      const customer = { id: 'alice', email: 'alice@example.test', kind: 'customer' as const };
      const staff = { id: 'staff', email: 'staff@example.test', kind: 'staff' as const };
      const key = () => crypto.randomUUID();
      await cases.configurePrice(staff, {
        currency: 'HKD',
        service: 8001,
        government: 2000,
        bank: {
          company: 'Fictional entity',
          bank: 'Test bank',
          account: 'TEST-ONLY',
          swift: '',
          instructions: '',
        },
      });
      let c = await cases.create(customer, { locale: 'zh-Hant', currency: 'HKD', data }, key());
      c = await cases.action(
        customer,
        c.id,
        { action: 'checkout', version: c.version, checks: ['service_terms'] },
        key(),
      );
      c = await cases.addFile(
        customer,
        c.id,
        'payment_proof',
        'fictional.pdf',
        Buffer.from('%PDF-1.4\nFictional local test document'),
        null,
      );
      c = await cases.action(
        customer,
        c.id,
        { action: 'report_payment', version: c.version, reference: 'TRANSFER-TEST' },
        key(),
      );
      c = await cases.action(
        staff,
        c.id,
        {
          action: 'confirm_payment',
          version: c.version,
          amount: c.quote!.total,
          reference: 'DEPOSIT-TEST',
        },
        key(),
      );
      for (const kind of ['identity', 'address'] as const)
        c = await cases.addFile(
          customer,
          c.id,
          kind,
          'fictional.pdf',
          Buffer.from('%PDF-1.4\nFictional local test document'),
          c.data.people[0].id,
        );
      c = await cases.action(
        staff,
        c.id,
        {
          action: 'approve',
          version: c.version,
          note: 'Fictional review',
          checks: ['identity', 'beneficial_owners', 'business_purpose', 'screening'],
        },
        key(),
      );
      await cases.recordValidation(
        c.id,
        c.revision,
        '<cr:submission xmlns:cr="http://interfaces.service.webservice.icris3e.cr.gov.hk/"></cr:submission>',
      );
      c = await cases.get(customer, c.id);
      await cases.recordSignature(
        c.id,
        c.revision,
        '<cr:submission xmlns:cr="http://interfaces.service.webservice.icris3e.cr.gov.hk/"></cr:submission>',
        true,
        c.version,
      );
      c = await cases.get(customer, c.id);
      c = await cases.action(
        staff,
        c.id,
        { action: 'queue_submission', version: c.version },
        key(),
      );
      const job = (await cases.pendingJobs())[0];
      return Response.json({ caseId: c.id, jobId: job.id });
    }
    if (url.pathname === '/dispatch') {
      await dispatchJobs(env);
      return Response.json({ dispatched: true });
    }
    const id = url.searchParams.get('id')!;
    const instance = await env.REGISTRY_JOBS.get(`registry-${id}`);
    if (url.pathname === '/restart') {
      await instance.restart();
      return Response.json({ restarted: true });
    }
    const job = await cases.job(id);
    const c = await cases.internalCase(job!.case_id);
    return Response.json({
      workflow: await instance.status(),
      jobStatus: job!.status,
      caseStatus: c.status,
      governmentDebits: c.ledger.filter((row) => row.kind === 'government_debit').length,
    });
  },
};
