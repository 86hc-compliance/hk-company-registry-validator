import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { z } from 'zod';
import { addressSchema, fileKindSchema, requireCondition, type Actor } from '../shared/domain';
import { createAuth, type Auth } from './auth';
import { CloudflareCaseService } from './cases';
import type { CloudflareEnv } from './env';
import { agentFromClaims, createAgentHandler } from './mcp';
import { verifyAgentToken } from './http-auth';
import {
  checkRateLimits,
  environment,
  errorResponse,
  jsonBody,
  JSON_LIMIT,
  rateRules,
  readBody,
  secureResponse,
  uploadBody,
} from './http';
import { signCase, signingContext, signingReview, tpsiReady } from './tpsi';
import { dispatchJobs, runScheduled } from './workflows';

export { RegistryJobsWorkflow } from './workflows';

async function sessionActor(
  request: Request,
  auth: Auth,
  config: ReturnType<typeof environment>,
): Promise<Actor> {
  const session = await auth.api.getSession({ headers: request.headers });
  requireCondition(session, 'AUTH_REQUIRED', 401);
  requireCondition(
    !config.emailVerificationRequired || session.user.emailVerified,
    'EMAIL_VERIFICATION_REQUIRED',
    403,
  );
  return {
    id: session.user.id,
    email: session.user.email,
    kind: config.staffEmails.includes(session.user.email.toLowerCase()) ? 'staff' : 'customer',
  };
}

async function requestActor(request: Request, auth: Auth, env: CloudflareEnv): Promise<Actor> {
  const config = environment(env);
  if (!request.headers.has('authorization')) return sessionActor(request, auth, config);
  const claims = await verifyAgentToken(request, auth, config.baseUrl);
  return agentFromClaims(env.DB, claims);
}

const organisationSchema = z
  .object({
    contactUrl: z.union([z.literal(''), z.url().refine((s) => s.startsWith('https://'))]),
    secretaryName: z.string().max(150),
    secretaryChineseName: z.string().max(50),
    secretaryBrn: z.string().max(8),
    tcspLicence: z.string().max(20),
    secretaryEmail: z.string().max(60),
    office: addressSchema,
    hkPhone: z.string().max(8),
  })
  .strict();

async function route(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const config = environment(env);
  if (!(
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/mcp' ||
    path.startsWith('/.well-known/')
  )) {
    if (!['GET', 'HEAD'].includes(method))
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED' },
        { status: 405, headers: { Allow: 'GET, HEAD' } },
      );
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || /\.[^/]+$/.test(path)) return asset;
    return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
  }
  const origin = request.headers.get('origin');
  requireCondition(!origin || origin === config.baseUrl, 'ORIGIN_NOT_ALLOWED', 403);
  if (path === '/api/health' && method === 'GET')
    return Response.json({ status: 'ok', tpsi: env.TPSI_MODE });
  const cases = new CloudflareCaseService(env.DB, env.DOCUMENTS, env.DATA_ENCRYPTION_KEY);
  if (path === '/api/public' && method === 'GET') {
    const [prices, organisation] = await Promise.all([cases.prices(), cases.organisation()]);
    return Response.json({
      prices: prices.map((p) => ({ ...p, bank: undefined })),
      contactUrl: organisation.contactUrl,
      preview: !config.production || env.TPSI_MODE === 'test',
      emailVerificationRequired: config.emailVerificationRequired,
      tpsiConfigured: tpsiReady(env),
      mcpUrl: `${config.baseUrl}/mcp`,
    });
  }
  const auth = createAuth(env);
  await auth.$context;
  if (path.startsWith('/api/auth/') || path.startsWith('/.well-known/')) {
    if (method === 'GET' || method === 'HEAD') return auth.handler(request);
    const bytes = await readBody(request, JSON_LIMIT);
    return auth.handler(
      new Request(request.url, {
        method,
        headers: request.headers,
        body: bytes,
        redirect: 'manual',
      }),
    );
  }
  if (path === '/mcp') {
    if (method !== 'POST')
      return Response.json(
        { error: 'METHOD_NOT_ALLOWED' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    const bytes = await readBody(request, JSON_LIMIT);
    return createAgentHandler(
      auth,
      cases,
      env.DB,
      config.baseUrl,
    )(new Request(request.url, { method, headers: request.headers, body: bytes }));
  }
  const actor = () => requestActor(request, auth, env);
  const human = () => sessionActor(request, auth, config);
  const key = request.headers.get('Idempotency-Key') || '';
  const mutation = async (value: unknown, status = 200) => {
    // The mutation writes a durable outbox first; scheduled recovery covers a failed dispatch.
    ctx.waitUntil(
      dispatchJobs(env).catch((error: unknown) =>
        console.error('Job dispatch failed:', error instanceof Error ? error.name : 'UnknownError'),
      ),
    );
    return Response.json(value, { status });
  };
  if (path === '/api/me' && method === 'GET') {
    const a = await human();
    const session = await auth.api.getSession({ headers: request.headers });
    return Response.json({
      id: a.id,
      kind: a.kind,
      name: session!.user.name,
      email: session!.user.email,
    });
  }
  if (path === '/api/cases') {
    if (method === 'GET') return Response.json(await cases.list(await actor()));
    if (method === 'POST')
      return mutation(await cases.create(await actor(), await jsonBody(request), key), 201);
  }
  const casePath = /^\/api\/cases\/([^/]+)(?:\/(actions|files)(?:\/([^/]+))?)?$/.exec(path);
  if (casePath) {
    const [, id, operation, fileId] = casePath;
    if (!operation && method === 'GET') return Response.json(await cases.get(await actor(), id));
    if (!operation && method === 'PUT')
      return mutation(await cases.update(await actor(), id, await jsonBody(request), key));
    if (operation === 'actions' && !fileId && method === 'POST') {
      const a = await actor();
      const body = await jsonBody(request);
      const action =
        typeof body === 'object' && body !== null && 'action' in body ? body.action : null;
      if (
        typeof action === 'string' &&
        ['queue_validation', 'queue_submission', 'queue_status'].includes(action)
      )
        requireCondition(tpsiReady(env), 'TPSI_NOT_CONFIGURED', 503);
      return mutation(await cases.action(a, id, body, key));
    }
    if (operation === 'files' && !fileId && method === 'POST') {
      const a = await human();
      await cases.get(a, id);
      const { file, kind, personId } = await uploadBody(request);
      return mutation(
        await cases.addFile(
          a,
          id,
          fileKindSchema.parse(kind),
          file.name,
          new Uint8Array(await file.arrayBuffer()),
          typeof personId === 'string' ? personId : null,
        ),
        201,
      );
    }
    if (operation === 'files' && fileId && method === 'GET') {
      const file = await cases.file(await human(), id, fileId);
      return new Response(new Uint8Array(file.content), {
        headers: {
          'Content-Type': file.type,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        },
      });
    }
  }
  if (path === '/api/settings' && method === 'GET') {
    requireCondition((await human()).kind === 'staff', 'STAFF_REQUIRED', 403);
    return Response.json({
      prices: await cases.prices(),
      organisation: await cases.organisation(),
    });
  }
  if (path === '/api/settings/prices' && method === 'PUT')
    return mutation(await cases.configurePrice(await human(), await jsonBody(request)));
  if (path === '/api/settings/organisation' && method === 'PUT')
    return mutation(
      await cases.configureOrganisation(
        await human(),
        organisationSchema.parse(await jsonBody(request)),
      ),
    );
  if (path === '/api/connections' && method === 'GET') {
    await human();
    return Response.json(await auth.api.getOAuthConsents({ headers: request.headers }));
  }
  const revokePath = /^\/api\/connections\/([^/]+)\/revoke$/.exec(path);
  if (revokePath && method === 'POST') {
    const a = await human();
    const consent = await env.DB.prepare(
      'SELECT clientId FROM oauthConsent WHERE id=? AND userId=?',
    )
      .bind(revokePath[1], a.id)
      .first<{ clientId: string }>();
    requireCondition(consent, 'CONSENT_NOT_FOUND', 404);
    // Revoke the entire user/client grant atomically. A deleted consent alone would
    // leave old refresh tokens able to regain access after the customer reconnects.
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO norby_revocations (user_id, client_id, revoked_at) VALUES (?,?,?) ON CONFLICT(user_id,client_id) DO UPDATE SET revoked_at=MAX(norby_revocations.revoked_at,excluded.revoked_at)',
      ).bind(a.id, consent.clientId, Date.now()),
      env.DB.prepare('DELETE FROM oauthAccessToken WHERE userId=? AND clientId=?').bind(
        a.id,
        consent.clientId,
      ),
      env.DB.prepare('DELETE FROM oauthRefreshToken WHERE userId=? AND clientId=?').bind(
        a.id,
        consent.clientId,
      ),
      env.DB.prepare('DELETE FROM oauthConsent WHERE userId=? AND clientId=?').bind(
        a.id,
        consent.clientId,
      ),
    ]);
    return Response.json({ revoked: true });
  }
  if (path === '/api/consent' && method === 'GET') {
    await human();
    const raw = z.string().max(10000).parse(url.searchParams.get('query'));
    const { secret } = await auth.$context;
    requireCondition(await verifyOAuthQueryParams(raw, secret), 'INVALID_CONSENT_REQUEST', 400);
    const params = new URLSearchParams(raw);
    const clientId = params.get('client_id');
    requireCondition(clientId, 'INVALID_CONSENT_REQUEST', 400);
    const client = await auth.api.getOAuthClientPublic({
      headers: request.headers,
      query: { client_id: clientId },
    });
    return Response.json({
      client,
      scopes: (params.get('scope') || '').split(' ').filter(Boolean),
      claims: params.get('claims'),
    });
  }
  const signPath = /^\/api\/sign\/([^/]+)$/.exec(path);
  if (signPath && method === 'GET') {
    const { c, next, xml } = await signingContext(cases, signPath[1], await human());
    return Response.json({
      reference: c.reference,
      version: c.version,
      uri: next.uri,
      companyName: c.data.englishName || c.data.chineseName,
      person: next.person,
      application: next.uri === 'FormSigner' ? c.data : undefined,
      officialReview: signingReview(xml, next.uri),
    });
  }
  if (signPath && method === 'POST') {
    const a = await human();
    const input = z
      .object({
        version: z.number().int(),
        password: z.string().min(1).max(256),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(await jsonBody(request));
    try {
      return mutation(await signCase(cases, signPath[1], a, input.version, input.password, env));
    } finally {
      input.password = '';
    }
  }
  return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): Promise<Response> {
    let rateHeaders: Headers | undefined;
    let response: Response;
    try {
      const url = new URL(request.url);
      const config = environment(env);
      const canonical = new URL(config.baseUrl);
      if (
        config.production &&
        url.hostname === 'norby.tw' &&
        canonical.hostname === 'www.norby.tw'
      ) {
        url.protocol = canonical.protocol;
        url.host = canonical.host;
        return secureResponse(Response.redirect(url.href, 308), request, true);
      }
      const rules = rateRules(url.pathname, request.method);
      if (rules.length) {
        const rate = await checkRateLimits(env.DB, request, rules);
        rateHeaders = rate.headers;
        if (rate.response)
          return secureResponse(rate.response, request, environment(env).production);
      }
      response = await route(request, env, ctx);
    } catch (error) {
      response = errorResponse(error);
    }
    return secureResponse(
      response,
      request,
      env.APP_ENV !== 'development' && env.APP_ENV !== 'test',
      rateHeaders,
    );
  },
  async scheduled(_event: ScheduledController, env: CloudflareEnv): Promise<void> {
    await env.DB.prepare('DELETE FROM norby_rate_limits WHERE reset_at<?').bind(Date.now()).run();
    await runScheduled(env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
