import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { application, pdf } from './fixtures';
import type { CaseView } from '../shared/domain';
import { createHttpWorker } from './cloudflare-http-fixture';
import { createAuth } from '../cloudflare/auth';
import type { CloudflareEnv } from '../cloudflare/env';
import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from 'jose';

test(
  'Workers D1 authentication, Unicode uploads, PKCE consent, MCP ownership and immediate revocation',
  { timeout: 40000 },
  async () => {
    const { mf, base, dispose, db } = await createHttpWorker();
    const fetch = mf.dispatchFetch.bind(mf);
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
      assert.equal((await req('/api/cases')).status, 401);
      const cookie = await register('owner@example.test');
      const stranger = await register('other@example.test');
      assert.equal((await req('/api/auth/admin/oauth2/resources', { cookie })).status, 404);
      const staffCookie = await register('ops@example.test');
      const signingAuth = createAuth(await mf.getBindings<CloudflareEnv>());
      await assert.rejects(
        () => signingAuth.api.adminListOAuthResources({ headers: new Headers({ Cookie: cookie }) }),
        { status: 'UNAUTHORIZED' },
      );
      assert.ok(
        await signingAuth.api.adminListOAuthResources({
          headers: new Headers({ Cookie: staffCookie }),
        }),
      );
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
        const multipart = new Response(body);
        const uploaded = await fetch(`${base}/api/cases/${caseData.id}/files`, {
          method: 'POST',
          headers: {
            Cookie: cookie,
            Origin: base,
            'Content-Type': multipart.headers.get('content-type')!,
          },
          body: new Uint8Array(await multipart.arrayBuffer()),
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
      const listTool = await req('/mcp', {
        token: tokens.access_token,
        headers: {
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'list_cases', arguments: {} },
        },
      });
      assert.equal(listTool.status, 200, await listTool.clone().text());
      assert.match(await listTool.text(), new RegExp(caseData.id));
      // Use the server-only signing API to test verifier constraints with real signed JWTs.
      const payload = JSON.parse(
        Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString(),
      );
      const issue = async (overrides: Record<string, unknown>) =>
        (await signingAuth.api.signJWT({ body: { payload: { ...payload, ...overrides } } })).token;
      for (const invalid of [
        { aud: 'https://other.example/mcp' },
        { iss: 'https://other.example/api/auth' },
        { exp: Math.floor(Date.now() / 1000) - 60 },
      ])
        assert.equal(
          (await req(`/api/cases/${caseData.id}`, { token: await issue(invalid) })).status,
          401,
        );
      assert.equal(
        (await req(`/api/cases/${caseData.id}`, { token: await issue({ scope: 'openid' }) }))
          .status,
        403,
      );
      const proofKey = await generateKeyPair('ES256');
      const publicKey = await exportJWK(proofKey.publicKey);
      const boundToken = await issue({ cnf: { jkt: await calculateJwkThumbprint(publicKey) } });
      assert.equal((await req(`/api/cases/${caseData.id}`, { token: boundToken })).status, 401);
      const proof = await new SignJWT({
        htm: 'GET',
        htu: `${base}/api/cases/${caseData.id}`,
        iat: Math.floor(Date.now() / 1000),
        jti: crypto.randomUUID(),
        ath: createHash('sha256').update(boundToken).digest('base64url'),
      })
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicKey })
        .sign(proofKey.privateKey);
      const proofRequest = () =>
        req(`/api/cases/${caseData.id}`, {
          headers: { Authorization: `DPoP ${boundToken}`, DPoP: proof },
        });
      assert.equal((await proofRequest()).status, 200);
      assert.equal(
        (await proofRequest()).status,
        401,
        'DPoP proof reservations must persist across request-scoped auth instances',
      );
      const consents = (await (await req('/api/connections', { cookie })).json()) as {
        id: string;
      }[];
      assert.equal(consents.length, 1);
      const originalRefresh = await db
        .prepare('SELECT * FROM oauthRefreshToken WHERE clientId=?')
        .bind(client.client_id)
        .first<Record<string, string | number | null>>();
      assert.ok(originalRefresh, 'an active refresh grant exists before revocation');
      assert.equal(
        (await req('/api/auth/oauth2/delete-consent', { cookie, body: { id: consents[0].id } }))
          .status,
        404,
      );
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
      const refresh = () =>
        fetch(`${base}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: client.client_id,
            refresh_token: tokens.refresh_token,
            resource: `${base}/mcp`,
          }),
        });
      assert.equal((await refresh()).status, 400, 'revocation deletes the refresh grant');
      const reconnect = await req(`/api/auth/oauth2/authorize?${params}`, {
        cookie,
        headers: { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' },
      });
      assert.ok([200, 302].includes(reconnect.status), await reconnect.clone().text());
      const reconnectLocation =
        reconnect.status === 302
          ? reconnect.headers.get('location')!
          : ((await reconnect.json()) as { url: string }).url;
      const reconnectConsent = new URL(reconnectLocation, base);
      assert.equal(reconnectConsent.pathname, '/consent');
      assert.equal(
        (
          await req('/api/auth/oauth2/consent', {
            cookie,
            body: { accept: true, oauth_query: reconnectConsent.search.slice(1) },
          })
        ).status,
        200,
      );
      assert.equal(
        (await refresh()).status,
        400,
        'reconnecting must never reactivate an old refresh token',
      );
      const columns = Object.keys(originalRefresh);
      await db
        .prepare(
          `INSERT INTO oauthRefreshToken (${columns.map((column) => `"${column}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
        )
        .bind(...columns.map((column) => originalRefresh[column]))
        .run();
      const orphanRefresh = await refresh();
      assert.equal(
        orphanRefresh.status,
        400,
        'a late refresh-row insertion from an in-flight rotation remains fenced',
      );
      assert.equal(((await orphanRefresh.json()) as { error: string }).error, 'invalid_grant');
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
      assert.equal(
        (await tokenRequest(verifier)).status,
        400,
        'authorization codes are single-use',
      );
    } finally {
      await dispose();
    }
  },
);
