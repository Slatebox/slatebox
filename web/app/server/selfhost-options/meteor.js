/* eslint-disable no-console */
// The Meteor side of the header button on a self-hosted install (service.mjs): the collections,
// Slatebox Cloud's address, who administers this server and the team, and the methods the panel
// calls. Plain Meteor methods, not registry actions, on purpose: they act for this server (its
// license, its team leaving for Cloud) from its administrator's own session, with nothing a token,
// an MCP tool or an exec call should reach (like enterprise.licenseStatus beside them).
//
// Slatebox Cloud's address: settings.cloud.origin, else SLATEBOX_CLOUD_URL (as the CLI reads it),
// else https://app.slatebox.com. On Slatebox Cloud itself every method but selfhost.status refuses.
import { randomBytes } from 'node:crypto'
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { Organizations, Permissions, SystemSettings } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { editionOf } from '../../imports/api/common/edition.mjs'
import { CLOUD_ORIGIN, PLANS_URL, LICENSE_URL } from '../../imports/api/common/selfhost-options.mjs'
import { enterpriseAccess, installHost } from '../enterprise-license.mjs'
import { enterpriseRuntime } from '../enterprise-runtime.mjs'
import { teamTransfer } from '../team-export/meteor'
import { createCloudClient } from './cloud-client.mjs'
import { createUpgradeService, UpgradeError } from './service.mjs'
import { installProofs } from './proofs.mjs'

const UpgradeFlows = new Mongo.Collection('selfhostFlows')
const MOVED_ROW = 'movedToCloud'
const INSTALL_ROW = 'selfhostInstall'

const origin = () => Meteor.settings.public?.baseUrl || Meteor.absoluteUrl()
const cloudOrigin = () => Meteor.settings.cloud?.origin || process.env.SLATEBOX_CLOUD_URL || CLOUD_ORIGIN
const onCloud = () => editionOf(Meteor.settings) === 'cloud'

const isServerAdmin = async (userId) =>
  Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))
const isTeamAdmin = async (user) =>
  Boolean(user?.orgId && (await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } })))

// This install's own id for Cloud's records (made once; it names nothing else).
let installId = null
async function installIdNow() {
  if (installId) return installId
  const row = await SystemSettings.findOneAsync({ _id: INSTALL_ROW })
  if (row?.installId) return (installId = row.installId)
  const made = randomBytes(12).toString('hex')
  await SystemSettings.upsertAsync({ _id: INSTALL_ROW }, { $setOnInsert: { installId: made, createdAt: new Date() } })
  installId = (await SystemSettings.findOneAsync({ _id: INSTALL_ROW }))?.installId || made
  return installId
}

const flows = {
  insert: (doc) => UpgradeFlows.insertAsync(doc),
  get: (id) => UpgradeFlows.findOneAsync({ _id: id }),
  set: (id, fields) => UpgradeFlows.updateAsync({ _id: id }, { $set: fields }),
  latest: (kind) => UpgradeFlows.findOneAsync({ kind }, { sort: { createdAt: -1 } }),
}

let service = null
function serviceNow() {
  if (service) return service
  // The same host the key store and the license check use (enterprise-license.mjs installHost).
  const host = installHost({ settings: Meteor.settings, env: process.env })
  service = createUpgradeService({
    cloud: createCloudClient({ origin: cloudOrigin(), userAgent: `slatebox-server (${host})` }),
    flows,
    keys: enterpriseRuntime.licenseKeys,
    unlock: () => enterpriseRuntime.unlockNow(),
    unlocked: () => enterpriseRuntime.running().loaded === true,
    isServerAdmin,
    preflight: (userId) => teamTransfer.preflight(userId),
    async exportStream(userId, passphrase, onEnd) {
      const issued = await teamTransfer.startExport(userId)
      const ticket = new URL(issued.downloadUrl).pathname.split('/').pop()
      const { stream } = await teamTransfer.openExport(ticket, passphrase, { onEnd })
      return stream
    },
    proofs: installProofs,
    install: {
      host,
      origin: origin(),
      get installId() {
        return installId
      },
      label: Meteor.settings.public?.instanceName || host,
    },
    log: (message, fields) => console.error('[selfhost]', message, JSON.stringify(fields)),
  })
  return service
}

const signedIn = async () => {
  const userId = Meteor.userId()
  const user = userId ? await Meteor.users.findOneAsync(userId, { fields: { isAnonymous: 1, orgId: 1 } }) : null
  if (!user || user.isAnonymous) throw new Meteor.Error('sign_in_required', 'Sign in first.')
  return user
}
const selfHosted = () => {
  if (onCloud()) throw new Meteor.Error('cloud', 'This is Slatebox Cloud: enterprise features are already on here.')
}
// The service's refusals reach the panel with their own code and words.
const asMeteor = (fn) =>
  async function wrapped(...args) {
    try {
      return await fn.apply(this, args)
    } catch (error) {
      if (error instanceof Meteor.Error) throw error
      if (error instanceof UpgradeError || (typeof error?.code === 'string' && error?.status < 500)) throw new Meteor.Error(error.code, error.message)
      console.error('[selfhost]', error?.stack || error)
      throw new Meteor.Error('failed', 'Something went wrong on this server. Try again.')
    }
  }
const flowId = Match.Where((value) => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value))

Meteor.methods({
  // What the header and the panel show: who is asking, the team, the license and the flows under way.
  'selfhost.status': asMeteor(async function status() {
    const user = await signedIn()
    const edition = editionOf(Meteor.settings)
    const moved = await SystemSettings.findOneAsync({ _id: MOVED_ROW }, { fields: { url: 1, teamName: 1, banner: 1 } })
    const base = { edition, enterprise: Meteor.settings.public.enterprise, plansUrl: PLANS_URL, licenseUrl: LICENSE_URL, moved: moved?.banner ? { url: moved.url, teamName: moved.teamName || null } : null }
    if (edition === 'cloud') return { ...base, serverAdmin: false }
    const serverAdmin = await isServerAdmin(user._id)
    const teamAdmin = await isTeamAdmin(user)
    const org = user.orgId ? await Organizations.findOneAsync({ _id: user.orgId }, { fields: { name: 1 } }) : null
    if (!serverAdmin) return { ...base, serverAdmin: false, teamAdmin, team: org ? { name: org.name || '' } : null }
    const team = teamAdmin ? await teamTransfer.preflight(user._id).catch(() => null) : null
    const access = enterpriseAccess({ settings: Meteor.settings, env: process.env, stored: enterpriseRuntime.licenseKeys.cached() })
    return {
      ...base,
      serverAdmin: true,
      teamAdmin,
      team: team ? { name: team.team?.name || org?.name || '', members: team.members, slates: team.slates } : org ? { name: org.name || '' } : null,
      license: { reason: access.reason, words: access.words, license: access.license, endsAt: access.endsAt ?? null, unlocked: enterpriseRuntime.running().loaded === true },
      cloudOrigin: new URL(cloudOrigin()).origin,
      trial: await serviceNow().latest(user._id, 'trial'),
      move: await serviceNow().latest(user._id, 'move'),
      movedSaved: moved ? { url: moved.url, banner: Boolean(moved.banner) } : null,
    }
  }),
  // Whether Slatebox Cloud issues free trials to servers now, and their length: the panel offers
  // the trial only then (otherwise it leads with Get a license and the pasted key).
  'selfhost.cloudOffer': asMeteor(async function cloudOffer() {
    selfHosted()
    const user = await signedIn()
    return serviceNow().offer(user._id)
  }),
  'selfhost.startTrial': asMeteor(async function startTrial() {
    selfHosted()
    const user = await signedIn()
    await installIdNow()
    return serviceNow().startTrial(user._id)
  }),
  'selfhost.resumeTrial': asMeteor(async function resumeTrial(id) {
    check(id, flowId)
    selfHosted()
    const user = await signedIn()
    return serviceNow().resumeTrial(user._id, id)
  }),
  // A license key pasted in: checked offline, kept, and applied now. The key never comes back.
  'selfhost.enterKey': asMeteor(async function enterKey(key) {
    check(key, String)
    selfHosted()
    const user = await signedIn()
    const done = await serviceNow().enterKey(user._id, key)
    return { ...done, enterprise: Meteor.settings.public.enterprise }
  }),
  'selfhost.startMove': asMeteor(async function startMove(options) {
    check(options, Match.Maybe({ replaceWaiting: Match.Maybe(Boolean) }))
    selfHosted()
    const user = await signedIn()
    return serviceNow().startMove(user._id, { replaceWaiting: Boolean(options?.replaceWaiting) })
  }),
  'selfhost.resumeMove': asMeteor(async function resumeMove(id, options) {
    check(id, flowId)
    check(options, Match.Maybe({ replaceWaiting: Match.Maybe(Boolean) }))
    selfHosted()
    const user = await signedIn()
    return serviceNow().resumeMove(user._id, id, { replaceWaiting: options?.replaceWaiting })
  }),
  'selfhost.confirmMove': asMeteor(async function confirmMove(id, options) {
    check(id, flowId)
    check(options, Match.Maybe({ invite: Match.Maybe(Boolean) }))
    selfHosted()
    const user = await signedIn()
    const flow = await serviceNow().confirmMove(user._id, id, { invite: options?.invite !== false })
    return flow
  }),
  'selfhost.cancel': asMeteor(async function cancel(id, kind) {
    check(id, flowId)
    check(kind, Match.OneOf('trial', 'move'))
    selfHosted()
    const user = await signedIn()
    return serviceNow().cancel(user._id, id, kind)
  }),
  'selfhost.follow': asMeteor(async function follow(id) {
    check(id, flowId)
    selfHosted()
    const user = await signedIn()
    const flow = await serviceNow().follow(user._id, id)
    // A move that went live: remembered for the banner the administrator may switch on.
    if (flow?.kind === 'move' && flow.state === 'moved' && flow.cloudUrl)
      await SystemSettings.upsertAsync({ _id: MOVED_ROW }, { $set: { url: flow.cloudUrl, teamName: flow.report?.team || flow.team?.name || null, at: new Date() }, $setOnInsert: { banner: false } })
    // A trial that turned enterprise code on: the page takes the server's new public state.
    if (flow?.kind === 'trial' && flow.state === 'unlocked') return { ...flow, enterprise: Meteor.settings.public.enterprise }
    return flow
  }),
  // After a move: a banner for everyone on this server, pointing at the team on Slatebox Cloud.
  // Nothing here is deleted or locked; the administrator switches it on and off.
  'selfhost.movedBanner': asMeteor(async function movedBanner(on) {
    check(on, Boolean)
    selfHosted()
    const user = await signedIn()
    if (!(await isServerAdmin(user._id))) throw new Meteor.Error('admin_required', 'Only an administrator of this server can do this.')
    const row = await SystemSettings.findOneAsync({ _id: MOVED_ROW })
    if (!row?.url) throw new Meteor.Error('not_moved', 'No team has moved to Slatebox Cloud from this server yet.')
    await SystemSettings.updateAsync({ _id: MOVED_ROW }, { $set: { banner: on } })
    return { banner: on }
  }),
})

// The panel follows a flow every second or two; keys are typed by hand.
DDPRateLimiter.addRule({ type: 'method', name: 'selfhost.follow', connectionId: () => true }, 90, 60 * 1000)
DDPRateLimiter.addRule({ type: 'method', name: 'selfhost.enterKey', connectionId: () => true }, 10, 60 * 1000)
for (const name of ['selfhost.cloudOffer', 'selfhost.startTrial', 'selfhost.resumeTrial', 'selfhost.startMove', 'selfhost.resumeMove', 'selfhost.confirmMove', 'selfhost.cancel', 'selfhost.movedBanner'])
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, 20, 60 * 1000)

Meteor.startup(async () => {
  await UpgradeFlows.rawCollection().createIndex({ kind: 1, createdAt: -1 }).catch(() => {})
  if (!onCloud()) await installIdNow().catch(() => {})
})
