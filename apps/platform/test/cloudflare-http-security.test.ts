import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  checkRateLimits,
  environment,
  FILE_LIMIT,
  JSON_LIMIT,
  jsonBody,
  readBody,
  uploadBody,
} from '../cloudflare/http';
import { createCloudflareBindings } from './cloudflare-data-fixtures';
import { createHttpWorker } from './cloudflare-http-fixture';

test('D1 rate limits are atomic, persist across callers and separate real client IPs', async (t) => {
  const { db, dispose } = await createCloudflareBindings();
  t.after(dispose);
  const sql = await readFile(new URL('../migrations/0002_auth.sql', import.meta.url), 'utf8');
  await db.batch(
    sql
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  const rule = [{ group: 'sign', limit: 5, windowMs: 60_000 }];
  const request = (ip: string, forwarded = '') =>
    new Request('https://www.norby.tw/api/sign/case', {
      headers: { 'cf-connecting-ip': ip, 'x-forwarded-for': forwarded },
    });
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () => checkRateLimits(db, request('203.0.113.1'), rule, 1_000)),
  );
  assert.equal(attempts.filter((r) => !r.response).length, 5);
  assert.equal(attempts.filter((r) => r.response?.status === 429).length, 3);
  assert.equal(
    (await checkRateLimits(db, request('203.0.113.1', '198.51.100.10'), rule, 1_001)).response
      ?.status,
    429,
  );
  assert.equal(
    (await checkRateLimits(db, request('203.0.113.2'), rule, 1_002)).response,
    undefined,
  );
  assert.equal(
    (await checkRateLimits(db, request('203.0.113.1'), rule, 61_001)).response,
    undefined,
  );
  const ipv6Rule = [{ group: 'ipv6', limit: 1, windowMs: 60_000 }];
  await checkRateLimits(db, request('2001:db8:abcd:1201::1'), ipv6Rule, 1_000);
  assert.equal(
    (await checkRateLimits(db, request('2001:db8:abcd:12ff::2'), ipv6Rule, 1_001)).response?.status,
    429,
  );
  const row = await db
    .prepare('SELECT key FROM norby_rate_limits LIMIT 1')
    .first<{ key: string }>();
  assert.doesNotMatch(row!.key, /203\.0\.113/);
});

test('body and multipart limits apply without Content-Length and preserve UTF-8 names', async () => {
  await assert.rejects(
    () =>
      readBody(
        new Request('https://example.test', {
          method: 'POST',
          body: new Uint8Array(JSON_LIMIT + 1),
        }),
        JSON_LIMIT,
      ),
    { code: 'BODY_TOO_LARGE' },
  );
  await assert.rejects(
    () =>
      jsonBody(
        new Request('https://example.test', {
          method: 'POST',
          body: '{broken',
          headers: { 'content-type': 'application/json' },
        }),
      ),
    { code: 'INVALID_JSON' },
  );
  const make = (extraFile = false, size = 10) => {
    const form = new FormData();
    form.append('kind', 'identity');
    form.append('file', new Blob([new Uint8Array(size)]), '身分證明.pdf');
    if (extraFile) form.append('file', new Blob(['extra']), 'other.pdf');
    return new Request('https://example.test', { method: 'POST', body: form });
  };
  assert.equal((await uploadBody(make())).file.name, '身分證明.pdf');
  await assert.rejects(() => uploadBody(make(true)), { code: 'LIMIT_PART_COUNT' });
  await assert.rejects(() => uploadBody(make(false, FILE_LIMIT + 1)), { code: 'LIMIT_FILE_SIZE' });
});

test('production TPSI test mode still requires email verification and retains security boundaries', async () => {
  const env = { APP_ENV: 'production', BASE_URL: 'https://www.norby.tw', NORBY_STAFF_EMAILS: '' };
  assert.equal(environment(env).emailVerificationRequired, true);
  assert.equal(environment({ ...env, APP_ENV: 'test' }).emailVerificationRequired, false);
  const { mf, dispose, base } = await createHttpWorker({ ...env, TPSI_MODE: 'test' });
  try {
    for (const method of ['GET', 'POST']) {
      const redirect = await mf.dispatchFetch(
        'https://norby.tw/cases/example?tab=files&name=%E4%B8%AD',
        {
          method,
          redirect: 'manual',
          ...(method === 'POST' ? { body: 'preserve-post' } : {}),
        },
      );
      assert.equal(redirect.status, 308);
      assert.equal(
        redirect.headers.get('location'),
        'https://www.norby.tw/cases/example?tab=files&name=%E4%B8%AD',
      );
    }
    const developmentHost = await mf.dispatchFetch(
      'https://norby-platform.example.workers.dev/api/health',
      { redirect: 'manual' },
    );
    assert.equal(developmentHost.status, 200);
    const publicResponse = await mf.dispatchFetch(`${base}/api/public`);
    assert.equal(publicResponse.status, 200, await publicResponse.clone().text());
    const body = (await publicResponse.json()) as {
      preview: boolean;
      emailVerificationRequired: boolean;
    };
    assert.equal(body.preview, true);
    assert.equal(body.emailVerificationRequired, true);
    assert.equal(publicResponse.headers.get('Cache-Control'), 'no-store');
    assert.match(publicResponse.headers.get('Content-Security-Policy')!, /frame-ancestors 'none'/);
    assert.equal(
      (await mf.dispatchFetch(`${base}/api/cases`, { headers: { Origin: 'https://evil.example' } }))
        .status,
      403,
    );
    assert.equal(
      (
        await mf.dispatchFetch(`${base}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: { Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal((await mf.dispatchFetch(`${base}/api/unknown`)).status, 404);
    const resource = await mf.dispatchFetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal(resource.status, 200, await resource.clone().text());
    const resourceMetadata = (await resource.json()) as { authorization_servers: string[] };
    assert.deepEqual(resourceMetadata.authorization_servers, [`${base}/api/auth`]);
    const discovery = await mf.dispatchFetch(
      `${base}/.well-known/oauth-authorization-server/api/auth`,
    );
    assert.equal(discovery.status, 200, await discovery.clone().text());
    const metadata = (await discovery.json()) as {
      client_id_metadata_document_supported?: boolean;
      registration_endpoint?: string;
    };
    assert.notEqual(metadata.client_id_metadata_document_supported, true);
    assert.ok(metadata.registration_endpoint?.endsWith('/api/auth/oauth2/register'));
    assert.equal(
      (
        await mf.dispatchFetch(`${base}/mcp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    );
    assert.match(await (await mf.dispatchFetch(`${base}/cases/test`)).text(), /Norby test SPA/);
  } finally {
    await dispose();
  }
});
