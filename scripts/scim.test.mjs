// SCIM 2.0 directly into Slatebox (/scim/v2, server/scim): the filter and PatchOp shapes Okta and
// Microsoft Entra ID send, tokens, the team's verified domains, provisioning, groups mapped to
// roles, what turning someone off does (signed out everywhere, tokens gone, slates moved and never
// deleted, the bill follows), turning them on again, the error shape, and the one switch that
// decides who has it (imports/api/common/team-security.mjs). The modules are plain ES modules; the
// store is in memory here and Mongo in server/scim/meteor.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import express from 'express'
import {
  SCHEMA, ScimError, normalizePatch, parseFilter, patchUserBody, readPage, readUserBody, renderUser,
} from '../web/app/server/scim/protocol.mjs'
import { ACTIVE_SCIM_TOKENS, bearerScimToken, createScimTokens, hashScimToken, mintScimToken } from '../web/app/server/scim/tokens.mjs'
import { DOMAIN_GRACE_MS, createScimService, roleFromGroups, routableDomains, userMatches } from '../web/app/server/scim/service.mjs'
import { DISABLED_MESSAGE, deprovisionPlan, disabledLoginRefusal } from '../web/app/server/scim/deprovision.mjs'
import { createTeamScimAdmin } from '../web/app/server/scim/admin.mjs'
import { isScimPath, mountScim } from '../web/app/server/scim/routes.mjs'
import { TEAM_SECURITY, teamSecurityOn } from '../web/app/imports/api/common/team-security.mjs'
import { acceptedMember, MEMBER_FIELDS } from '../web/app/server/business-billing.mjs'
import { scimCardState } from '../web/app/imports/ui/components/teams/security/scim-card-model.mjs'
import teamScimActions from '../web/app/server/actions/team-scim.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0)
const BASE = 'https://app.example.test/scim/v2'

// ---- an in-memory store with the same contract as server/scim/meteor.js -----------------------

function setPath(doc, path, value) {
  const parts = path.split('.')
  let at = doc
  for (const part of parts.slice(0, -1)) {
    if (at[part] === undefined || at[part] === null) at[part] = /^\d+$/.test(part) ? [] : {}
    at = at[part]
  }
  at[parts.at(-1)] = value
}
function unsetPath(doc, path) {
  const parts = path.split('.')
  let at = doc
  for (const part of parts.slice(0, -1)) {
    at = at?.[part]
    if (!at) return
  }
  delete at[parts.at(-1)]
}
function apply(doc, modifier) {
  for (const [path, value] of Object.entries(modifier.$set || {})) setPath(doc, path, structuredClone(value))
  for (const path of Object.keys(modifier.$unset || {})) unsetPath(doc, path)
}
let ids = 0
const newId = (prefix) => `${prefix}${String(++ids).padStart(6, '0')}`

function memoryStore() {
  const db = {
    orgs: new Map(), users: new Map(), connections: [], groups: new Map(), permissions: [], slates: [],
    credentialsEnded: [], membersChanged: [],
  }
  const team = (orgId) => db.orgs.get(orgId) || null
  const inTeam = (orgId) => (user) => user.orgId === orgId && !user.isAnonymous && !user.scimRemovedAt
  const clone = (value) => (value ? structuredClone(value) : null)
  const store = {
    db,
    team: async (orgId) => clone(team(orgId)),
    owner: async (orgId) => clone([...db.users.values()].find((user) => user.orgId === orgId && user.isOrgOwner)),
    connections: async (orgId) => clone(db.connections.filter((c) => c.orgId === orgId)),
    userById: async (orgId, id) => {
      const user = db.users.get(id)
      return user && user.orgId === orgId ? clone(user) : null
    },
    userByEmail: async (email) => clone([...db.users.values()].find((user) => user.emails?.[0]?.address?.toLowerCase() === email.toLowerCase())),
    usersByIds: async (orgId, list) => list.map((id) => db.users.get(id)).filter((user) => user && user.orgId === orgId && !user.isAnonymous).map(clone),
    async listUsers(orgId, query, { skip, count }) {
      const all = [...db.users.values()].filter(inTeam(orgId)).filter((user) => userMatches(user, query))
      return { total: all.length, users: all.slice(skip, skip + count).map(clone) }
    },
    async createUser({ email, givenName, familyName, orgId, scim }) {
      const _id = newId('u')
      db.users.set(_id, { _id, orgId, emails: [{ address: email, verified: true }], profile: { firstName: givenName, lastName: familyName }, createdAt: new Date(NOW), scim, services: {} })
      return _id
    },
    updateUser: async (id, modifier) => apply(db.users.get(id), modifier),
    async attachUser(id, orgId, modifier) {
      const user = db.users.get(id)
      if (!user || user.isAnonymous || (user.orgId && user.orgId !== orgId)) return false
      apply(user, { ...modifier, $set: { ...modifier.$set, orgId } })
      return true
    },
    async endCredentials(id) {
      db.credentialsEnded.push(id)
      const user = db.users.get(id)
      delete user.services.password
      user.services.resume = { loginTokens: [] }
    },
    membersChanged: async (orgId) => { db.membersChanged.push(orgId) },
    groupsOf: async (orgId, userId) => [...db.groups.values()].filter((g) => g.orgId === orgId && g.members.includes(userId)).map(clone),
    async listGroups(orgId, query, { skip, count }) {
      const { groupMatches } = await import('../web/app/server/scim/service.mjs')
      const all = [...db.groups.values()].filter((g) => g.orgId === orgId && groupMatches(g, query))
      return { total: all.length, groups: all.slice(skip, skip + count).map(clone) }
    },
    groupById: async (orgId, id) => {
      const group = db.groups.get(id)
      return group && group.orgId === orgId ? clone(group) : null
    },
    groupByName: async (orgId, name) => clone([...db.groups.values()].find((g) => g.orgId === orgId && g.displayName.toLowerCase() === name.toLowerCase())),
    async insertGroup(doc) {
      const _id = newId('g')
      db.groups.set(_id, { _id, ...structuredClone(doc) })
      return _id
    },
    updateGroup: async (orgId, id, modifier) => apply(db.groups.get(id), modifier),
    removeGroup: async (orgId, id) => db.groups.delete(id),
    removeFromGroups: async (orgId, userId) => {
      for (const group of db.groups.values()) if (group.orgId === orgId) group.members = group.members.filter((m) => m !== userId)
    },
    async setAdmin(orgId, userId, on) {
      db.permissions = db.permissions.filter((p) => !(p.orgId === orgId && p.userId === userId && (p.claimId === 'admin' || (on && p.claimId.startsWith('can')))))
      if (on) db.permissions.push({ orgId, userId, claimId: 'admin' })
    },
    deprovision: {
      async signOut(userId) {
        const user = db.users.get(userId)
        user.services.resume = { loginTokens: [] }
        user.signedOutEverywhere = true
      },
      disable: async (userId) => Object.assign(db.users.get(userId), { isDisabled: true, disabledBy: 'scim' }),
      removeRoles: async (orgId, userId) => { db.permissions = db.permissions.filter((p) => !(p.orgId === orgId && p.userId === userId)) },
      async moveSlates(orgId, from, to) {
        let moved = 0
        for (const slate of db.slates) {
          if (slate.orgId === orgId && slate.userId === from) {
            slate.userId = to
            slate.formerOwnerId = from
            moved += 1
          }
        }
        return moved
      },
      membersChanged: async (orgId) => { db.membersChanged.push(orgId) },
    },
  }
  return store
}

/** A team "Acme" owning acme.test (verified, on an enabled connection), with its owner Olive. */
function acme({ connection = true, verified = true, enabled = true } = {}) {
  const store = memoryStore()
  const { db } = store
  db.orgs.set('acme', { _id: 'acme', name: 'Acme', scim: {} })
  db.orgs.set('other', { _id: 'other', name: 'Other' })
  db.users.set('olive', { _id: 'olive', orgId: 'acme', isOrgOwner: true, emails: [{ address: 'olive@acme.test', verified: true }], profile: { firstName: 'Olive', lastName: 'Owner' }, services: {} })
  if (connection) {
    db.connections.push({ orgId: 'acme', enabled, domains: [{ domain: 'acme.test', token: 't', ...(verified && { verifiedAt: new Date(NOW - 86_400_000) }) }] })
  }
  db.connections.push({ orgId: 'other', enabled: true, domains: [{ domain: 'other.test', verifiedAt: new Date(NOW) }] })
  const service = createScimService({ store, now: () => NOW })
  return { store, db, service }
}

const userBody = (extra = {}) => ({
  schemas: [SCHEMA.user],
  userName: 'ada@acme.test',
  name: { givenName: 'Ada', familyName: 'Lovelace' },
  emails: [{ value: 'ada@acme.test', type: 'work', primary: true }],
  active: true,
  ...extra,
})

const refusal = (status, scimType, detail) => (error) => {
  assert.ok(error instanceof ScimError, `a ScimError, not ${error}`)
  assert.equal(error.status, status)
  if (scimType) assert.equal(error.scimType, scimType)
  if (detail) assert.match(error.message, detail)
  return true
}

// ---- protocol ---------------------------------------------------------------------------------

test('filters: the lookups Okta and Entra send, and nothing else', () => {
  assert.deepEqual(parseFilter('userName eq "Ada@Acme.test"'), { userName: 'Ada@Acme.test' })
  assert.deepEqual(parseFilter('externalId eq "00u1abc"'), { externalId: '00u1abc' })
  assert.deepEqual(parseFilter('emails[type eq "work"].value eq "ada@acme.test"'), { email: 'ada@acme.test' })
  assert.deepEqual(parseFilter('emails[ type eq "work" ].value eq "ada@acme.test"'), { email: 'ada@acme.test' })
  assert.deepEqual(parseFilter('id eq "u1" and userName eq "ada"'), { id: 'u1', userName: 'ada' })
  assert.deepEqual(parseFilter('USERNAME EQ "ada"'), { userName: 'ada' })
  assert.deepEqual(parseFilter('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "ada"'), { userName: 'ada' })
  assert.deepEqual(parseFilter('userName eq "say \\"hi\\""'), { userName: 'say "hi"' })
  assert.deepEqual(parseFilter('displayName eq "Admins"', 'group'), { displayName: 'Admins' })
  assert.deepEqual(parseFilter('id eq "a" and id eq "b"'), { never: true })
  assert.deepEqual(parseFilter(''), {})
  assert.deepEqual(parseFilter(undefined), {})
  for (const bad of ['userName co "ada"', 'userName eq "a" or userName eq "b"', 'not (userName eq "a")', 'title eq "x"', 'userName eq', 'userName eq "a" and', 'members eq "x"']) {
    assert.throws(() => parseFilter(bad, bad.startsWith('members') ? 'group' : 'user'), refusal(400, 'invalidFilter'), bad)
  }
})

test('paging: startIndex is 1-based, count is clamped to 200', () => {
  assert.deepEqual(readPage({}), { startIndex: 1, count: 100, skip: 0 })
  assert.deepEqual(readPage({ startIndex: '3', count: '2' }), { startIndex: 3, count: 2, skip: 2 })
  assert.deepEqual(readPage({ startIndex: '0', count: '9999' }), { startIndex: 1, count: 200, skip: 0 })
  assert.deepEqual(readPage({ startIndex: 'x', count: '-5' }), { startIndex: 1, count: 0, skip: 0 })
})

test('PatchOps: Okta and Entra variants become one shape', () => {
  // Okta deactivates with a path-less replace.
  assert.deepEqual(normalizePatch({ schemas: [SCHEMA.patch], Operations: [{ op: 'replace', value: { active: false } }] }), [{ op: 'replace', path: 'active', value: false }])
  // Entra capitalises ops and sends booleans as strings.
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'Replace', path: 'active', value: 'False' }] }), [{ op: 'replace', path: 'active', value: false }])
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'Add', path: 'emails[type eq "work"].value', value: 'ada@acme.test' }] }), [{ op: 'add', path: 'emails.value', value: 'ada@acme.test' }])
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'Replace', path: 'name.givenName', value: 'Ada' }] }), [{ op: 'replace', path: 'name.givenname', value: 'Ada' }])
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'replace', value: { name: { givenName: 'A', familyName: 'L' }, 'name.formatted': 'A L' } }] }), [
    { op: 'replace', path: 'name.givenname', value: 'A' }, { op: 'replace', path: 'name.familyname', value: 'L' }, { op: 'replace', path: 'name.formatted', value: 'A L' },
  ])
  // Group members: Entra adds and removes with a value list, Okta removes with a filtered path.
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'Add', path: 'members', value: [{ value: 'u1' }] }] }), [{ op: 'add', path: 'members', value: [{ value: 'u1' }] }])
  assert.deepEqual(normalizePatch({ Operations: [{ op: 'remove', path: 'members[value eq "u2"]' }] }), [{ op: 'remove', path: 'members', value: [{ value: 'u2' }] }])
  assert.throws(() => normalizePatch({ Operations: [] }), refusal(400, 'invalidSyntax'))
  assert.throws(() => normalizePatch({ Operations: [{ op: 'move', path: 'x' }] }), refusal(400, 'invalidSyntax'))
  assert.throws(() => normalizePatch({ Operations: [{ op: 'remove' }] }), refusal(400, 'noTarget'))
  assert.throws(() => normalizePatch({ Operations: [{ op: 'add', path: 'members[value eq "u"]', value: 1 }] }), refusal(400, 'invalidPath'))
})

test('a User body: the primary address, else work, else userName; unknown extension attributes change nothing', () => {
  assert.equal(readUserBody(userBody({ emails: [{ value: 'home@x.test' }, { value: 'Ada@Acme.test', primary: 'True' }] })).email, 'ada@acme.test')
  assert.equal(readUserBody({ userName: 'Ada@Acme.test' }).email, 'ada@acme.test')
  assert.equal(readUserBody({ userName: 'ada' }).email, '')
  assert.throws(() => readUserBody({}), refusal(400, 'invalidValue'))
  assert.throws(() => readUserBody({ userName: 'a', active: 'maybe' }), refusal(400, 'invalidValue'))
  const current = renderUser({ _id: 'u1', emails: [{ address: 'ada@acme.test' }], profile: { firstName: 'Ada', lastName: 'L' } }, { base: BASE })
  const patched = patchUserBody(current, [{ op: 'replace', path: `${SCHEMA.enterpriseUser.toLowerCase()}:department`, value: 'R&D' }, { op: 'replace', path: 'name.familyname', value: 'Lovelace' }])
  assert.equal(patched.name.familyName, 'Lovelace')
  assert.equal(patched.userName, 'ada@acme.test')
})

// ---- tokens -----------------------------------------------------------------------------------

function tokenStore() {
  const docs = []
  return {
    docs,
    insert: async (doc) => { const _id = newId('t'); docs.push({ _id, ...doc }); return _id },
    findActiveByPrefix: async (prefix) => docs.filter((d) => d.prefix === prefix && !d.revokedAt),
    listForTeam: async (orgId) => docs.filter((d) => d.orgId === orgId),
    countActive: async (orgId) => docs.filter((d) => d.orgId === orgId && !d.revokedAt).length,
    revoke: async (orgId, id, at) => {
      const doc = docs.find((d) => d._id === id && d.orgId === orgId)
      if (!doc) return false
      doc.revokedAt = doc.revokedAt || at
      return true
    },
    touch: async (id, at) => { docs.find((d) => d._id === id).lastUsedAt = at },
  }
}

test('SCIM tokens: sbscim_, stored as SHA-256 only, two per team, revoked at once, lastUsedAt kept', async () => {
  const { token, prefix, tokenHash } = mintScimToken()
  assert.match(token, /^sbscim_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/)
  assert.equal(token.slice(7, 15), prefix)
  assert.equal(tokenHash, hashScimToken(token))
  assert.equal(bearerScimToken(`Bearer ${token}`), token)
  assert.equal(bearerScimToken(`bearer ${token}`), token)
  assert.equal(bearerScimToken('Bearer sbx_abcdef12_xyz'), null, 'an API token is not a SCIM token')
  assert.equal(bearerScimToken(token), null, 'Bearer is required')

  let now = NOW
  const store = tokenStore()
  const tokens = createScimTokens({ store, now: () => now })
  const first = await tokens.create({ orgId: 'acme', userId: 'olive', name: 'Okta' })
  assert.ok(!JSON.stringify(store.docs).includes(first.token), 'the token itself is never stored')
  assert.ok(!(await tokens.list('acme')).some((doc) => 'tokenHash' in doc), 'the list carries no hash')
  const second = await tokens.create({ orgId: 'acme', userId: 'olive', name: 'Entra' })
  await assert.rejects(tokens.create({ orgId: 'acme', userId: 'olive' }), (error) => error.code === 'too_many_tokens')
  assert.equal(ACTIVE_SCIM_TOKENS, 2)

  assert.deepEqual(await tokens.authenticate(`Bearer ${first.token}`), { tokenId: first.id, orgId: 'acme' })
  assert.equal(store.docs[0].lastUsedAt, NOW)
  now += 10_000
  await tokens.authenticate(`Bearer ${first.token}`)
  assert.equal(store.docs[0].lastUsedAt, NOW, 'lastUsedAt is written at most once a minute')
  now += 60_000
  await tokens.authenticate(`Bearer ${first.token}`)
  assert.equal(store.docs[0].lastUsedAt, now)

  // Same prefix, other secret: refused (the hash is compared, not the prefix).
  const forged = `${first.token.slice(0, 16)}${'A'.repeat(43)}`
  assert.equal(await tokens.authenticate(`Bearer ${forged}`), null)
  assert.equal(await tokens.revoke('other', first.id), false, 'another team cannot revoke it')
  assert.equal(await tokens.revoke('acme', first.id), true)
  assert.equal(await tokens.authenticate(`Bearer ${first.token}`), null, 'revoked: refused at once')
  assert.ok(await tokens.authenticate(`Bearer ${second.token}`), 'the overlapping token still works')
  await tokens.create({ orgId: 'acme', userId: 'olive' })
})

// ---- domains ----------------------------------------------------------------------------------

test('routable domains: verified, on an enabled connection, and not failing past the grace', () => {
  const connections = [
    { enabled: true, domains: [{ domain: 'Acme.test', verifiedAt: new Date(NOW) }, { domain: 'pending.test' }, { domain: 'failing.test', verifiedAt: new Date(0), failingSince: new Date(NOW - DOMAIN_GRACE_MS - 1) }, { domain: 'flaky.test', verifiedAt: new Date(0), failingSince: new Date(NOW - 3600_000) }] },
    { enabled: false, domains: [{ domain: 'off.test', verifiedAt: new Date(NOW) }] },
  ]
  assert.deepEqual([...routableDomains(connections, NOW)].sort(), ['acme.test', 'flaky.test'])
})

// ---- users ------------------------------------------------------------------------------------

test('a new person at a verified domain: an account in the team, no password, a verified address', async () => {
  const { db, service } = acme()
  const made = await service.createUser('acme', userBody({ externalId: '00u1' }), BASE)
  assert.equal(made.status, 201)
  const user = db.users.get(made.body.id)
  assert.equal(user.orgId, 'acme')
  assert.equal(user.emails[0].verified, true)
  assert.equal(user.services.password, undefined)
  assert.deepEqual({ orgId: user.scim.orgId, externalId: user.scim.externalId, active: user.scim.active }, { orgId: 'acme', externalId: '00u1', active: true })
  assert.deepEqual(db.membersChanged, ['acme'])
  assert.equal(made.body.userName, 'ada@acme.test')
  assert.equal(made.body.active, true)
  assert.equal(made.body.meta.location, `${BASE}/Users/${made.body.id}`)
  assert.deepEqual(made.body.emails, [{ value: 'ada@acme.test', type: 'work', primary: true }])
  assert.deepEqual(db.permissions, [], 'a Member: no claims')
})

test('addresses the team does not own are refused; so is provisioning before single sign-on', async () => {
  await assert.rejects(acme().service.createUser('acme', userBody({ userName: 'eve@gmail.com', emails: [{ value: 'eve@gmail.com' }] }), BASE),
    refusal(400, 'invalidValue', /gmail\.com is not a verified domain/))
  await assert.rejects(acme().service.createUser('acme', userBody({ userName: 'bo@other.test', emails: [{ value: 'bo@other.test' }] }), BASE),
    refusal(400, 'invalidValue', /other\.test is not a verified domain of this team/), "another team's domain")
  await assert.rejects(acme({ verified: false }).service.createUser('acme', userBody(), BASE), refusal(400, 'invalidValue', /not a verified domain/))
  await assert.rejects(acme({ enabled: false }).service.createUser('acme', userBody(), BASE), refusal(400, 'invalidValue', /Connect single sign-on first/))
  await assert.rejects(acme().service.createUser('acme', userBody({ userName: 'ada', emails: [] }), BASE), refusal(400, 'invalidValue', /work email/))
})

test('an existing account: attached when in no team or this one; another team is a 409', async () => {
  const { db, service } = acme()
  db.users.set('solo', { _id: 'solo', emails: [{ address: 'ada@acme.test', verified: true }], profile: { firstName: 'A' }, services: { password: { bcrypt: 'x' } } })
  db.slates.push({ _id: 's-personal', userId: 'solo' })
  const attached = await service.createUser('acme', userBody(), BASE)
  assert.equal(attached.status, 201)
  assert.equal(attached.body.id, 'solo')
  assert.equal(db.users.get('solo').orgId, 'acme')
  assert.equal(db.users.get('solo').services.password.bcrypt, 'x', 'a verified address keeps its password')
  assert.equal(db.slates[0].orgId, undefined, 'personal slates stay as they are')
  await assert.rejects(service.createUser('acme', userBody(), BASE), refusal(409, 'uniqueness', /already provisioned/))

  db.users.set('taken', { _id: 'taken', orgId: 'other', emails: [{ address: 'bo@acme.test', verified: true }], services: {} })
  await assert.rejects(service.createUser('acme', userBody({ userName: 'bo@acme.test', emails: [{ value: 'bo@acme.test' }] }), BASE),
    refusal(409, 'uniqueness', /another Slatebox team/))
  db.users.set('guest', { _id: 'guest', isAnonymous: true, emails: [{ address: 'cy@acme.test' }], services: {} })
  await assert.rejects(service.createUser('acme', userBody({ userName: 'cy@acme.test', emails: [{ value: 'cy@acme.test' }] }), BASE), refusal(409, 'uniqueness'))

  // An address Slatebox never verified proves nothing: whatever opened that account stops working.
  db.users.set('squat', { _id: 'squat', emails: [{ address: 'di@acme.test', verified: false }], services: { password: { bcrypt: 'y' }, resume: { loginTokens: [{}] } } })
  await service.createUser('acme', userBody({ userName: 'di@acme.test', emails: [{ value: 'di@acme.test' }] }), BASE)
  assert.deepEqual(db.credentialsEnded, ['squat'])
  assert.equal(db.users.get('squat').services.password, undefined)
})

test('lookups, pagination and the list shape', async () => {
  const { db, service } = acme()
  for (const name of ['ada', 'bo', 'cy']) await service.createUser('acme', userBody({ userName: `${name}@acme.test`, emails: [{ value: `${name}@acme.test` }], externalId: `x-${name}` }), BASE)
  db.users.set('stranger', { _id: 'stranger', orgId: 'other', emails: [{ address: 'ada@other.test' }], services: {} })
  const all = await service.listUsers('acme', {}, BASE)
  assert.equal(all.body.totalResults, 4, 'the owner and the three')
  assert.deepEqual(all.body.schemas, [SCHEMA.list])
  const page = await service.listUsers('acme', { startIndex: '2', count: '2' }, BASE)
  assert.equal(page.body.startIndex, 2)
  assert.equal(page.body.itemsPerPage, 2)
  assert.equal((await service.listUsers('acme', { filter: 'userName eq "BO@acme.test"' }, BASE)).body.Resources[0].userName, 'bo@acme.test')
  assert.equal((await service.listUsers('acme', { filter: 'externalId eq "x-cy"' }, BASE)).body.totalResults, 1)
  assert.equal((await service.listUsers('acme', { filter: 'emails[type eq "work"].value eq "olive@acme.test"' }, BASE)).body.totalResults, 1)
  assert.equal((await service.listUsers('acme', { filter: 'userName eq "ada@other.test"' }, BASE)).body.totalResults, 0, 'never another team')
  await assert.rejects(service.getUser('acme', 'stranger', BASE), refusal(404))
})

test('PUT and PATCH change the name, userName and address; the address must stay in the team domains', async () => {
  const { db, service } = acme()
  const { body: ada } = await service.createUser('acme', userBody(), BASE)
  const put = await service.putUser('acme', ada.id, userBody({ name: { givenName: 'Augusta', familyName: 'King' }, externalId: 'e1' }), BASE)
  assert.equal(put.body.name.givenName, 'Augusta')
  assert.equal(db.users.get(ada.id).scim.externalId, 'e1')
  const patched = await service.patchUser('acme', ada.id, { Operations: [{ op: 'Replace', path: 'emails[type eq "work"].value', value: 'augusta@acme.test' }, { op: 'Replace', path: 'userName', value: 'augusta@acme.test' }] }, BASE)
  assert.equal(patched.body.emails[0].value, 'augusta@acme.test')
  assert.equal(patched.body.userName, 'augusta@acme.test')
  // A patch keeps the provider's own fields only: a display name it never sent follows the name.
  const renamed = await service.patchUser('acme', ada.id, { Operations: [{ op: 'replace', path: 'name.givenName', value: 'Ada' }] }, BASE)
  assert.equal(renamed.body.displayName, 'Ada King')
  assert.equal(db.users.get(ada.id).scim.displayName, undefined)
  // A group role is kept beside the SCIM link, so a role alone never reads as provisioned.
  db.users.set('plain', { _id: 'plain', orgId: 'acme', emails: [{ address: 'pat@acme.test', verified: true }], scimRole: 'member', services: {} })
  assert.equal((await service.createUser('acme', userBody({ userName: 'pat@acme.test', emails: [{ value: 'pat@acme.test' }] }), BASE)).body.id, 'plain')
  await assert.rejects(service.patchUser('acme', ada.id, { Operations: [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'a@gmail.com' }] }, BASE), refusal(400, 'invalidValue'))
  await assert.rejects(service.patchUser('acme', ada.id, { Operations: [{ op: 'replace', path: 'emails.value', value: 'olive@acme.test' }] }, BASE), refusal(409, 'uniqueness'))
})

test('turned off over SCIM: signed out everywhere, disabled, roles gone, team slates moved (never deleted), the bill follows', async () => {
  const { db, service } = acme()
  const { body: ada } = await service.createUser('acme', userBody(), BASE)
  db.users.get(ada.id).services.resume = { loginTokens: [{ hashedToken: 'h' }] }
  db.permissions.push({ orgId: 'acme', userId: ada.id, claimId: 'canAddUsers' }, { orgId: 'other', userId: ada.id, claimId: 'x' })
  db.slates.push({ _id: 'team-1', orgId: 'acme', userId: ada.id }, { _id: 'team-2', orgId: 'acme', userId: ada.id }, { _id: 'mine', userId: ada.id }, { _id: 'olives', orgId: 'acme', userId: 'olive' })
  db.membersChanged.length = 0
  // Okta: a path-less replace.
  const off = await service.patchUser('acme', ada.id, { schemas: [SCHEMA.patch], Operations: [{ op: 'replace', value: { active: false } }] }, BASE)
  assert.equal(off.status, 200)
  assert.equal(off.body.active, false)
  const user = db.users.get(ada.id)
  assert.equal(user.signedOutEverywhere, true)
  assert.deepEqual(user.services.resume.loginTokens, [])
  assert.equal(user.isDisabled, true)
  assert.equal(user.disabledBy, 'scim')
  assert.deepEqual(db.permissions, [{ orgId: 'other', userId: ada.id, claimId: 'x' }], 'only this team\'s roles end')
  assert.deepEqual(db.slates.map((s) => [s._id, s.userId, s.formerOwnerId]), [
    ['team-1', 'olive', ada.id], ['team-2', 'olive', ada.id], ['mine', ada.id, undefined], ['olives', 'olive', undefined],
  ])
  assert.deepEqual(db.membersChanged, ['acme'])
  assert.ok(db.users.has(ada.id), 'the account stays')

  // Turned on again: they may sign in again; slates do not move back.
  const on = await service.patchUser('acme', ada.id, { Operations: [{ op: 'Replace', path: 'active', value: 'True' }] }, BASE)
  assert.equal(on.body.active, true)
  assert.equal(db.users.get(ada.id).isDisabled, undefined)
  assert.equal(db.slates[0].userId, 'olive')
})

test('the departing recipient: the one a team admin chose, else the owner', async () => {
  const { db, service } = acme()
  db.users.set('ann', { _id: 'ann', orgId: 'acme', emails: [{ address: 'ann@acme.test', verified: true }], services: {} })
  db.orgs.get('acme').scim = { recipientId: 'ann' }
  const { body: ada } = await service.createUser('acme', userBody(), BASE)
  db.slates.push({ _id: 's1', orgId: 'acme', userId: ada.id })
  await service.deleteUser('acme', ada.id)
  assert.equal(db.slates[0].userId, 'ann')
  // DELETE: the account is turned off and leaves SCIM; it is never deleted.
  assert.ok(db.users.has(ada.id))
  assert.equal(db.users.get(ada.id).scim, undefined)
  await assert.rejects(service.getUser('acme', ada.id, BASE), refusal(404))
  assert.equal((await service.listUsers('acme', { filter: 'userName eq "ada@acme.test"' }, BASE)).body.totalResults, 0)
  // Provisioned again later: the same account, turned on.
  const back = await service.createUser('acme', userBody(), BASE)
  assert.equal(back.body.id, ada.id)
  assert.equal(back.body.active, true)
  assert.equal(db.slates[0].userId, 'ann', 'slates do not move back')
})

test('the owner is never turned off or removed over SCIM; an account an administrator disabled stays off', async () => {
  const { db, service } = acme()
  await assert.rejects(service.patchUser('acme', 'olive', { Operations: [{ op: 'replace', path: 'active', value: false }] }, BASE), refusal(400, 'mutability'))
  await assert.rejects(service.deleteUser('acme', 'olive'), refusal(400, 'mutability'))
  assert.equal(db.users.get('olive').isDisabled, undefined)
  db.users.set('held', { _id: 'held', orgId: 'acme', isDisabled: true, disabledBy: 'admin', emails: [{ address: 'held@acme.test', verified: true }], services: {} })
  await assert.rejects(service.patchUser('acme', 'held', { Operations: [{ op: 'replace', path: 'active', value: true }] }, BASE), refusal(400, 'mutability'))
})

test('deprovision plan: nothing for the owner or another team; a second turn-off signs nobody out again', () => {
  assert.deepEqual(deprovisionPlan({ _id: 'o', orgId: 't', isOrgOwner: true }, { orgId: 't', recipientId: 'o' }), [])
  assert.deepEqual(deprovisionPlan({ _id: 'u', orgId: 'x' }, { orgId: 't', recipientId: 'o' }), [])
  assert.deepEqual(deprovisionPlan({ _id: 'u', orgId: 't' }, { orgId: 't', recipientId: 'o' }).map((s) => s.step), ['signOut', 'disable', 'removeRoles', 'moveSlates', 'membersChanged'])
  assert.deepEqual(deprovisionPlan({ _id: 'u', orgId: 't', isDisabled: true }, { orgId: 't', recipientId: 'o' }).map((s) => s.step), ['removeRoles', 'moveSlates'])
})

test('a disabled account signs in no way at all, and is not billed', () => {
  assert.equal(disabledLoginRefusal({ type: 'resume', user: { isDisabled: true } }), DISABLED_MESSAGE)
  assert.equal(disabledLoginRefusal({ type: 'sso', user: { isDisabled: true } }), DISABLED_MESSAGE)
  assert.equal(disabledLoginRefusal({ type: 'password', user: {} }), null)
  const member = { emails: [{ address: 'a@acme.test', verified: true }] }
  assert.equal(acceptedMember(member), true)
  assert.equal(acceptedMember({ ...member, isDisabled: true }), false)
  assert.equal(MEMBER_FIELDS.isDisabled, 1)
  const meteor = read('web/app/server/scim/meteor.js')
  assert.match(meteor, /Accounts\.validateLoginAttempt\(\(attempt\) => \{\n {2}const refusal = disabledLoginRefusal\(attempt\)/)
})

// ---- groups -----------------------------------------------------------------------------------

test('groups: a team admin maps a group to a role; admin wins over member; the owner never changes', async () => {
  const { db, service } = acme()
  const { body: ada } = await service.createUser('acme', userBody(), BASE)
  const { body: bo } = await service.createUser('acme', userBody({ userName: 'bo@acme.test', emails: [{ value: 'bo@acme.test' }] }), BASE)
  db.permissions.push({ orgId: 'acme', userId: bo.id, claimId: 'admin' }, { orgId: 'acme', userId: ada.id, claimId: 'canAddUsers' })
  const admins = await service.createGroup('acme', { displayName: 'Slatebox admins', members: [{ value: ada.id }, { value: 'olive' }] }, BASE)
  assert.equal(admins.status, 201)
  assert.deepEqual(admins.body.members.map((m) => m.value), [ada.id, 'olive'])
  const staff = await service.createGroup('acme', { displayName: 'Staff', members: [{ value: ada.id }, { value: bo.id }] }, BASE)
  await assert.rejects(service.createGroup('acme', { displayName: 'staff' }, BASE), refusal(409, 'uniqueness'))
  await assert.rejects(service.createGroup('acme', { displayName: 'X', members: [{ value: 'stranger' }] }, BASE), refusal(400, 'invalidValue'))
  const claims = (userId) => db.permissions.filter((p) => p.orgId === 'acme' && p.userId === userId).map((p) => p.claimId).sort()

  // Unmapped groups change no role.
  assert.deepEqual(claims(bo.id), ['admin'])
  await service.mapGroup('acme', admins.body.id, 'admin')
  assert.deepEqual(claims(ada.id), ['admin'], 'admin replaces the people claims')
  assert.deepEqual(claims('olive'), [], 'the owner is never changed')
  await service.mapGroup('acme', staff.body.id, 'member')
  assert.deepEqual(claims(ada.id), ['admin'], 'admin wins over member')
  assert.deepEqual(claims(bo.id), [], 'a member group takes the admin claim away')
  assert.ok(!db.permissions.some((p) => p.claimId === 'uberMensch'))

  // Entra removes Ada from the admin group: she is a member now.
  await service.patchGroup('acme', admins.body.id, { Operations: [{ op: 'Remove', path: 'members', value: [{ value: ada.id }] }] })
  assert.deepEqual(claims(ada.id), [])
  // Okta adds her back, and renames with a path-less replace that repeats the id.
  await service.patchGroup('acme', admins.body.id, { Operations: [{ op: 'add', path: 'members', value: [{ value: ada.id }] }, { op: 'replace', value: { id: admins.body.id, displayName: 'Admins' } }] })
  assert.deepEqual(claims(ada.id), ['admin'])
  assert.equal(db.groups.get(admins.body.id).displayName, 'Admins')
  await service.patchGroup('acme', admins.body.id, { Operations: [{ op: 'remove', path: `members[value eq "${ada.id}"]` }] })
  assert.deepEqual(claims(ada.id), [])
  await service.patchGroup('acme', admins.body.id, { Operations: [{ op: 'add', path: 'members', value: [{ value: ada.id }] }] })

  // Unmapping, or deleting, the admin group takes away only the admin claim it gave.
  await service.mapGroup('acme', staff.body.id, null)
  await service.deleteGroup('acme', admins.body.id)
  assert.deepEqual(claims(ada.id), [])
  assert.equal(db.groups.has(admins.body.id), false)

  const listed = await service.listGroups('acme', { filter: 'displayName eq "staff"', excludedAttributes: 'members' }, BASE)
  assert.equal(listed.body.totalResults, 1)
  assert.equal(listed.body.Resources[0].members, undefined)
  await assert.rejects(service.mapGroup('acme', staff.body.id, 'owner'), refusal(400))
  assert.equal(roleFromGroups([{ role: 'member' }, { role: 'admin' }]), 'admin')
  assert.equal(roleFromGroups([{ role: null }]), null)
})

test('a person turned off loses their group role and is not given one again until turned on', async () => {
  const { db, service } = acme()
  const { body: ada } = await service.createUser('acme', userBody(), BASE)
  const group = await service.createGroup('acme', { displayName: 'Admins', members: [{ value: ada.id }] }, BASE)
  await service.mapGroup('acme', group.body.id, 'admin')
  await service.patchUser('acme', ada.id, { Operations: [{ op: 'replace', path: 'active', value: false }] }, BASE)
  assert.deepEqual(db.permissions.filter((p) => p.userId === ada.id), [])
  await service.patchGroup('acme', group.body.id, { Operations: [{ op: 'replace', path: 'displayName', value: 'Admins 2' }] })
  await service.mapGroup('acme', group.body.id, 'admin')
  assert.deepEqual(db.permissions.filter((p) => p.userId === ada.id), [], 'disabled: no role')
  await service.patchUser('acme', ada.id, { Operations: [{ op: 'replace', path: 'active', value: true }] }, BASE)
  assert.deepEqual(db.permissions.filter((p) => p.userId === ada.id).map((p) => p.claimId), ['admin'], 'on again: the group role is back')
})

// ---- the switch -------------------------------------------------------------------------------

test('team security: Business on Cloud, always on for self-host; with business, a lapsed team keeps reading, not writing', async () => {
  const cloud = { public: { edition: 'cloud' } }
  assert.equal(TEAM_SECURITY.cloudPlan, 'business')
  assert.equal(teamSecurityOn({ settings: cloud, org: {} }), false, 'Cloud without Business')
  assert.equal(teamSecurityOn({ settings: cloud, org: { business: { status: 'active' } } }), true)
  assert.equal(teamSecurityOn({ settings: {}, org: {} }), true, 'self-host')
  assert.ok(Object.isFrozen(TEAM_SECURITY))

  // The gate the service takes: off means reads answer and writes are refused.
  const store = acme().store
  const service = createScimService({ store, gate: () => false, now: () => NOW })
  assert.equal((await service.listUsers('acme', {}, BASE)).status, 200)
  await assert.rejects(service.createUser('acme', userBody(), BASE), refusal(403))
  await assert.rejects(service.patchUser('acme', 'olive', { Operations: [{ op: 'replace', path: 'active', value: false }] }, BASE), refusal(403))
})

// ---- over HTTP --------------------------------------------------------------------------------

async function server({ gate } = {}) {
  const { db, store } = acme()
  const service = createScimService({ store, gate, now: () => NOW })
  const tokens = createScimTokens({ store: tokenStore(), now: () => NOW })
  const acmeToken = (await tokens.create({ orgId: 'acme', userId: 'olive' })).token
  const otherToken = (await tokens.create({ orgId: 'other', userId: 'x' })).token
  let taken = 0
  const app = express()
  mountScim(app, {
    express,
    authenticate: (header) => tokens.authenticate(header),
    service,
    limiter: { take: async () => ({ allowed: (taken += 1) <= 50, resetSeconds: 7 }) },
    origin: () => 'https://app.example.test/',
  })
  const listening = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const url = `http://127.0.0.1:${listening.address().port}/scim/v2`
  const call = async (method, path, { token = acmeToken, body, type = 'application/scim+json' } = {}) => {
    const response = await fetch(url + path, { method, headers: { ...(token && { authorization: `Bearer ${token}` }), ...(body !== undefined && { 'content-type': type }) }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) })
    const text = await response.text()
    return { status: response.status, type: response.headers.get('content-type'), body: text ? JSON.parse(text) : null, headers: response.headers }
  }
  return { db, call, otherToken, tokens, close: () => listening.close(), exhaust: () => { taken = 1000 } }
}

test('over HTTP: discovery without a token, 401 without one, the error shape, and a token sees its own team only', async () => {
  const { call, otherToken, close, exhaust } = await server()
  try {
    const config = await call('GET', '/ServiceProviderConfig', { token: null })
    assert.equal(config.status, 200)
    assert.match(config.type, /^application\/scim\+json/)
    assert.deepEqual([config.body.patch.supported, config.body.bulk.supported, config.body.filter.maxResults, config.body.sort.supported, config.body.etag.supported, config.body.changePassword.supported], [true, false, 200, false, false, false])
    assert.equal((await call('GET', '/ResourceTypes', { token: null })).body.totalResults, 2)
    assert.equal((await call('GET', '/Schemas', { token: null })).body.Resources[0].id, SCHEMA.user)

    const anonymous = await call('GET', '/Users', { token: null })
    assert.equal(anonymous.status, 401)
    assert.deepEqual(Object.keys(anonymous.body).sort(), ['detail', 'schemas', 'status'])
    assert.deepEqual(anonymous.body.schemas, [SCHEMA.error])
    assert.equal(anonymous.body.status, '401', 'status is a string')
    assert.equal((await call('GET', '/Users', { token: 'sbscim_00000000_' + 'A'.repeat(43) })).status, 401)

    const made = await call('POST', '/Users', { body: userBody() })
    assert.equal(made.status, 201)
    const again = await call('POST', '/Users', { body: userBody() })
    assert.equal(again.status, 409)
    assert.equal(again.body.scimType, 'uniqueness')
    assert.equal(again.body.status, '409')
    const asJson = await call('POST', '/Users', { body: userBody({ userName: 'bo@acme.test', emails: [{ value: 'bo@acme.test' }] }), type: 'application/json' })
    assert.equal(asJson.status, 201, 'application/json bodies too')
    assert.equal((await call('GET', '/Users?filter=' + encodeURIComponent('userName eq "ada@acme.test"'))).body.totalResults, 1)
    assert.equal((await call('GET', '/Users?filter=' + encodeURIComponent('userName sw "a"'))).body.scimType, 'invalidFilter')
    assert.equal((await call('GET', `/Users/${made.body.id}`, { token: otherToken })).status, 404, "another team's token finds nobody")
    assert.equal((await call('GET', '/Users', { token: otherToken })).body.totalResults, 0)
    assert.equal((await call('POST', '/Users', { body: '{"userName":', type: 'application/scim+json' })).body.scimType, 'invalidSyntax')
    assert.equal((await call('PATCH', `/Users/${made.body.id}`, { body: { Operations: [{ op: 'Replace', path: 'active', value: 'False' }] } })).body.active, false)
    assert.equal((await call('DELETE', `/Users/${made.body.id}`)).status, 204)
    assert.equal((await call('GET', `/Users/${made.body.id}`)).status, 404)
    const group = await call('POST', '/Groups', { body: { schemas: [SCHEMA.group], displayName: 'Admins', members: [] } })
    assert.equal(group.status, 201)
    assert.equal((await call('PATCH', `/Groups/${group.body.id}`, { body: { Operations: [{ op: 'replace', path: 'displayName', value: 'Leads' }] } })).status, 204)
    assert.equal((await call('GET', `/Groups/${group.body.id}?excludedAttributes=members`)).body.displayName, 'Leads')
    assert.equal((await call('DELETE', `/Groups/${group.body.id}`)).status, 204)
    assert.equal((await call('GET', '/Bulk')).status, 404)

    exhaust()
    const limited = await call('GET', '/Users')
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '7')
  } finally {
    close()
  }
})

test('over HTTP: with the switch off, SCIM writes answer 403 and reads still answer', async () => {
  const { call, close } = await server({ gate: () => false })
  try {
    assert.equal((await call('GET', '/Users')).status, 200)
    const refused = await call('POST', '/Users', { body: userBody() })
    assert.equal(refused.status, 403)
    assert.equal(refused.body.status, '403')
  } finally {
    close()
  }
})

// ---- the team admin's side (teamScim.*) ------------------------------------------------------

function adminSide({ gate = () => true } = {}) {
  const { db, store } = acme()
  const service = createScimService({ store, gate, now: () => NOW })
  const tokens = createScimTokens({ store: tokenStore(), now: () => NOW })
  db.users.set('ann', { _id: 'ann', orgId: 'acme', emails: [{ address: 'ann@acme.test', verified: true }], profile: { firstName: 'Ann' }, services: {} })
  db.users.set('max', { _id: 'max', orgId: 'acme', emails: [{ address: 'max@acme.test', verified: true }], profile: { firstName: 'Max' }, services: {} })
  const people = { olive: { isOrgOwner: true, isAdmin: true }, ann: { isAdmin: true }, max: { isAdmin: false } }
  const admin = createTeamScimAdmin({
    store: {
      teamPerson: async (userId) => (people[userId] ? { _id: userId, orgId: 'acme', isOrgOwner: Boolean(people[userId].isOrgOwner), isAdmin: people[userId].isAdmin } : null),
      team: store.team,
      connections: store.connections,
      groups: async (orgId) => [...db.groups.values()].filter((g) => g.orgId === orgId),
      recipients: async () => [{ _id: 'olive', name: 'Olive Owner', email: 'olive@acme.test', isOwner: true }, { _id: 'ann', name: 'Ann', email: 'ann@acme.test', isOwner: false }],
      setRecipient: async (orgId, userId) => { db.orgs.get(orgId).scim = { recipientId: userId } },
    },
    tokens,
    service,
    gate,
    origin: () => 'https://app.example.test',
    now: () => NOW,
  })
  return { db, admin }
}

test('teamScim: team admins only; tokens shown once, two at most; groups mapped; the recipient is the owner or an admin', async () => {
  const { db, admin } = adminSide()
  await assert.rejects(admin.get('max'), (error) => error.status === 403 && error.code === 'team_admin_required')
  await assert.rejects(admin.get('nobody'), (error) => error.status === 404)
  const settings = await admin.get('ann')
  assert.equal(settings.baseUrl, 'https://app.example.test/scim/v2')
  assert.deepEqual(settings.domains, ['acme.test'])
  assert.equal(settings.recipient.userId, 'olive', 'the owner until someone else is chosen')
  const made = await admin.createToken('ann', { name: 'Okta' })
  assert.match(made.token, /^sbscim_/)
  assert.ok(!JSON.stringify(await admin.get('ann')).includes(made.token), 'never shown again')
  await admin.createToken('olive', {})
  await assert.rejects(admin.createToken('ann', {}), (error) => error.status === 409 && error.code === 'too_many_tokens')
  assert.deepEqual(await admin.revokeToken('ann', { tokenId: made.tokenId }), { tokenId: made.tokenId, revoked: true })
  await assert.rejects(admin.revokeToken('ann', { tokenId: 'nope' }), (error) => error.status === 404)

  await assert.rejects(admin.setRecipient('ann', { recipientId: 'max' }), (error) => error.status === 400)
  assert.equal((await admin.setRecipient('ann', { recipientId: 'ann' })).recipient.userId, 'ann')
  assert.equal(db.orgs.get('acme').scim.recipientId, 'ann')

  db.groups.set('g1', { _id: 'g1', orgId: 'acme', displayName: 'Admins', members: ['max'], role: null })
  assert.deepEqual(await admin.mapGroup('ann', { groupId: 'g1', role: 'admin' }), { groupId: 'g1', role: 'admin' })
  assert.ok(db.permissions.some((p) => p.userId === 'max' && p.claimId === 'admin'))
  await assert.rejects(admin.mapGroup('ann', { groupId: 'nope', role: 'admin' }), (error) => error.status === 404)
})

test('teamScim with the switch off: read and revoke only', async () => {
  const { admin } = adminSide({ gate: () => false })
  assert.equal((await admin.get('ann')).available, false)
  await assert.rejects(admin.createToken('ann', {}), (error) => error.status === 403)
  await assert.rejects(admin.setRecipient('ann', { recipientId: 'ann' }), (error) => error.status === 403)
  await assert.rejects(admin.revokeToken('ann', { tokenId: 'nope' }), (error) => error.status === 404, 'revoke still runs')
})

test('the teamScim actions: person only, in the app only (no token, no agent), each write names its audit entry', () => {
  const registry = createAppRegistry()
  for (const id of ['teamScim.get', 'teamScim.createToken', 'teamScim.revokeToken', 'teamScim.mapGroup', 'teamScim.setRecipient']) {
    const action = registry.get(id)
    assert.ok(action, id)
    assert.deepEqual(action.principals, ['person'], id)
    assert.equal(action.mounts.http, null, `${id} has no /api/v1 route`)
  }
  for (const action of teamScimActions.filter((a) => a.kind === 'write')) {
    const source = read('web/app/server/actions/team-scim.mjs')
    assert.match(source, new RegExp(`id: '${action.id.replace('.', '\\.')}'[\\s\\S]*?audit: \\{ action: 'scim\\.`), action.id)
  }
})

// ---- wiring -----------------------------------------------------------------------------------

test('wiring: /scim/v2 is mounted on the app, parses its own bodies, and Keycloak no longer serves SCIM', () => {
  assert.equal(isScimPath('/scim/v2/Users'), true)
  assert.equal(isScimPath('/SCIM/V2/Users'), true)
  assert.equal(isScimPath('/scimx'), false)
  assert.match(read('web/app/server/expressApp.js'), /isApiPath\(req\.path\)( \|\| \w+\(req\.path\))* \|\| isScimPath\(req\.path\)( \|\| \w+\(req\.path\))* \? next\(\) : json\(req, res, next\)/)
  assert.match(read('web/app/server/apiHooks.js'), /mountScimRoutes\(app\)/)
  assert.match(read('web/app/server/actions/mount.js'), /\n {4}teamScim,\n/)
  assert.doesNotMatch(read('self-host/Dockerfile'), /scim-api/)
  const sso = read('self-host/rootfs/opt/slatebox/lib/sso.mjs')
  assert.doesNotMatch(sso, /scimClient|scimApiEnabled|scimAudience/)
  assert.doesNotMatch(read('self-host/rootfs/opt/slatebox/lib/common.mjs'), /scimClientSecret/)
  const init = read('self-host/rootfs/opt/slatebox/lib/keycloak-init.mjs')
  assert.match(init, /async function removeRetiredScimClient/)
  assert.match(init, /call\('DELETE', `\/\$\{SSO_REALM\}\/clients\/\$\{existing\.id\}`\)/)
  assert.doesNotMatch(init, /grantScim|manage-users/)
  const cli = read('self-host/rootfs/opt/slatebox/lib/sso-cli.mjs')
  assert.match(cli, /SCIM 2\.0: {8}\$\{origin\}\/scim\/v2/)
  assert.doesNotMatch(cli, /scim-secret/)
})

test('the SCIM card offers only what works: create when ready and under the limit, revoke always', () => {
  const base = { available: true, baseUrl: BASE, domains: ['acme.test'], tokens: [], groups: [], recipients: [], maxTokens: 2 }
  assert.equal(scimCardState(null).state, 'loading')
  assert.deepEqual([scimCardState(base, NOW).state, scimCardState(base, NOW).canCreate], ['ready', true])
  assert.equal(scimCardState({ ...base, domains: [] }, NOW).state, 'needs-sso')
  assert.equal(scimCardState({ ...base, domains: [] }, NOW).canCreate, false)
  const off = scimCardState({ ...base, available: false, tokens: [{ tokenId: 't', name: 'Okta', prefix: 'abcd1234', createdAt: new Date(NOW).toISOString(), lastUsedAt: null, revokedAt: null }] }, NOW)
  assert.deepEqual([off.state, off.canCreate, off.tokens.length], ['off', false, 1])
  const two = scimCardState({ ...base, tokens: [1, 2].map((n) => ({ tokenId: `t${n}`, name: 'x', prefix: 'abcd1234', createdAt: new Date(NOW - 3 * 86_400_000).toISOString(), lastUsedAt: new Date(NOW - 120_000).toISOString(), revokedAt: null })) }, NOW)
  assert.equal(two.canCreate, false)
  assert.match(two.limitLine, /at most 2 tokens/)
  assert.equal(two.tokens[0].shown, 'sbscim_abcd1234_…')
  assert.match(two.tokens[0].detail, /last used 2 min ago/)
  const card = read('web/app/imports/ui/components/teams/security/ScimCard.jsx')
  assert.doesNotMatch(card, /\bAI\b|colour|behaviour/)
})

// ---- what the security review closed --------------------------------------------------------

test('SCIM manages only the team\'s people at its verified domains: a contractor\'s own account is out of its reach', async () => {
  const { db, service } = acme()
  db.users.set('cass', { _id: 'cass', orgId: 'acme', emails: [{ address: 'cass@gmail.com', verified: true }], profile: { firstName: 'Cass' }, services: {} })
  db.slates.push({ _id: 's1', orgId: 'acme', userId: 'cass' })
  // not listed, not found, not changed, not turned off, not grouped
  const all = await service.listUsers('acme', {}, BASE)
  assert.deepEqual(all.body.Resources.map((r) => r.userName), ['olive@acme.test'])
  assert.equal((await service.listUsers('acme', { filter: 'userName eq "cass@gmail.com"' }, BASE)).body.totalResults, 0)
  await assert.rejects(service.getUser('acme', 'cass', BASE), refusal(404))
  // the takeover this closes: rewrite the address to one the directory controls, then reset the password
  await assert.rejects(service.patchUser('acme', 'cass', { Operations: [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'mallory@acme.test' }] }, BASE), refusal(404))
  await assert.rejects(service.patchUser('acme', 'cass', { Operations: [{ op: 'replace', value: { active: false } }] }, BASE), refusal(404))
  await assert.rejects(service.deleteUser('acme', 'cass'), refusal(404))
  await assert.rejects(service.createGroup('acme', { displayName: 'Admins', members: [{ value: 'cass' }] }, BASE), refusal(400, 'invalidValue'))
  assert.equal(db.users.get('cass').emails[0].address, 'cass@gmail.com')
  assert.equal(db.users.get('cass').isDisabled, undefined)
  assert.equal(db.slates[0].userId, 'cass')
  // the selector the Meteor store builds keeps to the same domains
  const meteor = read('web/app/server/scim/meteor.js')
  assert.match(meteor, /if \(query\.domains !== undefined\) and\.push\(\{ 'emails\.0\.address': new RegExp\(`@\(\$\{query\.domains\.map\(escape\)\.join\('\|'\)\}\)\$`, 'i'\) \}\)/)
})

test('the owner\'s address is never rewritten over SCIM', async () => {
  const { db, service } = acme()
  await assert.rejects(service.patchUser('acme', 'olive', { Operations: [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'it@acme.test' }] }, BASE), refusal(400, 'mutability'))
  await assert.rejects(service.putUser('acme', 'olive', userBody({ userName: 'it@acme.test', emails: [{ value: 'it@acme.test', primary: true }] }), BASE), refusal(400, 'mutability'))
  assert.equal(db.users.get('olive').emails[0].address, 'olive@acme.test')
  // the owner's name still follows the directory
  const renamed = await service.patchUser('acme', 'olive', { Operations: [{ op: 'replace', path: 'name.givenName', value: 'Ollie' }] }, BASE)
  assert.equal(renamed.body.name.givenName, 'Ollie')
})

test('what SCIM changes is an entry in the activity log: the directory\'s requests as the directory, an admin\'s as the admin', async () => {
  const meteor = read('web/app/server/scim/meteor.js')
  assert.match(meteor, /around: \(caller, req, run\) => withAuditContext\(\{ scimTokenId: caller\.tokenId, via: 'scim'/)
  assert.match(meteor, /actor: \{ kind: 'scim', tokenId: context\.scimTokenId \}, via: 'scim'/)
  // the admin's own changes are recorded once, by their action's audit spec
  assert.match(meteor, /BY_ACTION_SPEC = new Set\(\['scim\.tokenCreated', 'scim\.tokenRevoked', 'scim\.recipientSet', 'scim\.groupMapped'\]\)/)
  // every event the service and the admin side emit is in the log's catalogue, with valid targets
  const { AUDIT_ACTIONS, buildEntry } = await import('../web/app/server/audit/events.mjs')
  const emitted = [...read('web/app/server/scim/service.mjs').matchAll(/action: '(scim\.[A-Za-z]+)'/g), ...read('web/app/server/scim/admin.mjs').matchAll(/action: '(scim\.[A-Za-z]+)'/g)].map((m) => m[1])
  assert.ok(emitted.length >= 10)
  for (const id of emitted) assert.ok(Object.hasOwn(AUDIT_ACTIONS, id), `${id} is in the catalogue`)
  for (const action of teamScimActions.filter((a) => a.audit?.action)) {
    const target = action.audit.target({ tokenId: 't1', groupId: 'g1', role: 'admin' }, { tokenId: 't1', name: 'Okta', recipient: { userId: 'u1', name: 'Olive' } })
    buildEntry({ scope: 'acme', at: new Date(NOW), action: action.audit.action, actor: { kind: 'person', userId: 'olive' }, via: 'app', target, details: action.audit.details?.({ role: 'admin' }) })
  }
  // the routes run each request inside around()
  const seen = []
  const app = express()
  const { service } = acme()
  mountScim(app, {
    express, service, origin: () => 'https://app.example.test',
    authenticate: async () => ({ orgId: 'acme', tokenId: 'tok1' }),
    around: (caller, req, run) => { seen.push(caller.tokenId); return run() },
  })
  const server = app.listen(0)
  try {
    const { port } = server.address()
    const res = await fetch(`http://127.0.0.1:${port}/scim/v2/Users`, { headers: { authorization: 'Bearer x' } })
    assert.equal(res.status, 200)
    assert.deepEqual(seen, ['tok1'])
  } finally {
    server.close()
  }
})

test('self-host: SCIM provisions at the domains the server administrator gave the bundled Keycloak', () => {
  const sso = read('web/app/server/sso/index.js')
  const fn = sso.slice(sso.indexOf('export async function serverConnectionsFor('), sso.indexOf('/** "Try it"'))
  assert.match(fn, /if \(!sso \|\| !sso\.domains\.length \|\| !orgId \|\| orgId !== await defaultTeamId\(sso\)\) return \[\]/, 'only the default team, only with a domain list')
  assert.match(fn, /verifiedBy: 'server-admin'/)
  const meteor = read('web/app/server/scim/meteor.js')
  assert.match(meteor, /\(await import\('\.\.\/sso'\)\)\.serverConnectionsFor\(orgId\)/)
})
