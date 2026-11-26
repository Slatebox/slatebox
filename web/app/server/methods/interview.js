// interview.start / interview.turn / interview.keep: the talk with the agent in Profile › About you
// (imports/ui/components/profile/Interview.jsx). The turns are server/interview/core.mjs; this file
// gives it the real dependencies: the account, About you's store, the tools a person connected (the
// profile integrations seam, filled where the integrations code runs), the administrator's switch and
// binding for the interview surface, the meter, a one-turn-at-a-time lock, and req() inside
// runAIAction. Rate limits: start and turn are AI methods (metering/limits.mjs); keep is a write
// (DDPRateLimiter below).
import { Meteor } from 'meteor/meteor'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import req from './ai/req'
import { resolveRequestConnection, surfaceOffFor } from './ai/ai-settings'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { refusalErrorArgs } from '../metering/refusal-pay.mjs'
import { profileStore } from '../profile/meteor'
import { connectedTools } from '../profile/integration-hooks.mjs'
import { createInterview, routeHasNoModel } from '../interview/core.mjs'
import { InterviewError } from '../../imports/api/common/interview.mjs'

// A turn waits on a model: one at a time per person, released when it ends (or after a minute).
const LOCK_MS = 60000
async function lock(userId) {
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({ _id: userId, $or: [
    { interviewTurnAvailableAt: { $exists: false } }, { interviewTurnAvailableAt: { $lte: now } },
  ] }, { $set: { interviewTurnAvailableAt: now + LOCK_MS } })
  if (!acquired) return null
  return () => Meteor.users.updateAsync({ _id: userId, interviewTurnAvailableAt: now + LOCK_MS }, { $unset: { interviewTurnAvailableAt: true } })
}

const interview = createInterview({
  loadUser: (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1, emails: 1 } }),
  profile: profileStore,
  connectedTools: (userId) => connectedTools(userId),
  surfaceOff: (userId) => surfaceOffFor({ feature: 'interview', userId }),
  // No model answers the interview on this server (no route, or its provider has no key yet: a
  // self-hosted install with no keys): said before the meter (core.mjs routeHasNoModel).
  async modelMissing(userId) {
    const route = await resolveRequestConnection({ feature: 'interview', userId, request: { tools: true } }).catch(() => null)
    return routeHasNoModel(route)
  },
  async allowed(user) {
    const refusal = await aiRefusal(user, 'interview')
    if (refusal) throw new Meteor.Error(...refusalErrorArgs({ error: refusal.code, reason: refusal.message, pay: refusal.pay }))
  },
  lock,
  run: (userId, fn) => runAIAction({ feature: 'interview', userId }, fn),
  request: (opts) => req(opts),
})

const said = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof InterviewError) return new Meteor.Error(error.code, error.message)
  console.error('[interview]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'The talk could not continue. Try again.')
}

Meteor.methods({
  async 'interview.start'() {
    try { return await interview.start(this.userId) } catch (error) { throw said(error) }
  },
  async 'interview.turn'(input) {
    try { return await interview.turn(this.userId, input) } catch (error) { throw said(error) }
  },
  async 'interview.keep'(facts) {
    try { return await interview.keep(this.userId, facts) } catch (error) { throw said(error) }
  },
})

// Keeping is a person choosing, never a loop.
DDPRateLimiter.addRule({ type: 'method', name: 'interview.keep', userId: (userId) => Boolean(userId) }, 20, 60000)
