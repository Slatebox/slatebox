import { defineAction } from './registry.mjs'
import { tokenRecord } from './token-schemas.mjs'

export default defineAction({
  id: 'apiTokens.list',
  title: 'List API tokens',
  description:
    'Signed in, lists every token of your account. Called with a token, lists that token only: a token never sees the others.',
  toolset: 'account',
  kind: 'read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/tokens', operationId: 'listApiTokens' } },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: { tokens: { type: 'array', items: tokenRecord } },
    required: ['tokens'],
  },
  cli: { command: 'tokens' },
  async handler(principal, _input, { deps }) {
    const onlyTokenId = principal.kind === 'agent' ? principal.tokenId : undefined
    return { tokens: await deps.apiTokens.listApiTokens(principal.userId, { onlyTokenId }) }
  },
})
