import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { tokenRecord } from './token-schemas.mjs'
import { ACTIVE_TOKEN_LIMIT, API_TOKEN_SCOPES } from '../api-token-core.mjs'

// Minting is for a signed-in person only. A token cannot make another token: a read token
// could otherwise make a write token that outlives its own revocation.
export default defineAction({
  id: 'apiTokens.create',
  title: 'Create an API token',
  description: `Creates a token with the chosen permissions and returns its secret once. An account holds up to ${ACTIVE_TOKEN_LIMIT} active tokens.`,
  toolset: 'account',
  kind: 'write',
  principals: ['person'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 200 },
      scopes: { type: 'array', minItems: 1, items: { type: 'string', enum: API_TOKEN_SCOPES } },
    },
    required: ['scopes'],
    additionalProperties: false,
  },
  output: {
    ...tokenRecord,
    properties: { ...tokenRecord.properties, id: { type: 'string' }, token: { type: 'string' } },
    required: ['id', 'token', 'name', 'prefix', 'scopes', 'createdAt'],
  },
  async handler(principal, input, { deps }) {
    if ((await deps.apiTokens.countActiveApiTokens(principal.userId)) >= ACTIVE_TOKEN_LIMIT)
      throw problem(
        409,
        'token_limit',
        `You have ${ACTIVE_TOKEN_LIMIT} active tokens. Revoke one before creating another.`
      )
    return deps.apiTokens.createApiToken({
      userId: principal.userId,
      name: input.name,
      scopes: input.scopes,
    })
  },
})
