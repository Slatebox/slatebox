import { defineAction } from './registry.mjs'
import { tokenLike } from './principal.mjs'
import { inviteId, shareIdInput } from './slate-schemas.mjs'

export default defineAction({
  id: 'slates.revokeInvite',
  title: 'Unshare',
  description:
    'Withdraws exactly this invitation. Named team grants stay. Repeating the request confirms the same withdrawal; a newer invitation is never withdrawn by an old command.',
  toolset: 'sharing',
  kind: 'write',
  scope: 'slates:share',
  principals: ['agent'],
  mounts: {
    http: { method: 'DELETE', path: '/slates/{shareId}/invite/{inviteId}', operationId: 'revokeSlateInvite' },
  },
  idempotency: 'required',
  replay: 'rerun',
  idempotent: true,
  destructive: true,
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, inviteId },
    required: ['shareId', 'inviteId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { shareId: { type: 'string' }, inviteId, revoked: { const: true }, mode: { const: 'save' } },
    required: ['shareId', 'inviteId', 'revoked'],
  },
  failure: { code: 'invite_update_failed', message: 'The request could not be completed. Retry with the same key.' },
  tool: { name: 'revoke_slate_invite', title: 'Withdraw a slate\'s invitation link', description: 'Withdraw a slate\'s unlisted invitation link and make the slate private again.' },
  handler: (principal, input, { deps, idempotencyKey }) =>
    deps.manageInvite({
      token: tokenLike(principal),
      shareId: input.shareId,
      inviteId: input.inviteId,
      revoke: true,
      key: idempotencyKey,
      body: undefined,
    }),
})
