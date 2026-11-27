// SCIM for a team admin (Team settings › Sign-in & security): tokens, groups mapped to roles, and
// who receives the slates of someone their company turns off. Person only: a SCIM token is made
// and shown in the app, never by an agent. The work is in server/scim/admin.mjs.
import { defineAction } from './registry.mjs'

const id = { type: 'string', pattern: '^[A-Za-z0-9]{1,40}$' }
const token = {
  type: 'object',
  properties: {
    tokenId: { type: 'string' },
    name: { type: 'string' },
    prefix: { type: 'string' },
    createdAt: { type: 'string' },
    lastUsedAt: { type: ['string', 'null'] },
    revokedAt: { type: ['string', 'null'] },
  },
}
const person = {
  type: 'object',
  properties: { userId: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, owner: { type: 'boolean' } },
}
const common = { toolset: 'team', principals: ['person'], mounts: { ddp: true } }

export const teamScimGet = defineAction({
  ...common,
  id: 'teamScim.get',
  title: 'SCIM settings',
  description: 'For a team admin: the SCIM address, the domains it provisions, the tokens (never their secrets), the groups and their roles, and who receives the slates of someone turned off.',
  kind: 'read',
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      available: { type: 'boolean' },
      baseUrl: { type: 'string' },
      domains: { type: 'array', items: { type: 'string' } },
      tokens: { type: 'array', items: token },
      maxTokens: { type: 'integer' },
      groups: {
        type: 'array',
        items: { type: 'object', properties: { groupId: { type: 'string' }, displayName: { type: 'string' }, members: { type: 'integer' }, role: { type: ['string', 'null'] } } },
      },
      recipient: { type: ['object', 'null'] },
      recipients: { type: 'array', items: person },
    },
    required: ['available', 'baseUrl', 'domains', 'tokens', 'groups', 'recipients'],
  },
  handler: (principal, _input, { deps }) => deps.teamScim.get(principal.userId),
})

export const teamScimCreateToken = defineAction({
  ...common,
  id: 'teamScim.createToken',
  title: 'Create a SCIM token',
  description: 'For a team admin: a new SCIM token for the team\'s identity provider, shown once. A team has at most two, so a new one can be set before the old one is revoked.',
  kind: 'write',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { name: { type: 'string', maxLength: 80 } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { tokenId: { type: 'string' }, token: { type: 'string' }, prefix: { type: 'string' }, name: { type: 'string' }, createdAt: { type: 'string' } },
    required: ['tokenId', 'token'],
  },
  audit: { action: 'scim.tokenCreated', target: (_input, output) => ({ type: 'token', id: output?.tokenId, name: output?.name }) },
  handler: (principal, input, { deps }) => deps.teamScim.createToken(principal.userId, input),
})

export const teamScimRevokeToken = defineAction({
  ...common,
  id: 'teamScim.revokeToken',
  title: 'Revoke a SCIM token',
  description: 'For a team admin: the token stops working at once; the identity provider\'s next request answers 401.',
  kind: 'write',
  destructive: true,
  idempotent: true,
  successStatus: 200,
  input: { type: 'object', properties: { tokenId: id }, required: ['tokenId'], additionalProperties: false },
  output: { type: 'object', properties: { tokenId: { type: 'string' }, revoked: { const: true } }, required: ['tokenId', 'revoked'] },
  audit: { action: 'scim.tokenRevoked', target: (input) => ({ type: 'token', id: input.tokenId }) },
  handler: (principal, input, { deps }) => deps.teamScim.revokeToken(principal.userId, input),
})

export const teamScimMapGroup = defineAction({
  ...common,
  id: 'teamScim.mapGroup',
  title: 'Map a group to a role',
  description: 'For a team admin: the people in a group the identity provider sends become admins, or members, of the team (admin wins over member); null unmaps it. The owner never changes.',
  kind: 'write',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { groupId: id, role: { type: ['string', 'null'], enum: ['admin', 'member', null] } },
    required: ['groupId', 'role'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { groupId: { type: 'string' }, role: { type: ['string', 'null'] } }, required: ['groupId'] },
  audit: { action: 'scim.groupMapped', target: (input) => ({ type: 'group', id: input.groupId }), details: (input) => ({ role: input.role || 'no role change' }) },
  handler: (principal, input, { deps }) => deps.teamScim.mapGroup(principal.userId, input),
})

export const teamScimSetRecipient = defineAction({
  ...common,
  id: 'teamScim.setRecipient',
  title: 'Choose who receives departing members\' slates',
  description: 'For a team admin: the owner or admin who receives the team slates of someone turned off over SCIM.',
  kind: 'write',
  successStatus: 200,
  input: { type: 'object', properties: { recipientId: id }, required: ['recipientId'], additionalProperties: false },
  output: { type: 'object', properties: { recipient: person }, required: ['recipient'] },
  audit: { action: 'scim.recipientSet', target: (_input, output) => ({ type: 'person', id: output?.recipient?.userId, name: output?.recipient?.name || output?.recipient?.email }) },
  handler: (principal, input, { deps }) => deps.teamScim.setRecipient(principal.userId, input),
})

export default [teamScimGet, teamScimCreateToken, teamScimRevokeToken, teamScimMapGroup, teamScimSetRecipient]
