/* eslint-disable no-underscore-dangle */
// The Meteor side of the activity log: the collections, the sink every audit.record() entry goes
// to (which team's log, the person's name, the address hash), sign-in and sign-out, the sealer
// and the export download. Everything it calls is pure and tested without Meteor (server/audit).
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Accounts } from 'meteor/accounts-base'
import { Random } from 'meteor/random'
import { DDP } from 'meteor/ddp-client'
import { Organizations, Slates } from '../../imports/api/common/models'
import { isCloudEdition } from '../../imports/api/common/edition.mjs'
import { teamSecurityOn } from '../../imports/api/common/team-security.mjs'
import AuthManager from '../../imports/api/common/AuthManager'
import { teamPerson } from '../common/team-person'
import { loadMasterKey } from '../metering/vault.mjs'
import { clipName, createAddressHasher, retentionDays } from './events.mjs'
import { createAuditStore, ensureAuditIndexes } from './store.mjs'
import { audit } from './recorder.mjs'
import { createAuditService } from './service.mjs'
import { writeExport } from './export.mjs'

export const AuditEvents = new Mongo.Collection('auditEvents')
const AuditChains = new Mongo.Collection('auditChains')
const AuditCheckpoints = new Mongo.Collection('auditCheckpoints')
const AuditEditWindows = new Mongo.Collection('auditEditWindows')
const AuditLeases = new Mongo.Collection('auditLeases')
const AuditExports = new Mongo.Collection('auditExports')

const raw = {
  events: AuditEvents.rawCollection(),
  chains: AuditChains.rawCollection(),
  checkpoints: AuditCheckpoints.rawCollection(),
  windows: AuditEditWindows.rawCollection(),
  leases: AuditLeases.rawCollection(),
  exports: AuditExports.rawCollection(),
}

const cloud = () => isCloudEdition(Meteor.settings)
const retention = () => retentionDays({ cloud: cloud(), settings: Meteor.settings })
export const auditStore = createAuditStore({ ...raw, retention })
const hashAddress = createAddressHasher(loadMasterKey()?.key)

// A person as the log names them: their name and address, kept with the entry so it still reads
// after the account is gone.
export function personLabel(user) {
  if (!user) return null
  if (user.isAnonymous) return 'A guest'
  const name = `${user.profile?.firstName ?? ''} ${user.profile?.lastName ?? ''}`.trim()
  const email = user.emails?.[0]?.address
  return clipName(name && email ? `${name} (${email})` : name || email || 'Someone')
}

// Small caches: a canvas saves every few seconds, and its entries name the same person and slate.
const CACHE_MS = 30_000
const cached = (load) => {
  const hits = new Map()
  return async (key) => {
    const hit = hits.get(key)
    if (hit && hit.until > Date.now()) return hit.value
    const value = await load(key)
    if (hits.size > 5000) hits.clear()
    hits.set(key, { value, until: Date.now() + CACHE_MS })
    return value
  }
}
const userInfo = cached(async (userId) => {
  const user = await Meteor.users.findOneAsync(userId, { fields: { orgId: 1, isAnonymous: 1, profile: 1, emails: 1 } })
  return user ? { orgId: user.orgId || null, label: personLabel(user) } : null
})
const slateInfo = cached(async (shareId) => {
  const slate = await Slates.rawCollection().findOne({ shareId }, { projection: { orgId: 1, 'options.name': 1 } })
  return slate ? { orgId: slate.orgId || null, name: slate.options?.name || 'Untitled slate' } : null
})

// Where an entry from audit.record() goes. A slate's entry belongs to the slate's team; anything
// else to the person's team. Outside any team: this server's own log on a self-hosted server, and
// nowhere on Slatebox Cloud (a person on their own has no team admin to read it).
async function sink(entry, options = {}) {
  const { address, scope: given, orgId: givenOrg, ...rest } = entry
  let orgId = givenOrg || null
  const target = rest.target ? { ...rest.target } : undefined
  if (rest.slateId) {
    const slate = await slateInfo(rest.slateId)
    if (slate) {
      orgId = orgId || slate.orgId
      if (target?.type === 'slate' && !target.name) target.name = slate.name
    }
  }
  const invocation = DDP._CurrentMethodInvocation.get()
  // A plain Meteor method's entry names no actor: it is the method's caller.
  let actor = rest.actor ? { ...rest.actor } : null
  if (!actor && invocation?.userId) {
    const caller = await Meteor.users.findOneAsync(invocation.userId, { fields: { isAnonymous: 1 } })
    actor = { kind: caller?.isAnonymous ? 'guest' : 'person', userId: invocation.userId }
  }
  if (!actor) actor = { kind: 'system' }
  const person = actor.userId ? await userInfo(actor.userId) : null
  if (!actor.label && person?.label && actor.kind !== 'agent') actor.label = person.label
  if (actor.kind === 'agent' && person?.label) actor.label = `${actor.tokenName ? `${actor.tokenName}, ` : 'An agent, '}for ${person.label}`
  if (!orgId && !rest.slateId && !given) orgId = person?.orgId || null
  const scope = given || orgId || (cloud() ? null : 'server')
  if (!scope) return null
  let from = address
  if (from === undefined) from = invocation?.connection?.clientAddress
  return auditStore.record(
    { ...rest, actor, ...(target && { target }), scope, ...(orgId && scope !== 'server' && { orgId }), ipHash: hashAddress(scope, from) || undefined },
    options
  )
}

audit.configure(sink)

export const auditService = createAuditService({
  store: auditStore,
  cloud: cloud(),
  teamPerson,
  isServerAdmin: (userId) => AuthManager.isServerAdmin(userId),
  securityOn: async (orgId) => teamSecurityOn({ settings: Meteor.settings, org: await Organizations.findOneAsync({ _id: orgId }, { fields: { business: 1 } }) }),
  hashAddress,
  record: (entry, options) => audit.record(entry, options),
  origin: () => Meteor.settings.public?.baseUrl || Meteor.absoluteUrl(),
  teamNames: async (ids) => new Map((await Organizations.find({ _id: { $in: ids } }, { fields: { name: 1 } }).fetchAsync()).map((org) => [org._id, org.name])),
  retention,
  scopes: async () => (await raw.chains.find({}, { projection: { seq: 1 } }).sort({ seq: -1 }).limit(500).toArray()).map((row) => ({ scope: row._id, seq: row.seq })),
})

// GET /audit-export/<ticket>: the file an audit.export handed out an address for, once.
export function mountAuditExport(app) {
  app.get('/audit-export/:ticket', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    let ticket
    try {
      ticket = await auditStore.takeExport(req.params.ticket)
    } catch {
      ticket = null
    }
    if (!ticket) return res.status(404).type('text/plain').send('This download address has expired or was used. Export the activity log again.')
    const csv = ticket.format === 'csv'
    const day = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="slatebox-activity-${ticket.scope}-${day}.${csv ? 'csv' : 'json'}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const write = (text) => (res.write(text) ? undefined : new Promise((resolve) => { res.once('drain', resolve) }))
    try {
      await writeExport(auditStore.exportCursor(ticket.scope, ticket.filter || {}), ticket.format, write)
    } catch (error) {
      console.error('[audit] export failed', error?.message) // eslint-disable-line no-console
    }
    return res.end()
  })
}

// Sign-in: a new session (never a resumed one), a failed attempt on a known account, and
// signing out. Joining a team by an invitation is the first sign-in that set a password.
const methodOf = (attempt) => (typeof attempt?.type === 'string' && /^[a-z][A-Za-z0-9_-]{0,30}$/.test(attempt.type) ? attempt.type : 'other')
Accounts.onLogin((attempt) => {
  const user = attempt?.user
  if (!user?._id || attempt.type === 'resume' || user.isAnonymous) return
  const address = attempt.connection?.clientAddress || null
  const actor = { kind: 'person', userId: user._id }
  audit.record({ action: 'signin.succeeded', actor, via: 'app', address, target: { type: 'person', id: user._id }, details: { method: methodOf(attempt) } })
  if (attempt.methodName === 'resetPassword' && user.teamEnrollmentSentAt && user.orgId) {
    audit.record({ action: 'member.joined', actor, via: 'app', address, orgId: user.orgId, target: { type: 'team', id: user.orgId } })
  }
})
Accounts.onLoginFailure((attempt) => {
  const user = attempt?.user
  if (!user?._id || user.isAnonymous) return
  audit.record({ action: 'signin.failed', actor: { kind: 'person', userId: user._id }, via: 'app', address: attempt.connection?.clientAddress || null, target: { type: 'person', id: user._id }, details: { method: methodOf(attempt) } })
})
Accounts.onLogout(({ user, connection }) => {
  if (!user?._id || user.isAnonymous) return
  audit.record({ action: 'signout', actor: { kind: 'person', userId: user._id }, via: 'app', address: connection?.clientAddress || null, target: { type: 'person', id: user._id } })
})

// One sealer across the app's processes (a lease of a minute, renewed every 30 seconds).
const holder = Random.id()
async function sealNow() {
  try {
    if (!(await auditStore.lease('audit-sealer', holder, 60_000))) return
    await auditStore.sealAll()
  } catch (error) {
    console.error('[audit] sealing failed', error?.message) // eslint-disable-line no-console
  }
}

Meteor.startup(async () => {
  await ensureAuditIndexes(raw)
  Meteor.setTimeout(sealNow, 10_000)
  Meteor.setInterval(sealNow, 30_000)
})
