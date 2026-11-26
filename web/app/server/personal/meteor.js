// The Meteor side of For you: the real dependencies in, the service out (deps.personal in
// server/actions/mount.js, created after the library because building saves a library draft and
// opens it on a slate through the same doors), the per-person rate limits, and the index. Everything
// it wires runs without Meteor in the tests (server/personal/core.mjs, open-slate.mjs).
import { Meteor } from 'meteor/meteor'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import { PersonalIdeas } from '../../imports/api/common/models'
import req from '../methods/ai/req'
import { resolveRequestConnection, surfaceOffFor } from '../methods/ai/ai-settings'
import { draftForYou } from '../methods/workshops'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { profileStore } from '../profile/meteor'
import { connectedTools } from '../profile/integration-hooks.mjs'
import { routeHasNoModel } from '../interview/core.mjs'
import { createPersonalIdeas } from './core.mjs'
import { IDEA_WORDS } from '../../imports/api/common/personal-ideas.mjs'
import { openOnNewSlate } from './open-slate.mjs'
import { PERSONAL_RATE_LIMITS } from '../actions/personal.mjs'

const FEATURE = 'personal.suggest'
// A suggestion or a build waits on a model: one at a time per person, released when it ends (or after three minutes:
// a build is a draft with a retry).
const LOCK_MS = 180000
async function lock(userId) {
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({ _id: userId, $or: [
    { forYouAvailableAt: { $exists: false } }, { forYouAvailableAt: { $lte: now } },
  ] }, { $set: { forYouAvailableAt: now + LOCK_MS } })
  if (!acquired) return null
  return () => Meteor.users.updateAsync({ _id: userId, forYouAvailableAt: now + LOCK_MS }, { $unset: { forYouAvailableAt: true } })
}

// A Meteor.Error from the meter or the drafting, as an action's refusal: its own code and words, a status the
// registry keeps (a 5xx would be answered without them).
const STATUS = { busy: 409, 'sign-in': 403, 'draft-unavailable': 409, 'ai-unavailable': 409, 'invalid-brief': 422, 'invalid-format': 422 }
// The drafting's own words were written for the board builder ("Sign in to use AI.", "Describe the decision in 10 to
// 1,200 characters.", "...enable workshop generation..."): on a For you card they read in For you's words instead.
const DRAFT_WORDS = { 'sign-in': IDEA_WORDS.guest, 'ai-unavailable': IDEA_WORDS.buildOff, 'invalid-brief': IDEA_WORDS.buildFailed, 'invalid-format': IDEA_WORDS.buildFailed }
function asRefusal(error, words = {}) {
  if (!(error instanceof Meteor.Error)) return error
  const code = String(error.error || 'unavailable').replace(/-/g, '_')
  return Object.assign(new Error(words[error.error] || error.reason || error.message), { status: STATUS[error.error] ?? 402, code, ...(error.details && { details: error.details }) })
}
const refusing = (fn, words) => async (...args) => {
  try { return await fn(...args) } catch (error) { throw asRefusal(error, words) }
}

/** For you over the app's collections. `shared` is mount.js's deps (save core, library, operation runs). */
export function createAppPersonal(shared) {
  return createPersonalIdeas({
    ideas: PersonalIdeas.rawCollection(),
    loadUser: (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1, emails: 1, orgId: 1 } }),
    profile: profileStore,
    connectedTools: (userId) => connectedTools(userId),
    surfaceOff: (userId) => surfaceOffFor({ feature: FEATURE, userId }),
    // No model answers the surface on this server (no route, or its provider has no key yet): said before the meter.
    async modelMissing(userId) {
      const route = await resolveRequestConnection({ feature: FEATURE, userId, request: { tools: true } }).catch(() => null)
      return routeHasNoModel(route)
    },
    async allowed(user) {
      const refusal = await aiRefusal(user, FEATURE)
      if (refusal) throw Object.assign(new Error(refusal.message), { status: 402, code: refusal.code, details: { pay: refusal.pay } })
    },
    lock,
    run: refusing((userId, fn) => runAIAction({ feature: FEATURE, userId }, fn)),
    request: (opts) => req(opts),
    draft: refusing((input) => draftForYou(input), DRAFT_WORDS),
    library: { saveMade: (principal, input) => shared.library.saveMade(principal, input) },
    open: ({ principal, itemId, key }) => openOnNewSlate({ deps: shared, principal, itemId, key }),
  })
}

// A person's calls, per minute (a token's are counted by the registry's limiter).
for (const [name, count] of Object.entries(PERSONAL_RATE_LIMITS)) {
  DDPRateLimiter.addRule({ type: 'method', name, userId: (userId) => Boolean(userId) }, count, 60000)
}

Meteor.startup(async () => {
  // one row per person (_id is their user id): the index the account's removal and every read use is _id's own
  try {
    await PersonalIdeas.rawCollection().createIndex({ userId: 1 })
  } catch (error) {
    console.error('[personal] indexes', error?.message)
  }
})
