import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { application, pdf } from './fixtures';
import type { CaseView } from '../shared/domain';

test(
  'HTTP authentication, PKCE consent, MCP ownership and immediate OAuth revocation',
  { timeout: 40000 },
  async () => {
    const reserve = createServer();
    await new Promise<void>((r) => reserve.listen(0, '127.0.0.1', r));
    const port = (reserve.address() as { port: number }).port;
    await new Promise<void>((r) => reserve.close(() => r()));
    const base = `http://localhost:${port}`,
      directory = mkdtempSync(join(tmpdir(), 'norby-http-test-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        BASE_URL: base,
        DATA_DIRECTORY: directory,
        NORBY_STAFF_EMAILS: 'ops@example.test',
        TPSI_MODE: 'disabled',
        SMTP_URL: '',
      },
      stdio: 'pipe',
    });
    let logs = '';
    child.stdout.on('data', (v) => {
      logs += v.toString();
    });
    child.stderr.on('data', (v) => {
      logs += v.toString();
    });
    const req = async (
      path: string,
      {
        cookie = '',
        token = '',
        body,
        method = body ? 'POST' : 'GET',
        headers = {},
      }: {
        cookie?: string;
        token?: string;
        body?: unknown;
        method?: string;
        headers?: Record<string, string>;
      } = {},
    ) =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          Origin: base,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : { ...{} }),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
    const register = async (email: string) => {
      const r = await req('/api/auth/sign-up/email', {
        body: { email, password: 'Fictional-password-123!', name: 'Test user' },
      });
      assert.equal(r.status, 200, await r.clone().text());
      return r.headers
        .getSetCookie()
        .map((s) => s.split(';')[0])
        .join('; ');
    };
    try {
      let ready = false;
      for (let i = 0; i < 80; i++) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ready, logs);
      assert.equal((await req('/api/cases')).status, 401);
      const cookie = await register('owner@example.test');
      const stranger = await register('other@example.test');
      const data = application();
      const created = await req('/api/cases', {
        cookie,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { locale: 'en', currency: 'HKD', data },
      });
      assert.equal(created.status, 201);
      const caseData = (await created.json()) as { id: string; version: number };
      assert.equal((await req(`/api/cases/${caseData.id}`, { cookie: stranger })).status, 404);
      assert.equal((await req('/api/settings', { cookie })).status, 403);
      for (const name of ['身分證明.pdf', '公司註冊證明書-é.pdf', 'identity.pdf']) {
        const body = new FormData();
        body.set('kind', 'identity');
        body.set('personId', data.people[0].id);
        body.set('file', new Blob([pdf], { type: 'application/pdf' }), name);
        const uploaded = await fetch(`${base}/api/cases/${caseData.id}/files`, {
          method: 'POST',
          headers: { Cookie: cookie, Origin: base },
          body,
        });
        assert.equal(uploaded.status, 201, await uploaded.clone().text());
        const result = (await uploaded.json()) as CaseView;
        caseData.version = result.version;
        assert.equal(result.files[0].name, name);
        const listed = (await (
          await req(`/api/cases/${caseData.id}`, { cookie })
        ).json()) as CaseView;
        assert.equal(listed.files[0].name, name);
        const downloaded = await req(`/api/cases/${caseData.id}/files/${result.files[0].id}`, {
          cookie,
        });
        assert.equal(downloaded.status, 200);
        assert.equal(
          downloaded.headers.get('content-disposition'),
          `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        );
        assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
      }
      const registration = await req('/api/auth/oauth2/register', {
        body: {
          client_name: 'Fictional agent',
          redirect_uris: ['http://127.0.0.1:7777/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: 'openid cases:read cases:write offline_access',
        },
      });
      assert.equal(registration.status, 201, await registration.clone().text());
      const client = (await registration.json()) as { client_id: string };
      const verifier = randomBytes(48).toString('base64url'),
        challenge = createHash('sha256').update(verifier).digest('base64url');
      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:7777/callback',
        response_type: 'code',
        scope: 'openid cases:read cases:write offline_access',
        state: 'test-state',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        resource: `${base}/mcp`,
      });
      const redirectMismatch = new URLSearchParams(params);
      redirectMismatch.set('redirect_uri', 'https://attacker.example/callback');
      const mismatch = await req(`/api/auth/oauth2/authorize?${redirectMismatch}`, { cookie });
      assert.ok(
        mismatch.status >= 400 || new URL(mismatch.headers.get('location')!, base).origin === base,
        'Invalid redirect URI must never receive a redirect',
      );
      const authorize = await req(`/api/auth/oauth2/authorize?${params}`, {
        cookie,
        headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
      });
      assert.ok([200, 302].includes(authorize.status), await authorize.clone().text());
      const consentLocation =
        authorize.status === 302
          ? authorize.headers.get('location')!
          : ((await authorize.json()) as { url: string }).url;
      const consentUrl = new URL(consentLocation, base);
      assert.equal(consentUrl.pathname, '/consent');
      const details = await req(
        `/api/consent?query=${encodeURIComponent(consentUrl.search.slice(1))}`,
        { cookie },
      );
      assert.equal(details.status, 200, await details.clone().text());
      const forged = await req(
        `/api/consent?query=${encodeURIComponent(consentUrl.search.slice(1).replace('cases%3Aread', 'cases%3Aadmin'))}`,
        { cookie },
      );
      assert.equal(forged.status, 400);
      const accept = await req('/api/auth/oauth2/consent', {
        cookie,
        body: { accept: true, oauth_query: consentUrl.search.slice(1) },
      });
      assert.equal(accept.status, 200, await accept.clone().text());
      const redirect = (await accept.json()) as { url?: string; redirect_uri?: string };
      const callback = new URL(redirect.url || redirect.redirect_uri!);
      assert.equal(callback.searchParams.get('state'), 'test-state');
      const code = callback.searchParams.get('code');
      assert.ok(code);
      const tokenRequest = async (codeVerifier: string, resource = `${base}/mcp`) =>
        fetch(`${base}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: client.client_id,
            redirect_uri: 'http://127.0.0.1:7777/callback',
            code: code!,
            code_verifier: codeVerifier,
            resource,
          }),
        });
      const exchanged = await tokenRequest(verifier);
      assert.equal(exchanged.status, 200, await exchanged.clone().text());
      const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };
      assert.ok(tokens.access_token);
      assert.equal(
        (await tokenRequest(verifier)).status,
        400,
        'authorization codes are single-use',
      );
      const own = await req(`/api/cases/${caseData.id}`, { token: tokens.access_token });
      assert.equal(own.status, 200, await own.clone().text());
      const crossCase = await req('/api/cases', {
        cookie: stranger,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { locale: 'en', currency: 'USD' },
      });
      const otherCase = (await crossCase.json()) as { id: string };
      assert.equal(
        (await req(`/api/cases/${otherCase.id}`, { token: tokens.access_token })).status,
        404,
      );
      const privileged = await req(`/api/cases/${caseData.id}/actions`, {
        token: tokens.access_token,
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: { action: 'approve', version: caseData.version },
      });
      assert.equal(privileged.status, 403);
      const mcp = await req('/mcp', {
        token: tokens.access_token,
        headers: {
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      });
      assert.equal(mcp.status, 200, await mcp.clone().text());
      const toolText = await mcp.text();
      assert.match(toolText, /create_case/);
      assert.doesNotMatch(toolText, /"name":"confirm_payment"/);
      const consents = (await (await req('/api/connections', { cookie })).json()) as {
        id: string;
      }[];
      assert.equal(consents.length, 1);
      assert.equal(
        (await req(`/api/connections/${consents[0].id}/revoke`, { cookie: stranger, body: {} }))
          .status,
        404,
      );
      assert.equal(
        (await req(`/api/connections/${consents[0].id}/revoke`, { cookie, body: {} })).status,
        200,
      );
      assert.equal(
        (await req(`/api/cases/${caseData.id}`, { token: tokens.access_token })).status,
        401,
      );
      assert.equal(
        (
          await req('/mcp', {
            token: tokens.access_token,
            headers: { Accept: 'application/json, text/event-stream' },
            body: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
          })
        ).status,
        401,
      );
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((r) => {
        if (child.exitCode !== null) r();
        else child.once('exit', () => r());
      });
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
