import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { tokenIdInput } from './token-schemas.mjs'

// Signed in, a person revokes any token of their account. A token revokes itself only
// (tokenId current, or its own ID): that is how an agent signs out.
export default defineAction({
  id: 'apiTokens.revoke',
  title: 'Revoke an API token',
  description:
    'Revokes a token at once; the next call made with it answers 401. Called with a token, revokes that token only (use current), which signs the agent out.',
  toolset: 'account',
  kind: 'write',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'DELETE', path: '/tokens/{tokenId}', operationId: 'revokeApiToken' } },
  destructive: true,
  idempotent: true,
  successStatus: 200,
  input: {
    type: 'object',
    properties: { tokenId: tokenIdInput },
    required: ['tokenId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { tokenId: { type: 'string' }, revoked: { const: true }, mode: { const: 'save' } },
    required: ['tokenId', 'revoked'],
  },
  async handler(principal, input, { deps }) {
    const tokenId =
      principal.kind === 'agent' && input.tokenId === 'current' ? principal.tokenId : input.tokenId
    const allowed = principal.kind !== 'agent' || tokenId === principal.tokenId
    if (!allowed || !(await deps.apiTokens.revokeApiToken(principal.userId, tokenId)))
      throw problem(404, 'not_found', 'Token not found.')
    return { tokenId, revoked: true }
  },
})
