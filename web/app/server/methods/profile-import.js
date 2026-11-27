// profile.import.list / profile.import.read / profile.import.keep: About you › "Learn from a data
// export" (imports/ui/components/profile/ExportUpload.jsx). The rules are
// server/profile/import-core.mjs; this file gives it the real dependencies: the account, About you's
// store, the administrator's switch and binding for the profile.import surface, the meter, a
// one-upload-at-a-time lock, and req() inside runAIAction. The file arrives as bytes in the method's
// arguments (EJSON binary), capped by IMPORT_LIMITS.bytes, and is never written anywhere.
// Rate limits: read is an AI method (metering/limits.mjs); list and keep below.
import { Meteor } from 'meteor/meteor'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import req from './ai/req'
import { resolveRequestConnection, surfaceOffFor } from './ai/ai-settings'
import { runAIAction } from '../metering/context.mjs'
import { aiRefusal } from '../metering/meteor'
import { refusalErrorArgs } from '../metering/refusal-pay.mjs'
import { profileStore } from '../profile/meteor'
import { createProfileImport } from '../profile/import-core.mjs'
import { routeHasNoModel } from '../interview/core.mjs'
import { ImportError } from '../../imports/api/common/profile-import.mjs'

// An upload is read and waits on a model: one at a time per person, released when it ends (or after two minutes).
const LOCK_MS = 120000
async function lock(userId) {
  const now = Date.now()
  const acquired = await Meteor.users.updateAsync({ _id: userId, $or: [
    { profileImportAvailableAt: { $exists: false } }, { profileImportAvailableAt: { $lte: now } },
  ] }, { $set: { profileImportAvailableAt: now + LOCK_MS } })
  if (!acquired) return null
  return () => Meteor.users.updateAsync({ _id: userId, profileImportAvailableAt: now + LOCK_MS }, { $unset: { profileImportAvailableAt: true } })
}

const uploads = createProfileImport({
  loadUser: (userId) => Meteor.users.findOneAsync({ _id: userId }, { fields: { _id: 1, isAnonymous: 1, emails: 1 } }),
  profile: profileStore,
  surfaceOff: (userId) => surfaceOffFor({ feature: 'profile.import', userId }),
  async modelMissing(userId) {
    const route = await resolveRequestConnection({ feature: 'profile.import', userId, request: { tools: true } }).catch(() => null)
    return routeHasNoModel(route)
  },
  async allowed(user) {
    const refusal = await aiRefusal(user, 'profile.import')
    if (refusal) throw new Meteor.Error(...refusalErrorArgs({ error: refusal.code, reason: refusal.message, pay: refusal.pay }))
  },
  lock,
  run: (userId, fn) => runAIAction({ feature: 'profile.import', userId }, fn),
  request: (opts) => req(opts),
})

const said = (error) => {
  if (error instanceof Meteor.Error) return error
  if (error instanceof ImportError) return new Meteor.Error(error.code, error.message)
  // never the file's contents: only what went wrong
  console.error('[profile.import]', error?.code || error?.message)
  return new Meteor.Error('unavailable', 'Slatebox could not read that just now. Try again.')
}

Meteor.methods({
  async 'profile.import.list'() {
    try { return await uploads.list(this.userId) } catch (error) { throw said(error) }
  },
  async 'profile.import.read'(input) {
    // a large upload: other calls on the connection need not wait for it
    this.unblock()
    try { return await uploads.read(this.userId, { data: input?.data }) } catch (error) { throw said(error) }
  },
  async 'profile.import.keep'(input) {
    try { return await uploads.keep(this.userId, input) } catch (error) { throw said(error) }
  },
})

// Listing and keeping are a person on the page, never a loop.
DDPRateLimiter.addRule({ type: 'method', name: 'profile.import.list', userId: (userId) => Boolean(userId) }, 30, 60000)
DDPRateLimiter.addRule({ type: 'method', name: 'profile.import.keep', userId: (userId) => Boolean(userId) }, 20, 60000)
