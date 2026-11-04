import {
  createDpopReplayStore,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
  verifyJwsAccessToken,
} from 'better-auth/oauth2';
import { DomainError, requireCondition } from '../shared/domain';
import type { Auth } from './auth';

/** Verify with the local auth API instead of fetching this Worker's own public JWKS URL. */
export async function verifyAgentToken(request: Request, auth: Auth, baseUrl: string) {
  const authorization = parseAccessTokenAuthorization(request.headers.get('authorization'));
  requireCondition(
    authorization?.token && authorization.scheme !== 'Unknown',
    'INVALID_TOKEN',
    401,
  );
  const context = await auth.$context;
  let claims;
  try {
    claims = await verifyJwsAccessToken(authorization.token, {
      jwksFetch: () => auth.api.getJwks(),
      verifyOptions: {
        issuer: context.baseURL,
        audience: `${baseUrl}/mcp`,
        requiredClaims: ['azp', 'sub', 'iat', 'exp'],
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error instanceof TypeError ||
        ('code' in error && /^ERR_(JOSE|JWT|JWS|JWK)/.test(String(error.code))))
    )
      throw new DomainError('INVALID_TOKEN', 401);
    throw error;
  }
  requireCondition(
    typeof claims.scope === 'string' &&
      claims.scope.split(' ').every((scope) => /^[\x21\x23-\x5b\x5d-\x7e]+$/.test(scope)),
    'INVALID_TOKEN',
    401,
  );
  requireCondition(claims.scope.split(' ').includes('cases:read'), 'INSUFFICIENT_SCOPE', 403);
  try {
    await enforceDpopBinding({
      payload: claims,
      authorization,
      proofJwt: request.headers.get('dpop'),
      method: request.method,
      url: request.url,
      replayStore: createDpopReplayStore(context.internalAdapter),
    });
  } catch (error) {
    if (isDpopBindingError(error))
      throw new DomainError(
        error.code === 'invalid_dpop_proof' ? 'INVALID_DPOP_PROOF' : 'INVALID_TOKEN',
        401,
      );
    throw error;
  }
  return claims;
}

export function protectAgentRequest(
  auth: Auth,
  baseUrl: string,
  handler: (
    request: Request,
    claims: Awaited<ReturnType<typeof verifyAgentToken>>,
  ) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    let claims;
    try {
      claims = await verifyAgentToken(request, auth, baseUrl);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const insufficient = error.status === 403;
      const challenge = insufficient
        ? 'insufficient_scope'
        : error.code === 'INVALID_DPOP_PROOF'
          ? 'invalid_dpop_proof'
          : 'invalid_token';
      return Response.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: insufficient ? -32003 : -32001, message: error.code },
        },
        {
          status: error.status,
          headers: {
            'WWW-Authenticate': `Bearer error="${challenge}", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"${insufficient ? ', scope="cases:read"' : ''}`,
          },
        },
      );
    }
    return handler(request, claims);
  };
}
