// The app's one save core (server/slate-save-core.mjs) over the real collections, and the event
// log it appends to. Every server writer of slate content imports `slateSaveCore` from here.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { Slates } from '../imports/api/common/models'
import { createSlateSaveCore } from './slate-save-core.mjs'
import { growthStep } from './growth/meteor'
import { audit } from './audit/recorder.mjs'
import { slateWriteEntries } from './audit/slate-entries.mjs'
import { releaseUploads } from './upload-removal'
import { recipeHooks } from './recipes-hooks.mjs'

// One row per save: { _id: slateId:revision, slateId, revision, at, source, actor, notes, fields }.
export const SlateEvents = new Mongo.Collection('slateEvents')

// The activity log: a slate created, copied, renamed or edited, whichever door it came through.
// A save inside a transaction is written only once the action that ran it succeeds (deferred).
// Not awaited: the save answers without waiting for the log.
const logSlateWrite = (change) => {
  for (const [entry, options] of slateWriteEntries(change)) {
    audit.record(entry, { ...options, deferred: Boolean(change.session) })
  }
  // Recipes that keep this slate in step with a file hear of the save (not awaited; a slate no
  // recipe watches costs a cached lookup).
  if (change.kind === 'saved' && change.slate?.shareId) recipeHooks.slateSaved({ shareId: change.slate.shareId, actor: change.actor || null })
}

// A slate a person or guest made counts towards the growth funnel's "first slate" (server/growth,
// Slatebox Cloud only). Inside a caller's transaction it is left to the account's next report.
const countingFirstSlate = (core) => ({
  ...core,
  async create(request) {
    const result = await core.create(request)
    const actor = request?.actor
    if (result?.created && !request.session && (actor?.kind === 'person' || actor?.kind === 'guest')) growthStep(actor.userId, 'slate')
    return result
  },
})

export const slateSaveCore = countingFirstSlate(createSlateSaveCore({
  slates: Slates.rawCollection(),
  events: SlateEvents.rawCollection(),
  onEventError: (error, row) => console.error('slate event not logged', row.slateId, row.revision, error.message),
  onWrite: logSlateWrite,
  // a deleted photo note's file: removed after the grace period, when nothing names it (upload-removal.mjs)
  onReleased: (keys) => releaseUploads(keys),
}))

Meteor.startup(async () => {
  await SlateEvents.rawCollection().createIndex({ slateId: 1, revision: 1 }, { unique: true })
})

// The same core for a save the page reads straight back: an interactive slate's model
// (creativeSlates.save and .play), whose Undo and next request are made on the revision the save
// answers. Its writes go through Meteor's own collection methods, which join the running method's
// write fence: the method's `updated` waits until the publications watching the slate have taken
// the change, as production's interactive save (Slates.updateAsync) always did. Without it the
// save answered about 100 ms before its watchers had the change. A write inside a caller's
// transaction stays raw (Meteor's methods take no session). scripts/slate-save-fence.live.test.mjs
const raw = Slates.rawCollection()
export const fencedSlateSaveCore = countingFirstSlate(createSlateSaveCore({
  slates: {
    findOne: (filter, options) => raw.findOne(filter, options),
    async updateOne(filter, update, options) {
      if (options?.session) return raw.updateOne(filter, update, options)
      return { matchedCount: await Slates.updateAsync(filter, update) }
    },
    async insertOne(doc, options) {
      if (options?.session) return raw.insertOne(doc, options)
      return { insertedId: await Slates.insertAsync(doc) }
    },
  },
  events: SlateEvents.rawCollection(),
  onEventError: (error, row) => console.error('slate event not logged', row.slateId, row.revision, error.message),
  onWrite: logSlateWrite,
  // a deleted photo note's file: removed after the grace period, when nothing names it (upload-removal.mjs)
  onReleased: (keys) => releaseUploads(keys),
}))
