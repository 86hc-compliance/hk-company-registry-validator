# Norby company formation platform

繁體中文／English customer website, Norby operations workspace, OAuth-protected API and MCP. This app uses the original identifier validator and a curated, attributed preparation guide from the companion compliance repository.

Production targets Cloudflare Workers with D1, private R2, Workflows and Email Sending. See the [Cloudflare deployment and recovery guide](../../docs/cloudflare-deployment.md). The original Node server remains available for local previews and comparison tests.

**Official TPSI acceptance has not been performed**: no live credentials were supplied. Live prices, bank accounts, corporate details and contact URL are intentionally empty. There are no invented customer prices or automatic live filings.

## Local development

Requires Node.js 24+, npm and a writable persistent directory. Run from this directory:

```sh
npm ci
cp .env.example .env
# Edit NORBY_STAFF_EMAILS to your email.
npm run dev
```

Open http://localhost:3100. Register the staff email to access Settings; use another account to test customer permissions. Development uses an explicit preview banner, skips email verification, and generates local secrets. Use fictional data only. Configure each currency’s service/government amounts, beneficiary and bank details through Settings. TWD amounts are whole dollars, HKD/USD amounts have two decimal places. Quotes already accepted by customers retain their original prices and bank instructions.

After installing dependencies, you can also run `npm run dev` from the repository root (the default Conductor terminal directory). Keep that terminal running while using the preview; rerun the command if the server stops.

Never commit `.env`, `data/`, signing passwords, API tokens or customer documents. `.gitignore` and the root npm package file allowlist exclude them.

## Implemented workflow

1. Customer or authorized agent creates a draft. Natural-person shareholders and directors, ordinary fully paid shares, standard articles.
2. Customer reviews information, accepts the itemized quote, transfers funds and uploads evidence. Norby confirms the actual full deposit.
3. Norby checks identity, beneficial ownership, business purpose/source of funds and screening, records the result, and approves or requests information.
4. After approval, the background worker requests Registry validation. Each signer signs in to their own Norby account using the email recorded on the case and opens `/sign/<case-id>`. Share that link with the next signer; director consents are sequential, founder signs last. Each signature is checked through TPSI before it is recorded. The official password exists only for the request and is never persisted or exposed to the agent. Changing information invalidates approval and signatures.
5. Norby queues formal submission. A validated receipt records the separate HKD government deposit debit. A timeout, malformed response or restart moves the case to reconciliation; there is no automatic submission retry. For an ambiguous result, staff must upload and verify an official receipt before recording the government debit. An empty status result never means incorporation.
6. Norby obtains and checks the CI and BRC on the official portal, uploads both PDFs, verifies company details and marks delivery complete.
7. A review rejection before any submission attempt creates a full refund obligation. Norby records the actual refund and bank reference. Customer cancellation and refunds after submission are outside this automatic rule.

State changes create an email outbox entry in the case transaction. Cloudflare Email Sending delivers notifications in the case language with an authenticated case link, without identity documents or review details. Failed delivery retries with backoff up to six attempts; inspect `norby_notifications` for unresolved delivery. Delivery is at least once; a crash immediately after provider acceptance may duplicate a notice. The local Node backend uses SMTP instead.

## API and MCP

MCP endpoint: `/mcp`. Use OAuth login authorization, not API keys. Discovery is served at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/api/auth`. Cloudflare supports dynamic client registration (DCR), consent and PKCE with resource binding. URL-based CIMD discovery is unavailable in the Workers deployment because its socket API cannot preserve the required TLS hostname verification while pinning a resolved IP. The local Node implementation retains CIMD. Access tokens expire after five minutes; current consent and revocation are checked on every request.

Scopes: `cases:read`, `cases:write`. Agent tools: `list_cases`, `get_case`, `create_case`, `update_case`, `get_next_step`, `get_preparation_guide`, `validate_company_identifier`.

Authenticated REST endpoints share the same service:

| Method | Path | Behavior |
| --- | --- | --- |
| GET / POST | `/api/cases` | List owned cases / create draft |
| GET / PUT | `/api/cases/:id` | Read / replace editable application |
| POST | `/api/cases/:id/actions` | Enforce current version, stage and human/staff role |
| POST | `/api/cases/:id/files` | Human session; PDF/PNG/JPEG up to 10 MB |
| GET | `/api/cases/:id/files/:fileId` | Human session and case ownership; attachment download |
| GET / POST | `/api/sign/:id` | Verified signer session; view next signature / sign and verify |
| GET | `/api/connections` | List current OAuth grants |
| POST | `/api/connections/:id/revoke` | Revoke owned grant immediately |

Create, update and action requests require an `Idempotency-Key` (16–100 letters, digits, `_` or `-`). Update/actions require the latest `version`. A reused key with different content fails; a stale version fails. Do not automatically retry after a conflict. Agents cannot perform payment confirmation, KYC approval, signing, submission, refunds or certificate delivery, even if the authorizing user is staff.

## TPSI implementation and acceptance

Based on [API v1.0.15](https://www.e-services.cr.gov.hk/static/docx/TPSI%20API%20Interface%20v1.0.15.docx) and the embedded TPSI.html in [TPSIT User Guideline v1.0.6](https://www.e-services.cr.gov.hk/static/docx/TPSIT%20User%20Guideline%20v1.0.6.docx), released 25 October 2026. Authentication uses GET with the presentor ID and SHA-256 TPSI password in Basic authentication; other endpoints use Bearer authentication and SOAP. The implementation includes NNC1 mapping, XML signature checking, PIN credential encryption, sequential signatures, submission, balance enquiry and status parsing. Requests have a 120-second deadline and do not retry submission.

Before enabling production, use the official fictional accounts and perform:

- NNC1 validation with an actual configured TCSP secretary/address and each supported identity/address combination.
- Multiple directors and a founder, including Chinese names; compare XML serialization/signatures against the official sample and obtain successful PIN verification.
- A complete test submission and itemized receipt reconciliation; empty status, rejection and timeout exercises.
- The official guidance requires fictional test data. Test success checks syntax, not legal incorporation. Record acceptance evidence without passwords/tokens.

The PIN implementation follows the sample’s protocol-specific AES-ECB credential field, RSA key wrapping and AES-GCM signature field. It does not substitute a different cryptographic format. Registry certificates are taken only from the authenticated Registry HTTPS response and checked for XML signature integrity; no uploaded XML or third-party certificate is accepted.

## Build, verification and operation

```sh
npm run check
npm test
npm run test:e2e
npm run build:cloudflare
# After configuring secrets, migrations and production resources:
npm run deploy:cloudflare
```

The browser tests use Chrome on macOS when present, or a Playwright Chromium installation (`npx playwright install chromium`). They run an isolated preview server on port 3188 with fictional data under `.context/e2e-data` and save screenshots under `.context/`. `CHROME_EXECUTABLE` overrides the browser path. They do not contact TPSI or send email.

Cloudflare production requires HTTPS `BASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `DATA_ENCRYPTION_KEY` (32 bytes encoded in base64), verified staff emails, an onboarded Email Sending domain, D1 migrations and real operating details. Case data, uploaded documents and official XML/receipts are AES-256-GCM encrypted. Account emails, audit notes and operational metadata remain in the access-controlled database; audit notes must not contain passwords or document numbers. Keep the data encryption key separately from D1/R2 backups.

`npm run build` and `npm start` still build/run the optional Node backend. That backend needs a persistent SQLite volume and SMTP; these are not used by the Cloudflare deployment.

Workers uses Cloudflare's `CF-Connecting-IP` with durable D1 rate counters shared across isolates. The optional Node backend trusts a TLS reverse proxy on loopback by default, matching `HOST=127.0.0.1`. For a remote proxy, set `TRUST_PROXY` to its exact IP addresses or CIDRs and restrict access to the app port, following [Express's proxy configuration](https://expressjs.com/en/guide/behind-proxies/).

Email verification is required whenever Workers `APP_ENV=production` (or Node `NODE_ENV=production`), including with `TPSI_MODE=test`. `/api/public` exposes `emailVerificationRequired` independently of the TPSI preview banner so sign-up can direct customers to their inbox.

See the [data recovery procedure](../../docs/cloudflare-data.md) and [background job operations](../../docs/cloudflare-jobs.md) before live intake. No live Registry filing or real customer payment is part of deployment verification.

Live TPSI is refused outside production mode. Registry corrections and any proposed resubmission after an uncertain result require Norby to resolve the official record; the app never unlocks or retries a failed filing automatically. A customer cancellation is also handled manually rather than reusing the review-rejection refund rule.

See [confirmed product decisions](../../docs/norby-v1-spec.md) and [source attribution](../../third_party/awesome-hong-kong-corporate-compliance/NOTICE.md).
