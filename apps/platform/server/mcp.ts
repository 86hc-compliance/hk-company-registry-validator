import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { requireMcpAuth } from '@better-auth/mcp';
import { z } from 'zod';
import type { Auth } from './auth.js';
import type { CaseService } from './cases.js';
import {
  applicationSchema,
  currencySchema,
  localeSchema,
  DomainError,
  requireCondition,
  type Actor,
} from '../shared/domain.js';
import { config } from './config.js';
import { knowledge } from '../shared/knowledge.js';
import { validateBRN, validateCRNumber } from './registry-number.js';

export function agentFromClaims(service: CaseService, claims: Record<string, unknown>): Actor {
  requireCondition(
    typeof claims.sub === 'string' && typeof claims.azp === 'string',
    'INVALID_TOKEN',
    401,
  );
  const consent = service.db
    .prepare('SELECT scopes FROM oauthConsent WHERE userId=? AND clientId=?')
    .get(claims.sub, claims.azp) as { scopes: string } | undefined;
  requireCondition(consent, 'AUTHORIZATION_REVOKED', 401);
  const revoked = service.db
    .prepare('SELECT revoked_at FROM norby_revocations WHERE user_id=? AND client_id=?')
    .get(claims.sub, claims.azp) as { revoked_at: number } | undefined;
  requireCondition(
    typeof claims.iat === 'number' && (!revoked || claims.iat * 1000 > revoked.revoked_at),
    'AUTHORIZATION_REVOKED',
    401,
  );
  const granted = typeof claims.scope === 'string' ? claims.scope.split(' ') : [];
  const current = (() => {
    try {
      return JSON.parse(consent.scopes) as string[];
    } catch {
      return consent.scopes.split(' ');
    }
  })();
  return {
    id: claims.sub,
    kind: 'agent',
    clientId: claims.azp,
    scopes: granted.filter((s) => current.includes(s)),
  };
}
export function createAgentHandler(auth: Auth, service: CaseService) {
  return requireMcpAuth(
    auth,
    async (request, claims) => {
      let actor: Actor;
      try {
        actor = agentFromClaims(service, claims);
      } catch {
        return Response.json(
          { error: 'AUTHORIZATION_REVOKED' },
          {
            status: 401,
            headers: {
              'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource/mcp"`,
            },
          },
        );
      }
      const handler = createMcpHandler(
        () => {
          const server = new McpServer({ name: 'norby-company-formation', version: '0.1.0' });
          const result = (fn: () => unknown) => {
            try {
              return { content: [{ type: 'text' as const, text: JSON.stringify(fn()) }] };
            } catch (e) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      error: e instanceof DomainError ? e.code : 'INVALID_REQUEST',
                    }),
                  },
                ],
              };
            }
          };
          server.registerTool(
            'get_preparation_guide',
            {
              description:
                'Source-linked preparation guidance adapted from the open-source HK compliance guide. This is not compliance approval.',
              inputSchema: z.object({}),
              annotations: { readOnlyHint: true },
            },
            () => result(() => knowledge),
          );
          server.registerTool(
            'validate_company_identifier',
            {
              description:
                'Check BRN or legacy CR number format using the original validator. A valid format is not proof of existence or KYC approval.',
              inputSchema: z.object({ kind: z.enum(['BRN', 'CR']), value: z.string().max(100) }),
              annotations: { readOnlyHint: true },
            },
            ({ kind, value }) =>
              result(() => ({
                ...(kind === 'BRN' ? validateBRN(value) : validateCRNumber(value)),
                officialRecordVerified: false,
              })),
          );
          server.registerTool(
            'list_cases',
            {
              description:
                'List incorporation cases owned by the authorizing customer. Does not expose other customers.',
              inputSchema: z.object({}),
              annotations: { readOnlyHint: true },
            },
            () => result(() => service.list(actor)),
          );
          server.registerTool(
            'get_case',
            {
              description:
                'Read case information, missing fields, timeline and payment status. Payment confirmation and review are staff-only.',
              inputSchema: z.object({ caseId: z.uuid() }),
              annotations: { readOnlyHint: true },
            },
            ({ caseId }) => result(() => service.get(actor, caseId)),
          );
          server.registerTool(
            'create_case',
            {
              description:
                'Create a draft Hong Kong private company case with natural-person founders and standard articles. Reuse idempotencyKey when retrying. The customer must review, accept the quote and pay on the website.',
              inputSchema: z.object({
                locale: localeSchema,
                currency: currencySchema,
                data: applicationSchema.optional(),
                idempotencyKey: z.string().min(16).max(100),
              }),
              annotations: { readOnlyHint: false, destructiveHint: false },
            },
            ({ idempotencyKey, ...input }) =>
              result(() => {
                const c = service.create(actor, input, idempotencyKey);
                return { ...c, nextActionUrl: `${config.baseUrl}/cases/${c.id}` };
              }),
          );
          server.registerTool(
            'update_case',
            {
              description:
                'Replace editable draft or requested information using the current version. Never collect official signing passwords. Existing approved or filed data cannot be edited.',
              inputSchema: z.object({
                caseId: z.uuid(),
                version: z.number().int(),
                data: applicationSchema,
                idempotencyKey: z.string().min(16).max(100),
              }),
              annotations: { readOnlyHint: false, destructiveHint: false },
            },
            ({ caseId, idempotencyKey, ...input }) =>
              result(() => service.update(actor, caseId, input, idempotencyKey)),
          );
          server.registerTool(
            'get_next_step',
            {
              description:
                'Get the authenticated customer handoff URL and outstanding data checks. The agent cannot pay, approve compliance, sign for people, submit to the Registry or mark incorporation complete.',
              inputSchema: z.object({ caseId: z.uuid() }),
              annotations: { readOnlyHint: true },
            },
            ({ caseId }) =>
              result(() => {
                const c = service.get(actor, caseId);
                return {
                  status: c.status,
                  missing: c.issues,
                  customerUrl: `${config.baseUrl}/cases/${caseId}`,
                };
              }),
          );
          return server;
        },
        { legacy: 'stateless' },
      );
      return handler.fetch(request);
    },
    { resource: `${config.baseUrl}/mcp`, requiredScopes: ['cases:read'] },
  );
}
