import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHttpServer } from './http-server';

const productionEnv = {
  NODE_ENV: 'production',
  BASE_URL: 'https://norby.example.test',
  // No test invokes mail delivery or the Registry.
  SMTP_URL: 'smtp://127.0.0.1:9',
  MAIL_FROM: 'Norby <noreply@example.test>',
};

test(
  'production proxy requests get separate API, MCP, signer and registration limits',
  { timeout: 30000 },
  async (t) => {
    const server = await startHttpServer(productionEnv);
    t.after(server.close);
    const routes = [
      { path: '/api/public', limit: 120, status: 200, method: 'GET' },
      { path: '/mcp', limit: 120, status: 405, method: 'GET' },
      { path: '/api/sign/fictional-case', limit: 5, status: 400, method: 'POST' },
      // Better Auth also applies a five-per-minute burst limit in production.
      { path: '/api/auth/oauth2/register', limit: 20, burstLimit: 5, status: 404, method: 'GET' },
    ];
    for (const [index, route] of routes.entries()) {
      await t.test(route.path, async () => {
        const client = `203.0.113.${index * 2 + 1}`;
        const other = `203.0.113.${index * 2 + 2}`;
        const request = (forwarded: string) =>
          fetch(`${server.base}${route.path}`, {
            method: route.method,
            headers: { 'X-Forwarded-For': forwarded, 'Content-Type': 'application/json' },
            ...(route.method === 'POST' ? { body: '{}' } : {}),
          });
        for (let i = 0; i < route.limit; i++) {
          const response = await request(client);
          assert.equal(
            response.status,
            i < (route.burstLimit ?? route.limit) ? route.status : 429,
            await response.text(),
          );
          assert.equal(response.headers.get('ratelimit-remaining'), String(route.limit - i - 1));
          if (route.burstLimit && i >= route.burstLimit)
            assert.ok(
              response.headers.get('x-retry-after'),
              'The inner burst limit responds while the hourly bucket still counts requests',
            );
        }
        assert.equal((await request(client)).status, 429);
        assert.equal(
          (await request(other)).status,
          route.status,
          'Another client keeps its own allowance',
        );
        assert.equal(
          (await request(`198.51.100.10, ${client}`)).status,
          429,
          'Prepending a forged address cannot reset the limit',
        );
      });
    }
  },
);

test(
  'forwarding headers from an untrusted peer cannot bypass limits',
  { timeout: 15000 },
  async (t) => {
    const server = await startHttpServer({ TRUST_PROXY: '10.0.0.10' });
    t.after(server.close);
    for (let i = 0; i < 6; i++) {
      const response = await fetch(`${server.base}/api/sign/fictional-case`, {
        method: 'POST',
        headers: { 'X-Forwarded-For': `203.0.113.${i + 1}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, i < 5 ? 400 : 429);
    }
  },
);

test('explicit proxy chains keep separate client limits', { timeout: 15000 }, async (t) => {
  const server = await startHttpServer({ TRUST_PROXY: 'loopback,10.0.0.10' });
  t.after(server.close);
  const request = (ip: string) =>
    fetch(`${server.base}/api/sign/fictional-case`, {
      method: 'POST',
      headers: { 'X-Forwarded-For': `${ip}, 10.0.0.10`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  for (let i = 0; i < 5; i++) assert.equal((await request('203.0.113.1')).status, 400);
  assert.equal((await request('203.0.113.1')).status, 429);
  assert.equal((await request('203.0.113.2')).status, 400);
});

for (const scenario of [
  { name: 'development', env: {}, preview: true, verification: false },
  {
    name: 'production with TPSI test mode',
    env: { ...productionEnv, TPSI_MODE: 'test' },
    preview: true,
    verification: true,
  },
  { name: 'production with TPSI disabled', env: productionEnv, preview: false, verification: true },
]) {
  test(
    `public email verification policy is independent of preview: ${scenario.name}`,
    { timeout: 15000 },
    async (t) => {
      const server = await startHttpServer(scenario.env);
      t.after(server.close);
      const response = await fetch(`${server.base}/api/public`);
      assert.equal(response.status, 200);
      const config = (await response.json()) as {
        preview: boolean;
        emailVerificationRequired: boolean;
      };
      assert.equal(config.preview, scenario.preview);
      assert.equal(config.emailVerificationRequired, scenario.verification);
    },
  );
}
