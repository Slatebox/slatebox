import { defineAction } from './registry.mjs'
import { tokenLike } from './principal.mjs'
import { inviteRole, ref, shareIdInput } from './slate-schemas.mjs'

export default defineAction({
  id: 'slates.issueInvite',
  title: 'Share by invitation',
  description:
    'The registered owner turns on an unlisted link. Changing its role keeps the address. Public slates are changed in the Share dialog. Anyone holding the address gets the role.',
  toolset: 'sharing',
  kind: 'write',
  scope: 'slates:share',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/invite', operationId: 'createSlateInvite' } },
  idempotency: 'required',
  // A repeat is answered from the current link, never from a stored copy of an address
  // that may have been withdrawn since, so the core runs again and reads its receipt.
  replay: 'rerun',
  idempotent: true,
  openWorld: true,
  confirm: true,
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, role: inviteRole },
    required: ['shareId', 'role'],
    additionalProperties: false,
  },
  output: ref('Invitation'),
  failure: { code: 'invite_update_failed', message: 'The request could not be completed. Retry with the same key.' },
  tool: { name: 'create_slate_invite', title: 'Share a slate by invitation link', description: 'Turn on an unlisted invitation link to a slate, or change the role it gives. Anyone holding the link gets that role.' },
  cli: { command: 'share' },
  handler: (principal, input, { deps, idempotencyKey }) =>
    deps.manageInvite({
      token: tokenLike(principal),
      shareId: input.shareId,
      revoke: false,
      key: idempotencyKey,
      body: { role: input.role },
    }),
})
