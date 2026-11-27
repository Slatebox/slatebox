/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// SCIM 2.0 into Slatebox: what /scim/v2 does for a team, with the store injected. Pure: no Meteor;
// scripts/scim.test.mjs runs it against an in-memory store with the requests Okta and Microsoft
// Entra ID send. The Meteor store is server/scim/meteor.js; the routes are server/scim/routes.js.
//
// The rules:
// - A request is for the team its token belongs to (tokens.mjs); nothing reaches another team.
// - Users are the team's people. A new one must have an address in one of the team's verified
//   domains (else 400: a team cannot provision other people's addresses), and the team must have
//   an enabled single sign-on connection that routes that domain (else 400 "Connect single sign-on
//   first"): a provisioned person signs in with SSO and has no password.
// - An existing account with that address in no team, or in this team, is attached (orgId set,
//   scim { orgId, externalId, active } stored). One in another team is a 409 uniqueness. An
//   attached account whose address Slatebox never verified loses its password, sessions, tokens,
//   sign-in links and passkeys: whoever made it proves the address through SSO before using it.
// - active=false and DELETE turn the person off (deprovision.mjs); DELETE also drops the SCIM
//   link. Neither deletes the account or a slate.
// - Groups are kept per team. A team admin maps a group to a role (admin or member): a person in
//   an admin group is an admin, in a member group (and no admin group) a member. The owner is
//   never changed, and no group gives the server administrator claim (server/team-guard.mjs).
import {
  ScimError, listResponse, normalizePatch, parseFilter, patchUserBody, readGroupBody, readPage, readUserBody, renderGroup, renderUser,
} from './protocol.mjs'
import { deprovisionPlan, enableModifier, runDeprovision, DISABLED_BY_SCIM } from './deprovision.mjs'

export const GROUP_ROLES = Object.freeze(['admin', 'member'])
// A verified domain that has failed its daily DNS check this long stops routing (server/sso/domains.mjs).
export const DOMAIN_GRACE_MS = 7 * 24 * 3600_000
const ADDRESS = /^[^\s@]+@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export const domainOf = (email) => {
  const at = String(email || '').lastIndexOf('@')
  return at > 0 ? String(email).slice(at + 1).toLowerCase() : ''
}

/**
 * The domains a team's SSO routes today: verified, not failing for longer than the grace, on an
 * enabled connection. connections: the team's ssoConnections rows.
 */
export function routableDomains(connections, now = Date.now()) {
  const domains = new Set()
  for (const connection of connections || []) {
    if (connection?.enabled !== true) continue
    for (const entry of connection.domains || []) {
      if (!entry?.domain || !entry.verifiedAt) continue
      const failing = entry.failingSince ? new Date(entry.failingSince).getTime() : null
      if (failing && now - failing > DOMAIN_GRACE_MS) continue
      domains.add(String(entry.domain).toLowerCase())
    }
  }
  return domains
}

/** Every domain the team has verified, on any connection (enabled or not). */
export function verifiedDomains(connections) {
  const domains = new Set()
  for (const connection of connections || [])
    for (const entry of connection?.domains || []) if (entry?.domain && entry.verifiedAt) domains.add(String(entry.domain).toLowerCase())
  return domains
}

/** The role a person's groups give: admin wins over member; null when no group of theirs is mapped. */
export function roleFromGroups(groups) {
  const roles = new Set((groups || []).map((group) => group.role))
  if (roles.has('admin')) return 'admin'
  if (roles.has('member')) return 'member'
  return null
}

const lower = (value) => String(value ?? '').toLowerCase()

/**
 * Whether a team account matches a parsed filter (protocol.mjs parseFilter). The Meteor store
 * builds the same match as a selector (meteor.js); this is the rule both follow.
 */
export function userMatches(user, query) {
  if (query.never) return false
  const email = lower(user.emails?.[0]?.address)
  // SCIM sees only the team's people at its verified domains (see managed below).
  if (query.domains !== undefined && !query.domains.includes(domainOf(email))) return false
  if (query.id !== undefined && user._id !== query.id) return false
  if (query.userName !== undefined && lower(user.scim?.userName || email) !== lower(query.userName)) return false
  if (query.externalId !== undefined && (user.scim?.externalId ?? null) !== query.externalId) return false
  if (query.email !== undefined && email !== lower(query.email)) return false
  if (query.displayName !== undefined) {
    const name = user.scim?.displayName || [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || email
    if (lower(name) !== lower(query.displayName)) return false
  }
  return true
}

export function groupMatches(group, query) {
  if (query.never) return false
  if (query.id !== undefined && group._id !== query.id) return false
  if (query.displayName !== undefined && lower(group.displayName) !== lower(query.displayName)) return false
  if (query.externalId !== undefined && (group.externalId ?? null) !== query.externalId) return false
  return true
}

/**
 * What the provider last said about a person, as a User body: the base a PatchOp applies to. The
 * display name is the provider's only when it sent one, so a later name change still shows.
 */
export function userBodyOf(user) {
  const email = user.emails?.[0]?.address || ''
  return {
    userName: user.scim?.userName || email,
    ...(user.scim?.externalId && { externalId: user.scim.externalId }),
    ...(user.scim?.displayName && { displayName: user.scim.displayName }),
    name: { givenName: user.profile?.firstName || '', familyName: user.profile?.lastName || '' },
    emails: email ? [{ value: email, type: 'work', primary: true }] : [],
    active: user.isDisabled !== true,
  }
}

const ok = (body, status = 200) => ({ status, body })
const noContent = () => ({ status: 204, body: null })
const notFound = (what) => new ScimError(404, `${what} not found.`)
const label = (user) => [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || user.emails?.[0]?.address || ''

/** The SCIM link stored on an account: who provisioned it and what the provider calls it. */
export function scimLink({ orgId, input, now, created }) {
  return {
    orgId,
    userName: input.userName,
    userNameKey: lower(input.userName),
    ...(input.externalId && { externalId: input.externalId }),
    ...(input.displayName && { displayName: input.displayName }),
    active: input.active,
    ...(created && { createdAt: new Date(now) }),
    updatedAt: new Date(now),
  }
}

/**
 * store: see scripts/scim.test.mjs memoryStore for every call and its contract. gate(org) → whether
 * the team's security features are on (imports/api/common/team-security.mjs): reads always answer,
 * writes are refused when it is off. onEvent(entry): what happened (names and ids only).
 */
export function createScimService({ store, gate = () => true, onEvent = () => {}, now = Date.now }) {
  async function teamFor(orgId) {
    const team = await store.team(orgId)
    if (!team) throw new ScimError(401, 'This SCIM token is not valid.')
    return team
  }
  async function writable(orgId) {
    const team = await teamFor(orgId)
    if (!gate(team)) throw new ScimError(403, 'Single sign-on and SCIM are not available for this team.')
    return team
  }

  // The address must be in a verified domain of the team, routed by an enabled connection.
  async function checkAddress(orgId, email) {
    if (!ADDRESS.test(email)) throw new ScimError(400, 'Give the person a work email address (emails or userName).', 'invalidValue')
    const connections = await store.connections(orgId)
    const domain = domainOf(email)
    if (!verifiedDomains(connections).has(domain))
      throw new ScimError(400, `${domain} is not a verified domain of this team. Verify it in Team settings › Sign-in & security first.`, 'invalidValue')
    if (!routableDomains(connections, now()).has(domain))
      throw new ScimError(400, `Connect single sign-on first: no enabled connection signs in people at ${domain}.`, 'invalidValue')
  }

  const event = (entry) => {
    try { onEvent({ ...entry, at: now() }) } catch { /* reporting never fails a request */ }
  }

  // The people SCIM manages: the team's, at one of its verified domains. A member with an address
  // elsewhere (a contractor at their own company or at gmail.com) has an account the team's
  // directory does not own: SCIM neither lists, changes, turns off nor groups them, so a directory
  // cannot rewrite their address and take the account over, or switch off their own slates.
  async function managedDomains(orgId) {
    return [...verifiedDomains(await store.connections(orgId))]
  }
  const managed = (user, domains) => domains.includes(domainOf(lower(user?.emails?.[0]?.address)))

  async function visibleUser(orgId, id) {
    const user = typeof id === 'string' && id ? await store.userById(orgId, id) : null
    if (!user || user.isAnonymous || user.orgId !== orgId || user.scimRemovedAt) throw notFound('User')
    if (!managed(user, await managedDomains(orgId))) throw notFound('User')
    return user
  }

  async function userResource(user, base) {
    return renderUser(user, { base, groups: await store.groupsOf(user.orgId, user._id) })
  }

  // ---- roles from groups -----------------------------------------------------------------------

  async function applyRoles(orgId, userIds) {
    const owner = await store.owner(orgId)
    for (const userId of new Set(userIds)) {
      if (owner && userId === owner._id) continue
      const user = await store.userById(orgId, userId)
      if (!user || user.orgId !== orgId || user.isAnonymous || user.isDisabled || user.isOrgOwner) continue
      const role = roleFromGroups(await store.groupsOf(orgId, userId))
      const before = user.scimRole ?? null
      if (role === before) continue
      // A group's role is the role: admin gives the admin claim, member takes it away. A person
      // whose mapped groups are gone loses only the admin claim a group gave them.
      if (role === 'admin') await store.setAdmin(orgId, userId, true)
      else if (role === 'member' || before === 'admin') await store.setAdmin(orgId, userId, false)
      await store.updateUser(userId, role ? { $set: { scimRole: role } } : { $unset: { scimRole: '' } })
      event({ action: 'scim.roleChanged', orgId, userId, role: role || 'unmapped' })
    }
  }

  // ---- turning people off and on ---------------------------------------------------------------

  async function turnOff(team, user) {
    if (user.isOrgOwner) throw new ScimError(400, 'The team owner cannot be turned off over SCIM. Make someone else the owner first.', 'mutability')
    const owner = await store.owner(team._id)
    const chosen = team.scim?.recipientId ? await store.userById(team._id, team.scim.recipientId) : null
    const recipient = chosen && !chosen.isDisabled && chosen._id !== user._id ? chosen : owner
    const plan = deprovisionPlan(user, { orgId: team._id, recipientId: recipient?._id })
    const result = await runDeprovision(plan, store.deprovision)
    if (user.scimRole) await store.updateUser(user._id, { $unset: { scimRole: '' } })
    event({ action: 'scim.userDeactivated', orgId: team._id, userId: user._id, slatesMoved: result.moved, ...(recipient && { recipientId: recipient._id }) })
    return result
  }

  async function turnOn(team, user) {
    if (user.isDisabled !== true) return
    // Only an account SCIM turned off: one a server administrator disabled stays off.
    if (user.disabledBy !== DISABLED_BY_SCIM) throw new ScimError(400, 'This account was turned off by an administrator and cannot be turned on over SCIM.', 'mutability')
    await store.updateUser(user._id, enableModifier())
    await store.membersChanged(team._id)
    await applyRoles(team._id, [user._id])
    event({ action: 'scim.userReactivated', orgId: team._id, userId: user._id })
  }

  // ---- users ---------------------------------------------------------------------------------

  async function listUsers(orgId, query, base) {
    await teamFor(orgId)
    const filter = { ...parseFilter(query.filter, 'user'), domains: await managedDomains(orgId) }
    const page = readPage(query)
    const { total, users } = filter.never || !filter.domains.length ? { total: 0, users: [] } : await store.listUsers(orgId, filter, page)
    const resources = []
    for (const user of users) resources.push(await userResource(user, base))
    return ok(listResponse(resources, { total, startIndex: page.startIndex }))
  }

  async function getUser(orgId, id, base) {
    await teamFor(orgId)
    return ok(await userResource(await visibleUser(orgId, id), base))
  }

  async function createUser(orgId, body, base) {
    const team = await writable(orgId)
    const input = readUserBody(body)
    await checkAddress(orgId, input.email)
    const at = now()
    const existing = await store.userByEmail(input.email)
    let userId
    if (existing) {
      if (existing.isAnonymous) throw new ScimError(409, 'That address belongs to a guest.', 'uniqueness')
      if (existing.orgId && existing.orgId !== orgId)
        throw new ScimError(409, 'This address already belongs to another Slatebox team.', 'uniqueness')
      if (existing.orgId === orgId && existing.scim && !existing.scimRemovedAt)
        throw new ScimError(409, 'This person is already provisioned. Look them up by userName.', 'uniqueness')
      const set = { scim: scimLink({ orgId, input, now: at, created: true }) }
      if (input.givenName) set['profile.firstName'] = input.givenName
      if (input.familyName) set['profile.lastName'] = input.familyName
      const joined = await store.attachUser(existing._id, orgId, { $set: set, $unset: { scimRemovedAt: '' } })
      if (!joined) throw new ScimError(409, 'This address already belongs to another Slatebox team.', 'uniqueness')
      // An address Slatebox never verified proves nothing: the account is the company's person's
      // only once they sign in with SSO, so whatever opened it before stops working.
      const verified = (existing.emails || []).some((entry) => entry?.verified === true && lower(entry.address) === input.email)
      if (!verified) await store.endCredentials(existing._id)
      userId = existing._id
      event({ action: 'scim.userAttached', orgId, userId })
    } else {
      userId = await store.createUser({
        email: input.email,
        givenName: input.givenName,
        familyName: input.familyName,
        orgId,
        scim: scimLink({ orgId, input, now: at, created: true }),
      })
      event({ action: 'scim.userCreated', orgId, userId })
    }
    let user = await store.userById(orgId, userId)
    if (input.active === false) await turnOff(team, user)
    else {
      if (user.isDisabled) await turnOn(team, user)
      await store.membersChanged(orgId)
    }
    user = await store.userById(orgId, userId)
    return ok(await userResource(user, base), 201)
  }

  // A PUT, and a PATCH once applied: the provider's view of the person replaces Slatebox's.
  async function replaceUser(team, user, input, base) {
    const orgId = team._id
    const set = { 'scim.userName': input.userName, 'scim.userNameKey': lower(input.userName), 'scim.active': input.active, 'scim.updatedAt': new Date(now()) }
    const unset = {}
    if (input.externalId) set['scim.externalId'] = input.externalId
    else unset['scim.externalId'] = ''
    if (input.displayName) set['scim.displayName'] = input.displayName
    else unset['scim.displayName'] = ''
    set['profile.firstName'] = input.givenName
    set['profile.lastName'] = input.familyName
    const current = lower(user.emails?.[0]?.address)
    if (input.email && input.email !== current) {
      // The owner's address is theirs to change: a directory that rewrote it could reset the owner's password.
      if (user.isOrgOwner) throw new ScimError(400, "The team owner's address cannot be changed over SCIM.", 'mutability')
      await checkAddress(orgId, input.email)
      const other = await store.userByEmail(input.email)
      if (other && other._id !== user._id) throw new ScimError(409, 'Another account already has this address.', 'uniqueness')
      set['emails.0.address'] = input.email
      set['emails.0.verified'] = true
    }
    if (!user.scim) {
      set['scim.orgId'] = orgId
      set['scim.createdAt'] = new Date(now())
    }
    await store.updateUser(user._id, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) })
    event({ action: 'scim.userUpdated', orgId, userId: user._id })
    const fresh = await store.userById(orgId, user._id)
    if (input.active === false && fresh.isDisabled !== true) await turnOff(team, fresh)
    if (input.active === true && fresh.isDisabled === true) await turnOn(team, fresh)
    return ok(await userResource(await store.userById(orgId, user._id), base))
  }

  async function putUser(orgId, id, body, base) {
    const team = await writable(orgId)
    const user = await visibleUser(orgId, id)
    return replaceUser(team, user, readUserBody(body), base)
  }

  async function patchUser(orgId, id, body, base) {
    const team = await writable(orgId)
    const user = await visibleUser(orgId, id)
    const ops = normalizePatch(body)
    const patched = patchUserBody(userBodyOf(user), ops)
    return replaceUser(team, user, readUserBody(patched), base)
  }

  async function deleteUser(orgId, id) {
    const team = await writable(orgId)
    const user = await visibleUser(orgId, id)
    if (user.isOrgOwner) throw new ScimError(400, 'The team owner cannot be removed over SCIM. Make someone else the owner first.', 'mutability')
    await turnOff(team, user)
    await store.removeFromGroups(orgId, user._id)
    await store.updateUser(user._id, { $unset: { scim: '' }, $set: { scimRemovedAt: new Date(now()) } })
    event({ action: 'scim.userRemoved', orgId, userId: user._id })
    return noContent()
  }

  // ---- groups --------------------------------------------------------------------------------

  async function groupResource(group, base, { excludeMembers = false } = {}) {
    const members = excludeMembers ? [] : (await store.usersByIds(group.orgId, group.members || [])).map((user) => ({ _id: user._id, label: label(user) }))
    return renderGroup(group, { base, members, excludeMembers })
  }

  const excludesMembers = (query) => /(^|,)\s*members\s*(,|$)/i.test(String(query.excludedAttributes || ''))

  async function teamMemberIds(orgId, ids) {
    if (!ids.length) return []
    const users = await store.usersByIds(orgId, ids)
    const domains = await managedDomains(orgId)
    const known = new Set(users.filter((user) => !user.scimRemovedAt && managed(user, domains)).map((user) => user._id))
    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length) throw new ScimError(400, `Not people of this team: ${unknown.slice(0, 5).join(', ')}.`, 'invalidValue')
    return ids
  }

  async function visibleGroup(orgId, id) {
    const group = typeof id === 'string' && id ? await store.groupById(orgId, id) : null
    if (!group || group.orgId !== orgId) throw notFound('Group')
    return group
  }

  async function listGroups(orgId, query, base) {
    await teamFor(orgId)
    const filter = parseFilter(query.filter, 'group')
    const page = readPage(query)
    const { total, groups } = filter.never ? { total: 0, groups: [] } : await store.listGroups(orgId, filter, page)
    const resources = []
    for (const group of groups) resources.push(await groupResource(group, base, { excludeMembers: excludesMembers(query) }))
    return ok(listResponse(resources, { total, startIndex: page.startIndex }))
  }

  async function getGroup(orgId, id, query, base) {
    await teamFor(orgId)
    return ok(await groupResource(await visibleGroup(orgId, id), base, { excludeMembers: excludesMembers(query) }))
  }

  async function uniqueName(orgId, displayName, exceptId) {
    const same = await store.groupByName(orgId, displayName)
    if (same && same._id !== exceptId) throw new ScimError(409, 'A group with this displayName exists.', 'uniqueness')
  }

  async function createGroup(orgId, body, base) {
    await writable(orgId)
    const input = readGroupBody(body)
    await uniqueName(orgId, input.displayName)
    const members = await teamMemberIds(orgId, input.memberIds)
    const at = new Date(now())
    const id = await store.insertGroup({ orgId, displayName: input.displayName, ...(input.externalId && { externalId: input.externalId }), members, role: null, createdAt: at, updatedAt: at })
    event({ action: 'scim.groupCreated', orgId, groupId: id })
    return ok(await groupResource(await store.groupById(orgId, id), base), 201)
  }

  async function saveGroup(orgId, group, next) {
    const set = { displayName: next.displayName, members: next.members, updatedAt: new Date(now()) }
    const unset = {}
    if (next.externalId) set.externalId = next.externalId
    else unset.externalId = ''
    await store.updateGroup(orgId, group._id, { $set: set, ...(Object.keys(unset).length && { $unset: unset }) })
    event({ action: 'scim.groupUpdated', orgId, groupId: group._id })
    if (group.role) await applyRoles(orgId, [...(group.members || []), ...next.members])
  }

  async function putGroup(orgId, id, body, base) {
    await writable(orgId)
    const group = await visibleGroup(orgId, id)
    const input = readGroupBody(body)
    await uniqueName(orgId, input.displayName, group._id)
    const members = await teamMemberIds(orgId, input.memberIds)
    await saveGroup(orgId, group, { displayName: input.displayName, externalId: input.externalId, members })
    return ok(await groupResource(await store.groupById(orgId, group._id), base))
  }

  async function patchGroup(orgId, id, body) {
    await writable(orgId)
    const group = await visibleGroup(orgId, id)
    const next = { displayName: group.displayName, externalId: group.externalId || '', members: [...(group.members || [])] }
    const valuesOf = (value) => (Array.isArray(value) ? value : [value]).map((item) => (item && typeof item === 'object' ? item.value : item)).filter((v) => typeof v === 'string' && v)
    for (const { op, path, value } of normalizePatch(body)) {
      if (path === 'displayname') {
        if (op === 'remove' || typeof value !== 'string' || !value.trim()) throw new ScimError(400, 'displayName is required.', 'invalidValue')
        next.displayName = value.trim().slice(0, 200)
      } else if (path === 'externalid') {
        next.externalId = op === 'remove' ? '' : String(value ?? '').slice(0, 256)
      } else if (path === 'members') {
        const ids = value === undefined || value === null ? null : valuesOf(value)
        if (op === 'remove') next.members = ids ? next.members.filter((member) => !ids.includes(member)) : []
        else if (op === 'replace') next.members = [...new Set(ids || [])]
        else next.members = [...new Set([...next.members, ...(ids || [])])]
      } else if (path === 'id' || path === 'schemas' || path === 'meta') {
        // Okta's path-less replace repeats the id; it changes nothing.
      } else {
        throw new ScimError(400, `A group's ${path} cannot be changed.`, 'invalidPath')
      }
    }
    if (next.displayName !== group.displayName) await uniqueName(orgId, next.displayName, group._id)
    const added = next.members.filter((member) => !(group.members || []).includes(member))
    await teamMemberIds(orgId, added)
    await saveGroup(orgId, group, next)
    return noContent()
  }

  async function deleteGroup(orgId, id) {
    await writable(orgId)
    const group = await visibleGroup(orgId, id)
    await store.removeGroup(orgId, group._id)
    event({ action: 'scim.groupRemoved', orgId, groupId: group._id })
    if (group.role) await applyRoles(orgId, group.members || [])
    return noContent()
  }

  // ---- team admin (teamScim.mapGroup) --------------------------------------------------------

  /** A team admin maps a group to a role (or unmaps it with null); its people's roles follow. */
  async function mapGroup(orgId, groupId, role) {
    await writable(orgId)
    if (role !== null && !GROUP_ROLES.includes(role)) throw new ScimError(400, 'A group maps to admin, member or nothing.', 'invalidValue')
    const group = await visibleGroup(orgId, groupId)
    await store.updateGroup(orgId, group._id, { $set: { role, updatedAt: new Date(now()) } })
    event({ action: 'scim.groupMapped', orgId, groupId: group._id, role: role || 'unmapped' })
    await applyRoles(orgId, group.members || [])
    return { groupId: group._id, role }
  }

  return {
    listUsers, getUser, createUser, putUser, patchUser, deleteUser,
    listGroups, getGroup, createGroup, putGroup, patchGroup, deleteGroup,
    mapGroup, applyRoles,
  }
}
