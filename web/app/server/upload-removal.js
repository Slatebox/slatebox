// The Meteor side of common/upload-removal.mjs: the queue (uploadRemovals), the file store, the
// reference check over the database, and the sweep that runs the queue every hour on each server
// (each item is claimed, so two servers never run the same one).
import { Meteor } from 'meteor/meteor'
import { Mongo, MongoInternals } from 'meteor/mongo'
import { Slates } from '../imports/api/common/models'
import { createUploadRemoval, referencedKeys, uploadKeysIn } from './common/upload-removal.mjs'
import { deleteStoredFile, listUploadsOf, storedFileCdn } from './common/fileStore'
import { createCdnInvalidator } from './common/cdn-invalidation.mjs'

export const UploadRemovals = new Mongo.Collection('uploadRemovals')
const queueRows = () => UploadRemovals.rawCollection()

// Collections that never hold what a person sees (a slate, a snapshot, a library item, a suggestion,
// a team's logo...), so the reference check does not read them. Every other collection is read: a
// new one is checked until it is listed here, so a new place that keeps a picture keeps it safe.
export const NOT_REFERENCES = new Set([
  'uploadRemovals', // this queue names the keys it is checking
  'files.files', 'files.chunks', // the stored files themselves (self-hosted servers)
  'slateEvents', 'meterEvents', 'meterTotals', 'walletLedger', 'wallets', 'stripeEvents',
  'aiAudit', 'audit', 'aiControlAudit', 'cachedImages', 'nounProjectResults', 'nounProjectResultsMetaData',
])

function database() {
  return MongoInternals.defaultRemoteCollectionDriver().mongo.db
}

// Every document of every collection that may name a file, one at a time.
async function* everyDocument() {
  const db = database()
  const collections = await db.listCollections({}, { nameOnly: true }).toArray()
  for (const { name, type } of collections) {
    if (type === 'view' || name.startsWith('system.') || NOT_REFERENCES.has(name)) continue
    const cursor = db.collection(name).find({}, { batchSize: 200 })
    try {
      for await (const doc of cursor) yield doc
    } finally {
      await cursor.close().catch(() => {})
    }
  }
}

const queue = {
  put: (item) => queueRows().replaceOne({ _id: item._id }, { ...item, queuedAt: Date.now() }, { upsert: true }),
  async claim({ at, limit, leaseMs }) {
    const items = []
    while (items.length < limit) {
      const item = await queueRows().findOneAndUpdate(
        { dueAt: { $lte: at } },
        { $set: { dueAt: at + leaseMs } },
        { sort: { dueAt: 1 }, returnDocument: 'after', includeResultMetadata: false }
      )
      if (!item) break
      items.push(item)
    }
    return items
  },
  // Only the row this run claimed: one released again meanwhile (a new dueAt) keeps its new wait.
  done: (item) => queueRows().deleteOne({ _id: item._id, dueAt: item.dueAt }),
  later: (item, { dueAt, attempts, failure }) => queueRows().updateOne({ _id: item._id, dueAt: item.dueAt }, { $set: { dueAt, attempts, failure } }),
}

const log = (message, details) => console.log(`[upload-removal] ${message}`, details)

// With files in the bucket behind a CloudFront distribution (aws.cloudFrontDistributionId), what is
// removed is dropped from the CDN too. Files kept in the database (a self-host) have no CDN.
const cdnConfig = storedFileCdn()
const cdn = cdnConfig ? createCdnInvalidator({ ...cdnConfig, log }) : null
// Said once at start, so the logs show whether removed files are dropped from the CDN.
if (Meteor.settings.aws?.imageBucket) {
  log(cdnConfig ? 'CDN invalidation on' : 'CDN invalidation off (no aws.cloudFrontDistributionId); cached copies expire within a day', {})
}

export const uploadRemoval = createUploadRemoval({
  queue,
  files: { listUploadsOf, remove: (key) => deleteStoredFile(key) },
  isUsed: (keys) => referencedKeys(everyDocument(), keys),
  cdn,
  log,
})

let running = null
// One run at a time on this server; a run asked for while one runs waits for the next tick.
function sweepSoon() {
  if (running) return running
  running = uploadRemoval.sweep()
    .catch((error) => log('sweep failed; it runs again within the hour', { name: error?.name }))
    .finally(() => { running = null })
  return running
}

/** Files a save or a deleted slate stopped using. Never throws. */
export function releaseUploads(keys) {
  if (!keys?.length) return Promise.resolve()
  return uploadRemoval.released(keys).catch((error) => log('could not queue released uploads', { name: error?.name }))
}

/**
 * The slates matching selector are about to be removed: the files they show are released (removed
 * after the grace period when nothing else shows them). Never throws.
 */
export async function releaseUploadsOfSlates(selector) {
  try {
    const keys = new Set()
    for await (const slate of Slates.rawCollection().find(selector)) for (const key of uploadKeysIn(slate)) keys.add(key)
    await releaseUploads([...keys])
  } catch (error) {
    log('could not read the slates\' uploads', { name: error?.name })
  }
}

/**
 * An account was removed: its uploads are queued and removed in the background. Never throws and
 * never waits for the file store, so the account removal answers at once; the hourly sweep retries.
 */
export async function removeUploadsOfAccount(user) {
  try {
    await uploadRemoval.accountRemoved({ userId: user?._id, createdAt: user?.createdAt })
    Meteor.defer(() => { sweepSoon() })
  } catch (error) {
    log('could not queue the account\'s uploads', { name: error?.name })
  }
}

Meteor.startup(async () => {
  await queueRows().createIndex({ dueAt: 1 })
  Meteor.setTimeout(sweepSoon, 2 * 60 * 1000)
  Meteor.setInterval(sweepSoon, 60 * 60 * 1000)
})
