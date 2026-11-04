import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { requireMcpAuth } from '@better-auth/mcp';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { z } from 'zod';
import { resolve } from 'node:path';
import { config, production } from './config.js';
import { openDatabase, Vault } from './storage.js';
import { CaseService } from './cases.js';
import { createAuth, migrateAuth } from './auth.js';
import { createAgentHandler, agentFromClaims } from './mcp.js';
import {
  DomainError,
  requireCondition,
  fileKindSchema,
  addressSchema,
  type Actor,
} from '../shared/domain.js';
import { startWorker, tpsiReady, signingContext, signCase, signingReview } from './tpsi.js';
import { startNotifications } from './notifications.js';

const db = openDatabase(config.database);
const cases = new CaseService(db, new Vault(config.dataKey));
const auth = createAuth(db);
await migrateAuth(auth);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: production
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
  }),
);
app.use(
  '/api',
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
);
app.use(
  '/mcp',
  rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }),
);
app.use(
  '/api/auth/oauth2/register',
  rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
);
app.all('/api/auth/{*splat}', toNodeHandler(auth));
app.all('/.well-known/{*splat}', toNodeHandler(auth));
app.use(express.json({ limit: '1mb' }));
app.use(['/api', '/mcp'], (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin && origin !== config.baseUrl) {
    res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
    return;
  }
  next();
});
const makeRequest = (req: express.Request) =>
  new Request(`${config.baseUrl}${req.originalUrl}`, {
    method: req.method,
    headers: fromNodeHeaders(req.headers),
    ...(!['GET', 'HEAD'].includes(req.method) ? { body: JSON.stringify(req.body) } : {}),
  });
async function send(res: express.Response, response: Response) {
  res.status(response.status);
  response.headers.forEach((v, k) => res.setHeader(k, v));
  if (response.body) res.end(Buffer.from(await response.arrayBuffer()));
  else res.end();
}
const mcpHandler = createAgentHandler(auth, cases);
app.post('/mcp', async (req, res) => send(res, await mcpHandler(makeRequest(req))));
app.get('/mcp', (_req, res) =>
  res.status(405).set('Allow', 'POST').json({ error: 'METHOD_NOT_ALLOWED' }),
);

async function sessionActor(req: express.Request): Promise<Actor> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
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
async function actor(req: express.Request): Promise<Actor> {
  if (req.get('authorization')) {
    let result: Actor | undefined;
    const verify = requireMcpAuth(
      auth,
      (_r, claims) => {
        result = agentFromClaims(cases, claims);
        return Response.json({ ok: true });
      },
      { resource: `${config.baseUrl}/mcp`, requiredScopes: ['cases:read'] },
    );
    const response = await verify(makeRequest(req));
    requireCondition(response.ok && result, 'INVALID_TOKEN', 401);
    return result;
  }
  return sessionActor(req);
}
const key = (req: express.Request) => req.get('Idempotency-Key') || '';
app.get('/api/public', (_req, res) =>
  res.json({
    prices: cases.prices().map((p) => ({ ...p, bank: undefined })),
    contactUrl: cases.organisation().contactUrl,
    preview: !production || config.tpsiMode === 'test',
    emailVerificationRequired: config.emailVerificationRequired,
    tpsiConfigured: tpsiReady(),
    mcpUrl: `${config.baseUrl}/mcp`,
  }),
);
app.get('/api/me', async (req, res) => {
  const a = await sessionActor(req);
  const s = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  res.json({ id: a.id, kind: a.kind, name: s!.user.name, email: s!.user.email });
});
app.get('/api/cases', async (req, res) => res.json(cases.list(await actor(req))));
app.post('/api/cases', async (req, res) =>
  res.status(201).json(cases.create(await actor(req), req.body, key(req))),
);
app.get('/api/cases/:id', async (req, res) =>
  res.json(cases.get(await actor(req), String(req.params.id))),
);
app.put('/api/cases/:id', async (req, res) =>
  res.json(cases.update(await actor(req), String(req.params.id), req.body, key(req))),
);
app.post('/api/cases/:id/actions', async (req, res) => {
  if (['queue_validation', 'queue_submission', 'queue_status'].includes(req.body?.action))
    requireCondition(tpsiReady(), 'TPSI_NOT_CONFIGURED', 503);
  res.json(cases.action(await actor(req), String(req.params.id), req.body, key(req)));
});
const upload = multer({
  defParamCharset: 'utf8',
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
});
app.post(
  '/api/cases/:id/files',
  async (req, res, next) => {
    res.locals.actor = await sessionActor(req);
    cases.get(res.locals.actor, String(req.params.id));
    next();
  },
  upload.single('file'),
  (req, res) => {
    requireCondition(req.file, 'FILE_REQUIRED', 400);
    res
      .status(201)
      .json(
        cases.addFile(
          res.locals.actor,
          String(req.params.id),
          fileKindSchema.parse(req.body.kind),
          req.file.originalname,
          req.file.buffer,
          req.body.personId || null,
        ),
      );
  },
);
app.get('/api/cases/:id/files/:fileId', async (req, res) => {
  const f = cases.file(await sessionActor(req), String(req.params.id), String(req.params.fileId));
  res
    .type(f.type)
    .set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`)
    .send(f.content);
});
app.get('/api/settings', async (req, res) => {
  requireCondition((await sessionActor(req)).kind === 'staff', 'STAFF_REQUIRED', 403);
  res.json({ prices: cases.prices(), organisation: cases.organisation() });
});
app.put('/api/settings/prices', async (req, res) =>
  res.json(cases.configurePrice(await sessionActor(req), req.body)),
);
app.put('/api/settings/organisation', async (req, res) => {
  const s = z
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
    .strict()
    .parse(req.body);
  res.json(cases.configureOrganisation(await sessionActor(req), s));
});
app.get('/api/connections', async (req, res) => {
  await sessionActor(req);
  res.json(await auth.api.getOAuthConsents({ headers: fromNodeHeaders(req.headers) }));
});
app.post('/api/connections/:id/revoke', async (req, res) => {
  const a = await sessionActor(req);
  const id = String(req.params.id);
  const consent = db
    .prepare('SELECT clientId FROM oauthConsent WHERE id=? AND userId=?')
    .get(id, a.id) as { clientId: string } | undefined;
  requireCondition(consent, 'CONSENT_NOT_FOUND', 404);
  db.transaction(() => {
    db.prepare(
      'INSERT INTO norby_revocations VALUES (?,?,?) ON CONFLICT(user_id,client_id) DO UPDATE SET revoked_at=MAX(norby_revocations.revoked_at,excluded.revoked_at)',
    ).run(a.id, consent.clientId, Date.now());
    db.prepare('DELETE FROM oauthAccessToken WHERE userId=? AND clientId=?').run(
      a.id,
      consent.clientId,
    );
    db.prepare('DELETE FROM oauthRefreshToken WHERE userId=? AND clientId=?').run(
      a.id,
      consent.clientId,
    );
    db.prepare('DELETE FROM oauthConsent WHERE userId=? AND clientId=?').run(
      a.id,
      consent.clientId,
    );
  })();
  res.json({ revoked: true });
});
app.get('/api/consent', async (req, res) => {
  await sessionActor(req);
  const raw = z.string().max(10000).parse(req.query.query);
  const { secret } = await auth.$context;
  requireCondition(await verifyOAuthQueryParams(raw, secret), 'INVALID_CONSENT_REQUEST', 400);
  const p = new URLSearchParams(raw);
  const clientId = p.get('client_id');
  requireCondition(clientId, 'INVALID_CONSENT_REQUEST', 400);
  const client = await auth.api.getOAuthClientPublic({
    headers: fromNodeHeaders(req.headers),
    query: { client_id: clientId },
  });
  res.json({
    client,
    scopes: (p.get('scope') || '').split(' ').filter(Boolean),
    claims: p.get('claims'),
  });
});
app.get('/api/health', (_req, res) => res.json({ status: 'ok', tpsi: config.tpsiMode }));
app.get('/api/sign/:id', async (req, res) => {
  const { c, next, xml } = signingContext(cases, String(req.params.id), await sessionActor(req));
  res.json({
    reference: c.reference,
    version: c.version,
    uri: next.uri,
    companyName: c.data.englishName || c.data.chineseName,
    person: next.person,
    application: next.uri === 'FormSigner' ? c.data : undefined,
    officialReview: signingReview(xml, next.uri),
  });
});
app.post(
  '/api/sign/:id',
  rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const input = z
      .object({
        version: z.number().int(),
        password: z.string().min(1).max(256),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(req.body);
    try {
      res.json(
        await signCase(
          cases,
          String(req.params.id),
          await sessionActor(req),
          input.version,
          input.password,
        ),
      );
    } finally {
      input.password = '';
      req.body = {};
    }
  },
);
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
if (production) {
  app.use(express.static(resolve('dist/client'), { index: false }));
  app.get('/{*splat}', (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else if (process.env.NODE_ENV !== 'test') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    mode: 'node',
    server: { middlewareMode: true, ws: { port: config.port + 1 } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof DomainError) {
      res.status(error.status).json({ error: error.code, details: error.details });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'INVALID_INPUT',
        details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code });
      return;
    }
    if (
      error instanceof Error &&
      'code' in error &&
      String(error.code).startsWith('SQLITE_CONSTRAINT')
    ) {
      res.status(409).json({ error: 'DUPLICATE_REFERENCE' });
      return;
    }
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  },
);
const server = app.listen(config.port, config.host, () =>
  console.info(`Norby listening on ${config.baseUrl}`),
);
const stopWorker = startWorker(cases);
const stopNotifications = startNotifications(db);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    stopWorker();
    stopNotifications();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
