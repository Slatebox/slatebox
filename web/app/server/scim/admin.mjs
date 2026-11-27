/* eslint-disable no-underscore-dangle, import/prefer-default-export */
// What a team admin manages for SCIM (Team settings › Sign-in & security): tokens, which group
// gives which role, and who receives the slates of someone turned off. The teamScim.* actions
// (server/actions/team-scim.mjs) call this; it is pure, with the store injected.
import { problem } from '../actions/errors.mjs'
import { ScimError } from './protocol.mjs'
import { ACTIVE_SCIM_TOKENS } from './tokens.mjs'
import { GROUP_ROLES, routableDomains } from './service.mjs'
import { SCIM_BASE } from './routes.mjs'

const iso = (value) => (value ? new Date(value).toISOString() : null)

/**
 * store: { teamPerson(userId) → { _id, orgId, isOrgOwner, isAdmin } | null, team(orgId),
 *          connections(orgId), groups(orgId) → [group], recipients(orgId) → [{ _id, name, email }],
 *          setRecipient(orgId, userId) }
 * tokens: createScimTokens. service: createScimService (mapGroup). gate(org): team-security.mjs.
 * origin(): this server's address. onEvent(entry): names and ids only.
 */
export function createTeamScimAdmin({ store, tokens, service, gate, origin, onEvent = () => {}, now = Date.now }) {
  async function teamAdmin(userId) {
    const person = userId ? await store.teamPerson(userId) : null
    if (!person?.orgId) throw problem(404, 'no_team', 'You are not in a team.')
    if (!person.isAdmin) throw problem(403, 'team_admin_required', 'Only a team admin can manage SCIM.')
    const team = await store.team(person.orgId)
    if (!team) throw problem(404, 'no_team', 'Your team was not found.')
    return { person, team }
  }
  async function changeable(userId) {
    const found = await teamAdmin(userId)
    if (!gate(found.team)) throw problem(403, 'not_available', 'Single sign-on and SCIM are not available for this team.')
    return found
  }
  const event = (entry) => {
    try { onEvent({ ...entry, at: now() }) } catch { /* reporting never fails a change */ }
  }

  async function get(userId) {
    const { team } = await teamAdmin(userId)
    const [connections, tokenList, groups, recipients] = await Promise.all([
      store.connections(team._id), tokens.list(team._id), store.groups(team._id), store.recipients(team._id),
    ])
    const domains = [...routableDomains(connections, now())].sort()
    const recipient = recipients.find((person) => person._id === team.scim?.recipientId) || recipients.find((person) => person.isOwner) || null
    return {
      available: Boolean(gate(team)),
      baseUrl: `${String(origin()).replace(/\/$/, '')}${SCIM_BASE}`,
      // SCIM provisions people at these domains only: verified, on an enabled connection.
      domains,
      tokens: tokenList.map((token) => ({
        tokenId: token._id,
        name: token.name,
        prefix: token.prefix,
        createdAt: iso(token.createdAt),
        lastUsedAt: iso(token.lastUsedAt),
        revokedAt: iso(token.revokedAt),
      })),
      maxTokens: ACTIVE_SCIM_TOKENS,
      groups: groups.map((group) => ({
        groupId: group._id, displayName: group.displayName, members: (group.members || []).length, role: group.role || null,
      })),
      recipient: recipient ? { userId: recipient._id, name: recipient.name, email: recipient.email } : null,
      recipients: recipients.map((person) => ({ userId: person._id, name: person.name, email: person.email, owner: Boolean(person.isOwner) })),
    }
  }

  async function createToken(userId, { name } = {}) {
    const { person, team } = await changeable(userId)
    try {
      const made = await tokens.create({ orgId: team._id, userId: person._id, name })
      event({ action: 'scim.tokenCreated', orgId: team._id, userId: person._id, tokenId: made.id })
      return { tokenId: made.id, token: made.token, prefix: made.prefix, name: made.name, createdAt: iso(made.createdAt) }
    } catch (error) {
      if (error?.code === 'too_many_tokens') throw problem(409, 'too_many_tokens', error.message)
      throw error
    }
  }

  // Revoking stays open when the switch is off: a team can always cut a provider off.
  async function revokeToken(userId, { tokenId }) {
    const { person, team } = await teamAdmin(userId)
    if (!(await tokens.revoke(team._id, tokenId))) throw problem(404, 'not_found', 'Token not found.')
    event({ action: 'scim.tokenRevoked', orgId: team._id, userId: person._id, tokenId })
    return { tokenId, revoked: true }
  }

  async function mapGroup(userId, { groupId, role }) {
    const { team } = await changeable(userId)
    if (role !== null && !GROUP_ROLES.includes(role)) throw problem(400, 'invalid_request', 'A group maps to admin, member or nothing.')
    try {
      return await service.mapGroup(team._id, groupId, role)
    } catch (error) {
      if (error instanceof ScimError) throw problem(error.status === 404 ? 404 : 400, error.status === 404 ? 'not_found' : 'invalid_request', error.message)
      throw error
    }
  }

  async function setRecipient(userId, { recipientId }) {
    const { person, team } = await changeable(userId)
    const recipients = await store.recipients(team._id)
    const chosen = recipients.find((candidate) => candidate._id === recipientId)
    if (!chosen) throw problem(400, 'invalid_request', 'Choose the owner or an admin of the team.')
    await store.setRecipient(team._id, chosen._id)
    event({ action: 'scim.recipientSet', orgId: team._id, userId: person._id, recipientId: chosen._id })
    return { recipient: { userId: chosen._id, name: chosen.name, email: chosen.email } }
  }

  return { get, createToken, revokeToken, mapGroup, setRecipient }
}
