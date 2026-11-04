# Source attribution

The preparation guide in `apps/platform/shared/knowledge.ts` adapts the organisation of formation preparation, due diligence and ongoing compliance topics from [86hc-compliance/awesome-hong-kong-corporate-compliance](https://github.com/86hc-compliance/awesome-hong-kong-corporate-compliance), inspected 2026-11-04. The upstream MIT notice is retained in this directory. The app contains concise rewritten guidance and direct official links, not a merged copy of all upstream claims or any endorsement by the upstream authors.

The upstream repository contains a guide and license, not a KYC review engine. Norby’s workflow, review records, roles, payments and TPSI integration are new code in this repository. No 86HC service credentials, remote MCP service or private verification endpoint is reused.

The upstream UBI description was not carried forward: the Registry identifies the first eight BR certificate digits as the UBI. A validator output ending in `-000` is a base-number/branch-code representation, not the UBI definition. See the [official UBI flyer](https://www.cr.gov.hk/en/publications/docs/UBI_Flyer-e.pdf).

Official TPSI examples informed the wire implementation in `server/tpsi.ts`. Their API documents remain external reference material, not vendored runtime code. The sample’s outdated browser CDN dependencies are not loaded by this platform.

UI research: [private Agentic Search](https://www.lazyweb.com/agentic-search/5dda2869-524f-4baf-ae1f-40b3f5d5d725). Case progress and document collection evidence informed the action-oriented case overview and per-person evidence workflow.
