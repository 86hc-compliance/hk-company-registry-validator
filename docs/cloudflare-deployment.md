# Cloudflare deployment

Norby runs as one Worker serving the Vite frontend and the native HTTP API. D1 holds account/case records and durable rate counters; private R2 holds encrypted documents and large Registry artifacts; Workflows processes Registry jobs; a cron repairs dispatch and delivers the D1 email outbox. The Node server is only an optional local/reference backend.

Deployed on 4 November 2026. Both custom domains are attached to the Worker; the public `workers.dev` hostname is disabled after preview verification. All 57 automated tests, type checking, formatting and the Worker startup check passed. HTTPS production checks cover the homepage, frontend assets, sign-in deep link, API authorization, origin protection, OAuth discovery, and an apex 308 redirect that preserves path/query for GET and POST.

## Production resources

| Resource | Name |
| --- | --- |
| Worker | `norby-platform` |
| Canonical website | `https://www.norby.tw` |
| Apex | `https://norby.tw`, redirects to the canonical host |
| D1 | `norby-platform-db` (`9e9e5438-7f38-4157-b2a6-414736d9e972`, APAC) |
| Private R2 | `norby-platform-documents` (APAC) |
| Workflow | `norby-platform-registry-jobs` |
| Email sender | `Norby <noreply@norby.tw>` |

The existing Cloudflare account has Workers Paid and R2. No plan upgrade was made. Email Sending uses `cf-bounce.norby.tw` and its DKIM record. Existing Titan MX/SPF and DMARC records remain in place. Email body previews are disabled so verification/reset links are not retained in activity-log previews.

The production database starts empty. The local preview contained fictional data and was not imported. Set prices, bank details, secretary/TCSP details and the contact URL in Settings after registering and verifying the configured staff email. `TPSI_MODE=disabled` until real credentials, operating details and official acceptance are completed.

## Deploy

From `apps/platform`, use the official `cf` CLI and `cloudflare.config.ts`. Do not add a Wrangler configuration file. Dependencies pin the CLI and runtime; npm scripts use the bundled Node 24.22 executable.

```sh
npm ci
npx cf auth whoami
npm run types:cloudflare
npm run check
npm test
npm run build:cloudflare
npx cf workers check --mode production --prebuilt
npx cf d1 migrations apply 9e9e5438-7f38-4157-b2a6-414736d9e972 --dir migrations
npx cf deploy --mode production --prebuilt --dry-run
npx cf deploy --mode production --prebuilt
```

For the first deployment or an intentional secret change, add `--secrets-file /absolute/path/to/protected.json` to `cf deploy`. Use JSON with `BETTER_AUTH_SECRET`, `DATA_ENCRYPTION_KEY` and `NORBY_STAFF_EMAILS`; keep the file mode 0600 outside version control. Never generate a new data key for an existing deployment without migrating encrypted records and objects. Existing remote secrets persist across deployments that omit the secrets file.

The initial secret backup is `.context/cloudflare-migration/production-secrets.json` (mode 0600, ignored by Git). Retain a separate secure copy before deleting this workspace; the data key is required to recover encrypted D1/R2 data. No credential values are included in deployment logs or this guide.

Production config uses `APP_ENV=production` even when TPSI is in test mode. Never set a development environment on a public production deployment. Preview/test runs use local simulated mail and fictional data. The frontend shares the Worker origin, so there is no separate CORS or cross-domain cookie setup.

## Verification and compatibility

Native Miniflare/workerd tests exercise real D1 transactions and R2 storage, concurrent idempotency, payment/refund/reference checks, Unicode file downloads, signing leases, Workflow replay recovery, outbox leases, signup/session, OAuth/PKCE/DCR/MCP and immediate revocation. Cryptographic tests cross-check Worker TPSI signatures and wire formats with Node. No test sends customer email or contacts the live Registry.

Workers uses DCR for OAuth client registration. URL-based CIMD discovery is deliberately absent: Workers' TLS socket implementation cannot currently honor the hostname override required for secure IP-pinned fetching. See [authentication notes](cloudflare-auth.md). This does not weaken TLS verification or allow an unguarded metadata fetch fallback.

Logs and traces are enabled with query-string redaction. Do not log credentials, verification URLs, uploaded files or Registry XML. R2 public access must remain disabled. See [data recovery](cloudflare-data.md) and [job operations](cloudflare-jobs.md).

## Domain cutover and rollback

Before the first cutover, the original DNS records were exported to `.context/cloudflare-migration/dns-before.json`. `www.norby.tw` pointed at Swipe Pages; the apex A record pointed at `34.102.136.180`. Only these web host bindings are replaced; unrelated subdomains and email records are preserved.

Cloudflare rejected the existing external A/CNAME records even with the CLI overwrite option. After verifying their IDs/content, the two web records were removed in one DNS batch, then `cf workers triggers deploy --mode production --prebuilt` attached both custom domains. Original non-web records were compared after cutover and remained unchanged. Exact restore/delete request bodies, final DNS/Worker snapshots and smoke-test output are saved in `.context/cloudflare-migration/`.

To return to the previous website, first remove the two Norby Worker custom-domain bindings, then restore the exact apex A and `www` CNAME records from the snapshot, including their proxy/TTL settings. This requires coordinating the Worker config so the next deployment does not reattach the custom domains. Keep the D1 database, R2 objects and encryption key intact; reverting a website does not require deleting customer data. Cloudflare's per-Worker deployment history can roll back application code independently of DNS.

Page Rules and Rulesets were not modified. Their API read permissions were outside the CLI grant; the original apex redirect can remain in place if supplied by an existing rule. HTTPS checks of both hosts are required after any cutover.
