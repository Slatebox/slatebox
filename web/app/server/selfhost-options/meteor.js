/* eslint-disable no-console */
// The Meteor side of the header's Move to Cloud on a self-hosted install (service.mjs): the
// collections, Slatebox Cloud's address, who administers this server and the team, and the methods
// the panel calls. Plain Meteor methods, not registry actions, on purpose: they act for this server
// (its team leaving for Cloud) from its administrator's own session, with nothing a token, an MCP
// tool or an exec call should reach (like enterprise.status beside them).
//
// Slatebox Cloud's address: settings.cloud.origin, else SLATEBOX_CLOUD_URL (as the CLI reads it),
// else https://app.slatebox.com. On Slatebox Cloud itself every method but selfhost.status refuses.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { Organizations, Permissions, SystemSettings } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import { editionOf } from '../../imports/api/common/edition.mjs'
import { CLOUD_ORIGIN } from '../../imports/api/common/selfhost-options.mjs'
import { installHost } from '../enterprise-license.mjs'
import { teamTransfer } from '../team-export/meteor'
import { createCloudClient } from './cloud-client.mjs'
import { createMoveService, MoveError } from './service.mjs'

const MoveFlows = new Mongo.Collection('selfhostFlows')
const MOVED_ROW = 'movedToCloud'

const cloudOrigin = () => Meteor.settings.cloud?.origin || process.env.SLATEBOX_CLOUD_URL || CLOUD_ORIGIN
const onCloud = () => editionOf(Meteor.settings) === 'cloud'

const isServerAdmin = async (userId) =>
  Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))
const isTeamAdmin = async (user) =>
  Boolean(user?.orgId && (await Permissions.findOneAsync({ userId: user._id, orgId: user.orgId, claimId: CONSTANTS.claims.admin._id }, { fields: { _id: 1 } })))

const flows = {
  insert: (doc) => MoveFlows.insertAsync(doc),
  get: (id) => MoveFlows.findOneAsync({ _id: id }),
  set: (id, fields) => MoveFlows.updateAsync({ _id: id }, { $set: fields }),
  latest: (kind) => MoveFlows.findOneAsync({ kind }, { sort: { createdAt: -1 } }),
}

let service = null
function serviceNow() {
  if (service) return service
  const host = installHost({ settings: Meteor.settings, env: process.env })
  service = createMoveService({
    cloud: createCloudClient({ origin: cloudOrigin(), userAgent: `slatebox-server (${host})` }),
    flows,
    isServerAdmin,
    preflight: (userId) => teamTransfer.preflight(userId),
    async exportStream(userId, passphrase, onEnd) {
      const issued = await teamTransfer.startExport(userId)
      const ticket = new URL(issued.downloadUrl).pathname.split('/').pop()
      const { stream } = await teamTransfer.openExport(ticket, passphrase, { onEnd })
      return stream
    },
    install: { label: Meteor.settings.public?.instanceName || host },
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
  if (onCloud()) throw new Meteor.Error('cloud', 'This is Slatebox Cloud already.')
}
// The service's refusals reach the panel with their own code and words.
const asMeteor = (fn) =>
  async function wrapped(...args) {
    try {
      return await fn.apply(this, args)
    } catch (error) {
      if (error instanceof Meteor.Error) throw error
      if (error instanceof MoveError || (typeof error?.code === 'string' && error?.status < 500)) throw new Meteor.Error(error.code, error.message)
      console.error('[selfhost]', error?.stack || error)
      throw new Meteor.Error('failed', 'Something went wrong on this server. Try again.')
    }
  }
const flowId = Match.Where((value) => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value))

Meteor.methods({
  // What the header and the panel show: who is asking, the team, and the move under way.
  'selfhost.status': asMeteor(async function status() {
    const user = await signedIn()
    const edition = editionOf(Meteor.settings)
    const moved = await SystemSettings.findOneAsync({ _id: MOVED_ROW }, { fields: { url: 1, teamName: 1, banner: 1 } })
    const base = { edition, moved: moved?.banner ? { url: moved.url, teamName: moved.teamName || null } : null }
    if (edition === 'cloud') return { ...base, serverAdmin: false }
    const serverAdmin = await isServerAdmin(user._id)
    const teamAdmin = await isTeamAdmin(user)
    const org = user.orgId ? await Organizations.findOneAsync({ _id: user.orgId }, { fields: { name: 1 } }) : null
    if (!serverAdmin) return { ...base, serverAdmin: false, teamAdmin, team: org ? { name: org.name || '' } : null }
    const team = teamAdmin ? await teamTransfer.preflight(user._id).catch(() => null) : null
    return {
      ...base,
      serverAdmin: true,
      teamAdmin,
      team: team ? { name: team.team?.name || org?.name || '', members: team.members, slates: team.slates } : org ? { name: org.name || '' } : null,
      cloudOrigin: new URL(cloudOrigin()).origin,
      move: await serviceNow().latest(user._id),
      movedSaved: moved ? { url: moved.url, banner: Boolean(moved.banner) } : null,
    }
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
  'selfhost.cancel': asMeteor(async function cancel(id) {
    check(id, flowId)
    selfHosted()
    const user = await signedIn()
    return serviceNow().cancel(user._id, id)
  }),
  'selfhost.follow': asMeteor(async function follow(id) {
    check(id, flowId)
    selfHosted()
    const user = await signedIn()
    const flow = await serviceNow().follow(user._id, id)
    // A move that went live: remembered for the banner the administrator may switch on.
    if (flow?.state === 'moved' && flow.cloudUrl)
      await SystemSettings.upsertAsync({ _id: MOVED_ROW }, { $set: { url: flow.cloudUrl, teamName: flow.report?.team || flow.team?.name || null, at: new Date() }, $setOnInsert: { banner: false } })
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

// The panel follows a move every second or two.
DDPRateLimiter.addRule({ type: 'method', name: 'selfhost.follow', connectionId: () => true }, 90, 60 * 1000)
for (const name of ['selfhost.startMove', 'selfhost.resumeMove', 'selfhost.confirmMove', 'selfhost.cancel', 'selfhost.movedBanner'])
  DDPRateLimiter.addRule({ type: 'method', name, connectionId: () => true }, 20, 60 * 1000)

Meteor.startup(async () => {
  await MoveFlows.rawCollection().createIndex({ kind: 1, createdAt: -1 }).catch(() => {})
})
