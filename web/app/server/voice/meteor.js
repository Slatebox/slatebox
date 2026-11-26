// Voice's Meteor glue: the voice.open method (tickets), the relay on the app's own HTTP server at
// /voice/ws, the ticket and session collections, and the SIGTERM hand-off. The rules are in the
// pure modules beside this file (open.mjs, tickets.mjs, session.mjs, meter.mjs, relay.mjs).
//
// What is kept: a ticket (hashed, 60 s, then gone) and one VoiceSessions row per session (who,
// which part, which model, when, why it ended, what it cost). Audio is never stored, and neither is
// a transcript: the words the person and the agent say go to the browser only, and the slate's or
// the interview's own text path keeps the turns it always keeps.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { WebApp } from 'meteor/webapp'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import WebSocket from 'ws'
import { aiSettings, surfaceOffFor } from '../methods/ai/ai-settings'
import { protocolOf } from '../methods/ai/connection-request.mjs'
import { guardedLookup } from '../methods/ai/endpoint-policy.mjs'
import { voicePrice } from '../metering/prices.mjs'
import { aiRefusal } from '../metering/meteor'
import { installedMeter } from '../metering/context.mjs'
import { refusalErrorArgs } from '../metering/refusal-pay.mjs'
import { canReadSlate, findSlate } from '../common/slate-access'
import { profileStore } from '../profile/meteor'
import { settingsRefusal } from '../../imports/api/common/interview.mjs'
import { onTerminate } from '../shutdown.mjs'
import { createTickets } from './tickets.mjs'
import { VoiceError, createVoiceOpen, featuresOf } from './open.mjs'
import { createVoiceMeter, voiceLimits } from './meter.mjs'
import { createVoiceRelay } from './relay.mjs'

const VoiceTickets = new Mongo.Collection('voiceTickets')
const VoiceSessions = new Mongo.Collection('voiceSessions')
const tickets = createTickets({
  store: {
    insert: (doc) => VoiceTickets.rawCollection().insertOne(doc),
    // the driver (6.x) answers the document itself
    take: (id, at) => VoiceTickets.rawCollection().findOneAndDelete({ _id: id, expiresAt: { $gt: at } }),
  },
})

// A person's voice sessions open now, on any server: rows still ticking (a server that died
// leaves its rows open, so only a tick in the last few minutes counts).
const openSessions = (userId, { except = [] } = {}) => VoiceSessions.rawCollection().countDocuments({
  userId, state: 'open', lastTickAt: { $gt: new Date(Date.now() - 3 * 60_000) }, ...(except.length && { _id: { $nin: except } }),
})

const loadUser = (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1, emails: 1, orgId: 1, pro: 1, freeStopped: 1, profile: 1 } })

const voice = createVoiceOpen({
  loadUser,
  findSlate: ({ slateId, shareId }) => findSlate({ slateId, shareId }),
  canReadSlate,
  // the interview by voice keeps the interview's own switches in About you
  async personRefusal(user, surface) {
    if (surface !== 'voice.interview') return null
    return settingsRefusal(await profileStore.getSettings(user._id))
  },
  surfaceOff: ({ feature, userId }) => surfaceOffFor({ feature, userId }),
  resolve: ({ userId, feature, forRequest = false }) => aiSettings.resolveFor({ userId, feature, forRequest }),
  meterRefusal: ({ user, feature }) => aiRefusal(user, feature),
  openSessions: (userId) => openSessions(userId),
  perPerson: () => limits().perPerson,
  tickets,
})

const said = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof VoiceError) return new Meteor.Error(...refusalErrorArgs({ error: error.code, reason: error.message, pay: error.details?.pay }))
  console.error('[voice]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'Voice could not start. Try again.')
}

Meteor.methods({
  /** { surface: 'voice.chat' | 'voice.interview', slateId? | shareId? } → { ticket, expiresAt, path, v, surface } */
  async 'voice.open'(input) {
    try {
      return await voice.open(this.userId, input)
    } catch (error) {
      throw said(error)
    }
  },
  /** { surface } → { available, code?, message?, pay? }: whether the page offers voice there (no ticket). */
  async 'voice.status'(input) {
    if (!this.userId) return { available: false, code: 'sign-in' }
    try {
      return await voice.status(this.userId, input)
    } catch (error) {
      throw said(error)
    }
  },
})
// A person turns voice on, not a loop.
DDPRateLimiter.addRule({ type: 'method', name: 'voice.open', userId: (userId) => Boolean(userId) }, 10, 60000)
// A page asks when it opens a conversation and when the AI settings change.
DDPRateLimiter.addRule({ type: 'method', name: 'voice.status', userId: (userId) => Boolean(userId) }, 30, 60000)

// ---------- the relay ----------
const limits = () => voiceLimits(Meteor.settings)

// The provider's socket: its key in a header, never the URL; an own connection's address is looked
// up with the rules of its level (a name that resolves to a private address is refused).
function connectProvider(url, headers, { rules = null } = {}) {
  return new WebSocket(url, { headers, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024, handshakeTimeout: 15000, ...(rules && { lookup: guardedLookup(rules) }) })
}

// Every minute: the person is still signed in with an account, and nobody turned the part off.
async function stillAllowed(binding) {
  const user = await Meteor.users.findOneAsync({ _id: binding.userId }, { fields: { isAnonymous: 1, 'services.resume.loginTokens': 1 } })
  if (!user || user.isAnonymous || !(user.services?.resume?.loginTokens || []).length) return false
  return !(await surfaceOffFor({ feature: featuresOf(binding.surface).request, userId: binding.userId }))
}

const sessionDeps = {
  connect: connectProvider,
  redeem: (ticket) => tickets.redeem(ticket),
  prepare: (binding) => voice.prepare(binding, { protocolOf, priceOf: (connection) => voicePrice(connection.model, connection.prices ?? null) }),
  meterFor: ({ binding, prepared, sessionId }) => {
    const meter = installedMeter()
    return createVoiceMeter({
      meter, metered: Boolean(meter?.enabled()) && !prepared.own,
      userId: binding.userId, feature: featuresOf(binding.surface).meter, sessionId, model: prepared.model, price: prepared.price,
    })
  },
  mintReconnect: async ({ binding, resume }) => (await tickets.mint({ userId: binding.userId, surface: binding.surface, slateId: binding.slateId, resume })).ticket,
  allowed: stillAllowed,
  record: {
    start: (doc) => VoiceSessions.rawCollection().insertOne(doc),
    update: (id, set) => VoiceSessions.rawCollection().updateOne({ _id: id }, { $set: set }),
    end: (id, set) => VoiceSessions.rawCollection().updateOne({ _id: id }, { $set: set }),
  },
  get limits() { return limits() },
  newId: () => Random.id(),
}

let relay = null
Meteor.startup(async () => {
  await VoiceTickets.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => console.error('[voice] ticket index', error.message))
  await VoiceSessions.rawCollection().createIndex({ userId: 1, startedAt: -1 }).catch((error) => console.error('[voice] session index', error.message))
  const origins = [process.env.ROOT_URL, ...(Array.isArray(Meteor.settings.voice?.origins) ? Meteor.settings.voice.origins : [])].filter(Boolean)
  relay = createVoiceRelay({
    server: WebApp.httpServer, origins, perPod: () => limits().perPod, perPerson: () => limits().perPerson,
    openElsewhere: (userId, { except }) => openSessions(userId, { except }),
    // proxies in front (Meteor's own setting): the browser's address for the waiting limit
    forwardedCount: Number.parseInt(process.env.HTTP_FORWARDED_COUNT || '0', 10) || 0,
    sessionDeps,
  })
})

// A rollout's SIGTERM: every open session is handed a ticket to carry on at the next server.
onTerminate(() => relay?.drain())
