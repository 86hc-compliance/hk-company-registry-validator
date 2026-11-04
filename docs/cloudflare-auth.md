# Cloudflare authentication and agent compatibility

Implementation paths in this document are relative to `apps/platform/`.

The Worker retains Better Auth 1.7.16, the existing browser client, sessions, email/password login, email verification/reset, staff permissions, and OAuth 2.1 authorization-code/PKCE and refresh-token flows. OAuth Dynamic Client Registration (DCR), consent screens, MCP tools, ownership checks, and immediate grant revocation remain available.

Both client and resource administration require verified staff through explicit privilege hooks. Resource administration remains a server-only Better Auth API.

Auth data, verification tokens, refresh tokens, consent, and rate-limit counters live in D1. Apply `migrations/0001_cases.sql` and `0002_auth.sql` before serving traffic. The auth migration was generated from the installed Better Auth options, including its JWT and MCP plugins. Request handlers never run migrations. Production always requires verified email, including when `TPSI_MODE=test`; only the server's `APP_ENV=development` or `test` enables local verification bypass.

The Worker validates OAuth access tokens against Better Auth's local JWKS API, avoiding a request from the Worker to its own public hostname. Better Auth's verification primitives enforce the signature, issuer, audience, expiry, authorized client, scopes, and DPoP binding. DPoP proof replay reservations use D1. Revocations are checked against current D1 consent for every agent request. Revoking a connection atomically records a revocation timestamp and deletes the client/user consent, access-token rows, and refresh-token rows. A refresh hook also compares each source token’s creation time with that timestamp, fencing late writes from an in-flight rotation even after the customer reconnects. The provider captures a rotation’s creation time before claiming the old token; claims attempted after deletion fail. Revocation timestamps only advance, including under concurrent requests. The generic delete-consent endpoint is disabled so every connection revocation uses this path. The legacy Node server uses the same policy with a SQLite transaction.

Application API, signer, and registration limits use atomic D1 counters. Keys derive from the Cloudflare-provided `CF-Connecting-IP`, with IPv6 addresses grouped by /56. Caller-supplied `X-Forwarded-For` is ignored. Better Auth's additional authentication limits also use D1.

## URL-based client discovery

URL-based Client ID Metadata Document (CIMD) discovery is **disabled on the Worker** and is not advertised in OAuth metadata. Agent clients should use the advertised `registration_endpoint` to register through DCR. The original Node implementation remains in `server/auth.ts`.

Better Auth's [CIMD transport contract](https://better-auth.com/docs/plugins/cimd) requires resolving the remote hostname once, rejecting special-use addresses, pinning the approved address, and preserving the original TLS hostname and certificate verification. Its Node transport calls `dns.lookup`, which [Workers does not implement](https://developers.cloudflare.com/workers/runtime-apis/nodejs/dns/). Performing a DNS check and then using ordinary Fetch does not satisfy the pinning requirement.

A local workerd probe can connect using `startTls({ expectedServerHostname })`, but the runtime logs that option as unsupported. [Cloudflare workerd issue #6903](https://github.com/cloudflare/workerd/issues/6903) documents that the production edge ignores the hostname override. The unsupported socket transport was removed; it is not a production fallback. Re-enable CIMD only when an equivalent supported transport is available and verified on the production edge, or when a separately isolated secure transport service is introduced.

## Verification

`test/cloudflare-http.test.ts` runs the real Worker in workerd with D1 and R2, covering sign-up/session auth, case ownership, UTF-8 uploads/downloads, DCR, PKCE consent and authorization-code replay, signed JWT constraints, DPoP replay, MCP async tool output, and immediate revocation, including reconnect and late refresh-row insertion regressions. `test/cloudflare-http-security.test.ts` checks atomic counters and distinct client IPs, body/file limits, production verification flags, same-origin checks, security headers, SPA fallback, and accurate discovery metadata.
