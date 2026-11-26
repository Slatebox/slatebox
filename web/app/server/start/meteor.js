// The Meteor side of the start page's use-case interview and its tiles: the real dependencies in,
// the services out (deps.startTiles in server/actions/mount.js, created after the library because a
// build saves library drafts and opens them on a slate through the same doors), the method the
// interview's turns call ('start.interview.turn'), the per-person rate limits, and the index.
// Everything it wires runs without Meteor in the tests (interview-core.mjs, tiles-core.mjs,
// ../personal/open-slate.mjs).
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { PersonalTiles } from '../../imports/api/common/models'
import CONSTANTS from '../../imports/api/common/constants'
import req from '../methods/ai/req'
import { resolveRequestConnection, surfaceOffFor } from '../methods/ai/ai-settings'
import { draftForTile } from '../methods/workshops'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { COPY } from '../metering/policy.mjs'
import { ESTIMATES } from '../metering/prices.mjs'
import { profileStore } from '../profile/meteor'
import { connectedTools } from '../profile/integration-hooks.mjs'
import { routeHasNoModel } from '../interview/core.mjs'
import { openBoardsOnNewSlate } from '../personal/open-slate.mjs'
import { principalFromUser } from '../actions/principal.mjs'
import { API_TOKEN_SCOPES } from '../api-token-core.mjs'
import { START_WORDS, StartError } from '../../imports/api/common/start-interview.mjs'
import { TILE_WORDS } from '../../imports/api/common/personal-tiles.mjs'
import { TILE_RATE_LIMITS } from '../actions/start-tiles.mjs'
import { createStartInterview } from './interview-core.mjs'
import { createPersonalTiles } from './tiles-core.mjs'

const FEATURE = 'start.interview'
// A guest's build is metered under start.build (the guest allowance), a signed-in person's under personal.build.
const buildFeature = (user) => (user?.isAnonymous ? 'start.build' : 'personal.build')
const userFields = { fields: { _id: 1, isAnonymous: 1, emails: 1, orgId: 1 } }
const loadUser = (userId) => Meteor.users.findOneAsync({ _id: userId }, userFields)

// One turn, or one build, at a time per person: released when it ends (or after the time it may take: a build
// drafts up to four boards, each with a retry).
function lockOn(field, ms) {
  return async (userId) => {
    const now = Date.now()
    const acquired = await Meteor.users.updateAsync({ _id: userId, $or: [{ [field]: { $exists: false } }, { [field]: { $lte: now } }] }, { $set: { [field]: now + ms } })
    if (!acquired) return null
    return () => Meteor.users.updateAsync({ _id: userId, [field]: now + ms }, { $unset: { [field]: true } })
  }
}

// A refusal from the meter or the drafting (a Meteor.Error), as the action's or the method's refusal: its own code and
// words with a status the registry keeps. The drafting's words were written for the board builder ("Sign in to use
// AI.", "...enable workshop generation..."): on a tile they read in the tile's words instead.
const STATUS = { busy: 409, 'sign-in': 403, guest: 403, 'draft-unavailable': 409, 'ai-unavailable': 409, 'invalid-brief': 422, 'invalid-format': 422 }
const DRAFT_WORDS = { 'ai-unavailable': TILE_WORDS.buildOff, 'invalid-brief': TILE_WORDS.buildFailed, 'invalid-format': TILE_WORDS.buildFailed }
function asRefusal(error, words = {}) {
  if (!(error instanceof Meteor.Error)) return error
  const code = String(error.error || 'unavailable').replace(/-/g, '_')
  return Object.assign(new Error(words[error.error] || error.reason || error.message), { status: STATUS[error.error] ?? 402, code, ...(error.details && { details: error.details }) })
}
const refusing = (fn, words) => async (...args) => {
  try { return await fn(...args) } catch (error) { throw asRefusal(error, words) }
}
// A guest where no meter runs (so no guest allowance) reads the start page's own words, not the board builder's.
async function allowedFor(user, feature) {
  const refusal = await aiRefusal(user, feature)
  if (!refusal) return
  const message = refusal.code === 'guest' && user?.isAnonymous && refusal.message === COPY.guestAI ? START_WORDS.guestOnly : refusal.message
  throw Object.assign(new Error(message), { status: refusal.code === 'guest' ? 403 : 402, code: refusal.code, details: { pay: refusal.pay } })
}

/** The tiles over the app's collections. `shared` is mount.js's deps (save core, library, operation runs). */
export function createAppStartTiles(shared) {
  const tiles = createPersonalTiles({
    tiles: PersonalTiles.rawCollection(),
    loadUser,
    profile: profileStore,
    newId: () => Random.id(),
    allowed: (user) => allowedFor(user, buildFeature(user)),
    lock: lockOn('startTileAvailableAt', 300000),
    // one build is one metered action, whatever number of boards it drafts (each board's estimate set aside)
    run: refusing((user, fn) => runAIAction({ feature: buildFeature(user), userId: user._id, estimateMicros: (ESTIMATES['personal.build'] ?? 5000) * 4 }, fn)),
    draft: refusing((input) => draftForTile(input), DRAFT_WORDS),
    library: { saveMade: (principal, input) => shared.library.saveMade(principal, input) },
    open: ({ principal, itemIds, name, key }) => openBoardsOnNewSlate({ deps: shared, principal, itemIds, name, key }),
    // /new shows the start page to a person who keeps tiles (first-slate-route.mjs): how many, on their account
    marker: (userId, count) => Meteor.users.updateAsync({ _id: userId }, count > 0 ? { $set: { 'profile.startTiles': count } } : { $unset: { 'profile.startTiles': true } }),
  })
  startTiles = tiles
  return tiles
}

let startTiles = null
const interview = createStartInterview({
  loadUser,
  profile: profileStore,
  connectedTools: (userId) => connectedTools(userId),
  surfaceOff: (userId) => surfaceOffFor({ feature: FEATURE, userId }),
  // No model answers the surface on this server (no route, or its provider has no key yet): said before the meter.
  async modelMissing(userId) {
    const route = await resolveRequestConnection({ feature: FEATURE, userId, request: { tools: true } }).catch(() => null)
    return routeHasNoModel(route)
  },
  allowed: (user) => allowedFor(user, FEATURE),
  lock: lockOn('startTurnAvailableAt', 60000),
  // the meter's own refusal (a Meteor.Error) reaches the page as it is, so the talk shows its way on (PayNotice)
  run: (userId, fn) => runAIAction({ feature: FEATURE, userId }, fn),
  request: (opts) => req(opts),
  tiles: {
    full: (userId) => startTiles.full(userId),
    revisable: (principal, tileId) => startTiles.revisable(principal, tileId),
    saveFromTalk: (principal, talk) => startTiles.saveFromTalk(principal, talk),
  },
})

const said = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof StartError || (Number.isInteger(error?.status) && typeof error?.code === 'string')) return new Meteor.Error(error.code, error.message, error.details)
  console.error('[start]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'The talk could not continue. Try again.')
}

Meteor.methods({
  // The person's answer: the agent's next question, or its plan (kept as their tile). A guest's account is enough.
  async [CONSTANTS.methods.start.interview.turn](input) {
    const user = this.userId ? await loadUser(this.userId) : null
    const principal = user ? principalFromUser(user, API_TOKEN_SCOPES) : null
    try { return await interview.turn(principal, input) } catch (error) { throw said(error) }
  },
})

// A person's calls, per minute (start.interview.turn, build and rebuild are also AI methods: metering/limits.mjs).
for (const [name, count] of Object.entries(TILE_RATE_LIMITS)) {
  DDPRateLimiter.addRule({ type: 'method', name, userId: (userId) => Boolean(userId) }, count, 60000)
}

Meteor.startup(async () => {
  try {
    await PersonalTiles.rawCollection().createIndex({ userId: 1, usedAt: -1 })
  } catch (error) {
    console.error('[start] indexes', error?.message)
  }
})
