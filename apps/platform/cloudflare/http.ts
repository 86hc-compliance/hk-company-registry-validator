import { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { DomainError, requireCondition } from '../shared/domain';
import type { CloudflareEnv } from './env';

export const JSON_LIMIT = 1024 * 1024;
export const FILE_LIMIT = 10 * 1024 * 1024;

export function environment(
  env: Pick<CloudflareEnv, 'BASE_URL' | 'APP_ENV' | 'NORBY_STAFF_EMAILS'>,
) {
  const baseUrl = new URL(env.BASE_URL).origin;
  const production = env.APP_ENV !== 'development' && env.APP_ENV !== 'test';
  if (production && !baseUrl.startsWith('https://')) throw new Error('HTTPS_BASE_URL_REQUIRED');
  return {
    baseUrl,
    production,
    emailVerificationRequired: production,
    staffEmails: (env.NORBY_STAFF_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

/** Enforce the limit while reading, including requests without Content-Length. */
export async function readBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(request.headers.get('content-length'));
  requireCondition(!Number.isFinite(length) || length <= limit, 'BODY_TOO_LARGE', 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError('BODY_TOO_LARGE', 413);
      }
      parts.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

export async function jsonBody(request: Request): Promise<unknown> {
  requireCondition(
    request.headers.get('content-type')?.split(';')[0].trim() === 'application/json',
    'JSON_REQUIRED',
    415,
  );
  const bytes = await readBody(request, JSON_LIMIT);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new DomainError('INVALID_JSON', 400);
  }
}

export async function uploadBody(request: Request) {
  requireCondition(
    request.headers.get('content-type')?.startsWith('multipart/form-data;'),
    'MULTIPART_REQUIRED',
    415,
  );
  const body = await readBody(request, FILE_LIMIT + 128 * 1024);
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new DomainError('INVALID_MULTIPART', 400);
  }
  let files = 0;
  let fields = 0;
  for (const [key, value] of form) {
    if (typeof value === 'string') {
      fields++;
      requireCondition(
        (key === 'kind' || key === 'personId') && form.getAll(key).length === 1,
        'INVALID_FILE_FIELD',
        400,
      );
      requireCondition(value.length <= 1000, 'LIMIT_FIELD_VALUE', 400);
    } else {
      files++;
      requireCondition(key === 'file', 'LIMIT_UNEXPECTED_FILE', 400);
    }
  }
  requireCondition(files <= 1 && fields <= 2, 'LIMIT_PART_COUNT', 400);
  const file = form.get('file');
  requireCondition(file && typeof file !== 'string', 'FILE_REQUIRED', 400);
  requireCondition(file.size <= FILE_LIMIT, 'LIMIT_FILE_SIZE', 413);
  return { file, kind: form.get('kind'), personId: form.get('personId') || null };
}

export type RateRule = { group: string; limit: number; windowMs: number };
export function rateRules(path: string, method: string): RateRule[] {
  const rules: RateRule[] = [];
  if (path === '/api' || path.startsWith('/api/'))
    rules.push({ group: 'api', limit: 120, windowMs: 60_000 });
  if (path === '/mcp') rules.push({ group: 'mcp', limit: 120, windowMs: 60_000 });
  if (path === '/api/auth/oauth2/register')
    rules.push({ group: 'register', limit: 20, windowMs: 3_600_000 });
  if (method === 'POST' && /^\/api\/sign\/[^/]+$/.test(path))
    rules.push({ group: 'sign', limit: 5, windowMs: 60_000 });
  return rules;
}

/** Cloudflare overwrites CF-Connecting-IP at the edge. Never trust caller X-Forwarded-For. */
export async function checkRateLimits(
  db: D1Database,
  request: Request,
  rules: RateRule[],
  now = Date.now(),
) {
  const ip = ipKeyGenerator(request.headers.get('cf-connecting-ip') || 'local', 56);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)),
  );
  const identifier = Array.from(digest, (v) => v.toString(16).padStart(2, '0')).join('');
  const headers = new Headers();
  for (const rule of rules) {
    // A single D1 statement is atomic across isolates and Cloudflare locations.
    const row = await db
      .prepare(
        `INSERT INTO norby_rate_limits (key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
        reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END
      RETURNING count, reset_at`,
      )
      .bind(`${rule.group}:${identifier}`, now + rule.windowMs, now, now)
      .first<{ count: number; reset_at: number }>();
    if (!row) throw new Error('RATE_LIMIT_UNAVAILABLE');
    const reset = Math.max(1, Math.ceil((row.reset_at - now) / 1000));
    headers.set('RateLimit-Limit', String(rule.limit));
    headers.set('RateLimit-Remaining', String(Math.max(0, rule.limit - row.count)));
    headers.set('RateLimit-Reset', String(reset));
    headers.set('RateLimit-Policy', `${rule.limit};w=${rule.windowMs / 1000}`);
    if (row.count > rule.limit) {
      headers.set('Retry-After', String(reset));
      return {
        headers,
        response: Response.json({ error: 'TOO_MANY_REQUESTS' }, { status: 429, headers }),
      };
    }
  }
  return { headers, response: undefined };
}

export function secureResponse(
  response: Response,
  request: Request,
  production: boolean,
  rateHeaders?: Headers,
) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (production) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
  }
  const path = new URL(request.url).pathname;
  if (path === '/mcp' || path.startsWith('/api') || path.startsWith('/.well-known/'))
    headers.set('Cache-Control', 'no-store');
  rateHeaders?.forEach((value, key) => headers.set(key, value));
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof DomainError)
    return Response.json({ error: error.code, details: error.details }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: 'INVALID_INPUT',
        details: error.issues.map((e) => ({ path: e.path.join('.'), message: e.message })),
      },
      { status: 400 },
    );
  console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
}
