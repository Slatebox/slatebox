/* eslint-disable no-underscore-dangle, no-await-in-loop, no-restricted-syntax, no-continue */
// SCIM 2.0 into Slatebox, the Meteor side: the real stores behind server/scim/service.mjs,
// tokens.mjs and admin.mjs, the /scim/v2 routes on the app's Express app, and the one sign-in
// rule SCIM adds (a disabled account signs in no way at all). Everything it calls is a plain
// module, unit-tested in scripts/scim.test.mjs.
import express from 'express'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { MongoInternals } from 'meteor/mongo'
import CONSTANTS from '../../imports/api/common/constants'
import {
  APILinks, LoginLinks, Organizations, Permissions, ScimGroups, ScimTokens, SlateApiTokens, Slates,
} from '../../imports/api/common/models'
import { teamSecurityOn } from '../../imports/api/common/team-security.mjs'
import { createTrustedUser } from '../common/accounts'
import { teamPerson } from '../common/team-person'
import { revokeCredentials } from '../sso/accounts.mjs'
import { Passkeys } from '../passkeys/meteor'
import { membersChanged } from '../methods/business'
import { clearedByAdmin } from '../team-guard.mjs'
import { createRateLimiter } from '../actions/rate-limit.mjs'
import { clientAddress } from '../actions/http.mjs'
import { createScimService, userMatches } from './service.mjs'
import { createScimTokens, SCIM_RATE_PER_MINUTE } from './tokens.mjs'
import { createTeamScimAdmin } from './admin.mjs'
import { disableModifier, disabledLoginRefusal } from './deprovision.mjs'
import { mountScim } from './routes.mjs'
import { audit, auditContext, withAuditContext } from '../audit/recorder.mjs'

const forwardedCount = Number.parseInt(process.env.HTTP_FORWARDED_COUNT, 10) || 0
const db = () => MongoInternals.defaultRemoteCollectionDriver().mongo.db
// Single sign-on connections (server/sso): read here for the team's verified domains, never written.
const ssoConnections = () => db().collection('ssoConnections')
const users = () => Meteor.users.rawCollection()
const credentials = { apiTokens: SlateApiTokens, loginLinks: LoginLinks, apiLinks: APILinks, passkeys: Passkeys }
const origin = () => Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()
const log = (line) => console.log(`scim: ${line}`) // eslint-disable-line no-console
const ADMIN = CONSTANTS.claims.admin._id

const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exactly = (text) => new RegExp(`^${escape(text)}$`, 'i')
const label = (user) => [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ') || user.emails?.[0]?.address || ''

const USER_FIELDS = {
  _id: 1, orgId: 1, emails: 1, profile: 1, createdAt: 1, isAnonymous: 1, isOrgOwner: 1, isDisabled: 1, disabledBy: 1, scim: 1, scimRole: 1, scimRemovedAt: 1,
}

/** The team's people a SCIM filter names, as a selector (the same rule as service.mjs userMatches). */
export function userSelector(orgId, query) {
  const and = [{ orgId, isAnonymous: { $ne: true }, scimRemovedAt: { $exists: false } }]
  if (query.id !== undefined) and.push({ _id: query.id })
  if (query.externalId !== undefined) and.push({ 'scim.externalId': query.externalId })
  if (query.email !== undefined) and.push({ 'emails.0.address': exactly(query.email) })
  // only the team's people at its verified domains (service.mjs managed)
  if (query.domains !== undefined) and.push({ 'emails.0.address': new RegExp(`@(${query.domains.map(escape).join('|')})$`, 'i') })
  if (query.userName !== undefined) {
    and.push({ $or: [
      { 'scim.userNameKey': String(query.userName).toLowerCase() },
      { 'scim.userNameKey': { $exists: false }, 'emails.0.address': exactly(query.userName) },
    ] })
  }
  return { $and: and }
}

async function page(collection, selector, { skip, count }, { sort, match, projection }) {
  if (!match) {
    const [total, docs] = await Promise.all([
      collection.countDocuments(selector),
      count === 0 ? [] : collection.find(selector, { projection, sort, skip, limit: count }).toArray(),
    ])
    return { total, docs }
  }
  // A displayName filter is checked here, on the team's people (the selector narrows to the team).
  const all = (await collection.find(selector, { projection, sort }).toArray()).filter(match)
  return { total: all.length, docs: all.slice(skip, skip + count) }
}

const store = {
  team: (orgId) => Organizations.rawCollection().findOne({ _id: orgId }, { projection: { _id: 1, name: 1, business: 1, scim: 1 } }),
  owner: (orgId) => users().findOne({ orgId, isOrgOwner: true }, { projection: USER_FIELDS }),
  // the team's own connections, and on a self-hosted server the bundled Keycloak's (server/sso)
  connections: async (orgId) => [
    ...await ssoConnections().find({ orgId }, { projection: { enabled: 1, domains: 1 } }).toArray(),
    // loaded when asked, so this module's place in the server's start-up order stays as it was
    ...await (await import('../sso')).serverConnectionsFor(orgId),
  ],
  userById: (orgId, id) => users().findOne({ _id: id, orgId }, { projection: USER_FIELDS }),
  userByEmail: (email) => Accounts.findUserByEmail(email, { fields: USER_FIELDS }),
  usersByIds: (orgId, ids) => users().find({ _id: { $in: ids }, orgId, isAnonymous: { $ne: true } }, { projection: USER_FIELDS }).toArray(),
  async listUsers(orgId, query, range) {
    const match = query.displayName !== undefined ? (user) => userMatches(user, query) : null
    const { total, docs } = await page(users(), userSelector(orgId, query), range, { sort: { createdAt: 1, _id: 1 }, match, projection: USER_FIELDS })
    return { total, users: docs }
  },
  async createUser({ email, givenName, familyName, orgId, scim }) {
    const userId = await createTrustedUser({ email, profile: { firstName: givenName, lastName: familyName } }, { orgId })
    // No password: the person signs in with SSO, which links this account by its verified address.
    await users().updateOne({ _id: userId }, { $set: { 'emails.0.verified': true, scim } })
    return userId
  },
  updateUser: (userId, modifier) => users().updateOne({ _id: userId }, modifier),
  async attachUser(userId, orgId, modifier) {
    const result = await users().updateOne(
      { _id: userId, isAnonymous: { $ne: true }, $or: [{ orgId }, { orgId: { $in: [null, ''] } }, { orgId: { $exists: false } }] },
      { ...modifier, $set: { ...modifier.$set, orgId } },
    )
    return result.matchedCount === 1
  },
  async endCredentials(userId) {
    await users().updateOne({ _id: userId }, { $set: { 'services.resume.loginTokens': [] }, $unset: { 'services.password': '' } })
    await revokeCredentials(credentials, userId)
  },
  membersChanged: async (orgId) => membersChanged(orgId),
  groupsOf: (orgId, userId) => ScimGroups.rawCollection().find({ orgId, members: userId }).toArray(),
  async listGroups(orgId, query, range) {
    const selector = { orgId, ...(query.id !== undefined && { _id: query.id }), ...(query.externalId !== undefined && { externalId: query.externalId }), ...(query.displayName !== undefined && { displayName: exactly(query.displayName) }) }
    const { total, docs } = await page(ScimGroups.rawCollection(), selector, range, { sort: { createdAt: 1, _id: 1 } })
    return { total, groups: docs }
  },
  groupById: (orgId, id) => ScimGroups.rawCollection().findOne({ _id: id, orgId }),
  groupByName: (orgId, displayName) => ScimGroups.rawCollection().findOne({ orgId, displayName: exactly(displayName) }),
  insertGroup: (doc) => ScimGroups.insertAsync(doc),
  updateGroup: (orgId, id, modifier) => ScimGroups.rawCollection().updateOne({ _id: id, orgId }, modifier),
  removeGroup: (orgId, id) => ScimGroups.rawCollection().deleteOne({ _id: id, orgId }),
  removeFromGroups: (orgId, userId) => ScimGroups.rawCollection().updateMany({ orgId, members: userId }, { $pull: { members: userId } }),
  // The team admin claim, as users.changeRoles gives it: it replaces the people claims it includes.
  // Never the server administrator claim, never another team's rows.
  async setAdmin(orgId, userId, on) {
    if (on) {
      await Permissions.removeAsync({ orgId, userId, claimId: { $in: clearedByAdmin() } })
      if (!(await Permissions.findOneAsync({ orgId, userId, claimId: ADMIN }, { fields: { _id: 1 } }))) await Permissions.insertAsync({ orgId, userId, claimId: ADMIN })
    } else {
      await Permissions.removeAsync({ orgId, userId, claimId: ADMIN })
    }
  },
  deprovision: {
    async signOut(userId) {
      await users().updateOne({ _id: userId }, { $set: { 'services.resume.loginTokens': [] } })
      await revokeCredentials(credentials, userId)
    },
    disable: (userId) => users().updateOne({ _id: userId }, disableModifier()),
    removeRoles: (orgId, userId) => Permissions.removeAsync({ orgId, userId }),
    moveSlates: (orgId, from, to) => Slates.updateAsync({ orgId, userId: from }, { $set: { userId: to, formerOwnerId: from } }, { multi: true }),
    membersChanged: async (orgId) => membersChanged(orgId),
  },
}

const gate = (org) => teamSecurityOn({ settings: Meteor.settings, org })
const describe = ({ action, orgId, userId, groupId, tokenId, role, slatesMoved, recipientId }) =>
  `${action} team ${orgId}${userId ? ` user ${userId}` : ''}${groupId ? ` group ${groupId}` : ''}${tokenId ? ` token ${tokenId}` : ''}${role ? ` role ${role}` : ''}${slatesMoved !== undefined ? ` slates moved ${slatesMoved}` : ''}${recipientId ? ` to ${recipientId}` : ''}`

// The activity log (server/audit). A request to /scim/v2 runs in a context naming its token
// (mountScimRoutes): its entries are the directory's. A team admin's teamScim.* call runs in the
// registry's context: its own entries (tokens, the recipient, a group's role) are recorded by the
// action's audit spec (actions/team-scim.mjs), and what follows from it here (roles changed) is
// the admin's.
const BY_ACTION_SPEC = new Set(['scim.tokenCreated', 'scim.tokenRevoked', 'scim.recipientSet', 'scim.groupMapped'])
async function personTarget(userId) {
  const user = userId ? await users().findOne({ _id: userId }, { projection: { profile: 1, emails: 1 } }) : null
  return { type: 'person', id: userId, ...(user && { name: label(user) }) }
}
async function groupTarget(orgId, groupId) {
  const group = groupId ? await ScimGroups.rawCollection().findOne({ _id: groupId, orgId }, { projection: { displayName: 1 } }) : null
  return { type: 'group', id: groupId, ...(group && { name: group.displayName }) }
}
async function recordScim(entry) {
  if (BY_ACTION_SPEC.has(entry.action)) return
  const context = auditContext()
  const fromDirectory = Boolean(context?.scimTokenId)
  const target = entry.groupId ? await groupTarget(entry.orgId, entry.groupId) : await personTarget(entry.userId)
  const details = {
    ...(entry.slatesMoved !== undefined && { count: entry.slatesMoved }),
    ...(entry.role && { role: entry.role }),
  }
  await audit.record({
    action: entry.action,
    orgId: entry.orgId,
    target,
    ...(Object.keys(details).length && { details }),
    ...(fromDirectory && { actor: { kind: 'scim', tokenId: context.scimTokenId }, via: 'scim' }),
  })
}
const onEvent = (entry) => {
  log(describe(entry))
  recordScim(entry).catch((error) => console.error('scim: activity log entry not written', error?.message)) // eslint-disable-line no-console
}

export const scimService = createScimService({ store, gate, onEvent })

export const scimTokens = createScimTokens({
  store: {
    insert: (doc) => ScimTokens.insertAsync(doc),
    findActiveByPrefix: (prefix) => ScimTokens.rawCollection().find({ prefix, revokedAt: null }).toArray(),
    listForTeam: (orgId) => ScimTokens.rawCollection().find({ orgId }, { sort: { createdAt: -1 }, limit: 20 }).toArray(),
    countActive: (orgId) => ScimTokens.rawCollection().countDocuments({ orgId, revokedAt: null }),
    async revoke(orgId, id, at) {
      const found = await ScimTokens.rawCollection().findOne({ _id: id, orgId }, { projection: { revokedAt: 1 } })
      if (!found) return false
      if (!found.revokedAt) await ScimTokens.rawCollection().updateOne({ _id: id, orgId, revokedAt: null }, { $set: { revokedAt: at } })
      return true
    },
    touch: (id, at) => ScimTokens.rawCollection().updateOne({ _id: id }, { $set: { lastUsedAt: at } }),
  },
})

// teamScim.* (server/actions/team-scim.mjs): the team admin's side.
export const teamScim = createTeamScimAdmin({
  store: {
    teamPerson,
    team: store.team,
    connections: store.connections,
    groups: (orgId) => ScimGroups.rawCollection().find({ orgId }, { sort: { displayName: 1 }, limit: 500 }).toArray(),
    async recipients(orgId) {
      const admins = (await Permissions.find({ orgId, claimId: ADMIN }, { fields: { userId: 1 } }).fetchAsync()).map((row) => row.userId)
      const people = await users().find(
        { orgId, isDisabled: { $ne: true }, isAnonymous: { $ne: true }, $or: [{ isOrgOwner: true }, { _id: { $in: admins } }] },
        { projection: { _id: 1, emails: 1, profile: 1, isOrgOwner: 1 }, sort: { isOrgOwner: -1, createdAt: 1 }, limit: 200 },
      ).toArray()
      return people.map((user) => ({ _id: user._id, name: label(user), email: user.emails?.[0]?.address || '', isOwner: user.isOrgOwner === true }))
    },
    setRecipient: (orgId, userId) => Organizations.rawCollection().updateOne({ _id: orgId }, { $set: { 'scim.recipientId': userId } }),
  },
  tokens: scimTokens,
  service: scimService,
  gate,
  origin,
  onEvent,
})

// 600 requests a minute per token, counted in the database so every app process counts the same.
const rate = createRateLimiter({
  collection: db().collection('apiRateWindows'),
  limits: { perToken: SCIM_RATE_PER_MINUTE, perAccount: SCIM_RATE_PER_MINUTE, perAddress: 0, perAccountOpenWorld: 0, windowSeconds: 60 },
})

export function mountScimRoutes(app) {
  mountScim(app, {
    express,
    authenticate: (header) => scimTokens.authenticate(header),
    service: scimService,
    limiter: { take: (tokenId) => rate.take({ kind: 'agent', tokenId: `scim:${tokenId}`, userId: `scim:${tokenId}` }) },
    origin,
    log: (line, error) => console.error(line, error?.stack || error), // eslint-disable-line no-console
    around: (caller, req, run) => withAuditContext({ scimTokenId: caller.tokenId, via: 'scim', address: clientAddress(req, forwardedCount) }, run),
  })
}

// A disabled account (turned off over SCIM, or by an administrator) signs in no way at all: no
// password, passkey, sign-in link, SSO or saved session.
Accounts.validateLoginAttempt((attempt) => {
  const refusal = disabledLoginRefusal(attempt)
  if (refusal) throw new Meteor.Error(403, refusal)
  return attempt.allowed
})

Meteor.startup(async () => {
  await Promise.all([
    ScimTokens.rawCollection().createIndex({ prefix: 1 }),
    ScimTokens.rawCollection().createIndex({ orgId: 1, createdAt: -1 }),
    ScimGroups.rawCollection().createIndex({ orgId: 1, displayName: 1 }),
    ScimGroups.rawCollection().createIndex({ orgId: 1, members: 1 }),
    users().createIndex({ orgId: 1, 'scim.userNameKey': 1 }),
  ])
})
