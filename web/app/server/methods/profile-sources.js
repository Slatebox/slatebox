// profile.sources.list / profile.sources.read / profile.sources.keep: About you › "Use <tool> to
// personalize" (imports/ui/components/profile/ToolSources.jsx). The rules are
// server/profile/sources-core.mjs; this file gives it the real dependencies: the account, About you's
// store, the tools a person connected and the bounded look around one (the profile integrations
// seam, filled where the integrations code runs), the administrator's switch and binding for the
// profile.sources surface, the meter, a one-look-at-a-time lock, and req() inside runAIAction.
// Rate limits: read is an AI method (metering/limits.mjs); list and keep below.
import { Meteor } from 'meteor/meteor'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import req from './ai/req'
import { resolveRequestConnection, surfaceOffFor } from './ai/ai-settings'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { refusalErrorArgs } from '../metering/refusal-pay.mjs'
import { profileStore } from '../profile/meteor'
import { lookAroundTool, lookableTools } from '../profile/integration-hooks.mjs'
import { createProfileSources } from '../profile/sources-core.mjs'
import { routeHasNoModel } from '../interview/core.mjs'
import { SourcesError } from '../../imports/api/common/profile-sources.mjs'

// A look waits on outside servers and a model: one at a time per person, released when it ends (or after two minutes).
const LOCK_MS = 120000
async function lock(userId) {
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({ _id: userId, $or: [
    { profileSourcesAvailableAt: { $exists: false } }, { profileSourcesAvailableAt: { $lte: now } },
  ] }, { $set: { profileSourcesAvailableAt: now + LOCK_MS } })
  if (!acquired) return null
  return () => Meteor.users.updateAsync({ _id: userId, profileSourcesAvailableAt: now + LOCK_MS }, { $unset: { profileSourcesAvailableAt: true } })
}

const sources = createProfileSources({
  loadUser: (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1, emails: 1 } }),
  profile: profileStore,
  sources: (userId) => lookableTools(userId),
  lookAround: (userId, ref) => lookAroundTool(userId, ref),
  surfaceOff: (userId) => surfaceOffFor({ feature: 'profile.sources', userId }),
  async modelMissing(userId) {
    const route = await resolveRequestConnection({ feature: 'profile.sources', userId, request: { tools: true } }).catch(() => null)
    return routeHasNoModel(route)
  },
  async allowed(user) {
    const refusal = await aiRefusal(user, 'profile.sources')
    if (refusal) throw new Meteor.Error(...refusalErrorArgs({ error: refusal.code, reason: refusal.message, pay: refusal.pay }))
  },
  lock,
  run: (userId, fn) => runAIAction({ feature: 'profile.sources', userId }, fn),
  request: (opts) => req(opts),
})

const said = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof SourcesError) return new Meteor.Error(error.code, error.message)
  console.error('[profile.sources]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'Slatebox could not read that just now. Try again.')
}

Meteor.methods({
  async 'profile.sources.list'() {
    try { return await sources.list(this.userId) } catch (error) { throw said(error) }
  },
  async 'profile.sources.read'(input) {
    try { return await sources.read(this.userId, input) } catch (error) { throw said(error) }
  },
  async 'profile.sources.keep'(input) {
    try { return await sources.keep(this.userId, input) } catch (error) { throw said(error) }
  },
})

// Listing and keeping are a person on the page, never a loop.
DDPRateLimiter.addRule({ type: 'method', name: 'profile.sources.list', userId: (userId) => Boolean(userId) }, 30, 60000)
DDPRateLimiter.addRule({ type: 'method', name: 'profile.sources.keep', userId: (userId) => Boolean(userId) }, 20, 60000)
