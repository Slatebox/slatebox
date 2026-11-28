// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Knowing when a picked Sheet or Doc changed, two ways:
//   watch  Drive's push notifications (files.watch) on each file a recipe reads: Google POSTs
//          /integrations/google/watch with the channel's id and the token Slatebox gave it (an
//          HMAC of the channel id under a server secret, checked in constant time). A channel lasts
//          a day at most; it is renewed two hours before it ends, and stopped when the recipe stops.
//   poll   the fallback, and the whole story where Google cannot reach this server (a self-hosted
//          install behind a firewall): every 5 minutes (a sheet) or 10 (a doc), one files.get per
//          file for its version; a new version triggers the recipe.
// Either way the recipe gets one debounced trigger, so a burst of edits is one run.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const WATCH_PATH = '/integrations/google/watch'
export const WATCH_LIMITS = Object.freeze({ lifetimeMs: 23 * 3600000, renewBeforeMs: 2 * 3600000, pollSheetMs: 5 * 60000, pollDocMs: 10 * 60000, pollBatch: 50 })

/** The token Google echoes on every notification for a channel. */
export const channelToken = (secret, channelId) => createHmac('sha256', String(secret)).update('drive-watch:' + channelId).digest('hex')

export function verifyChannelToken(secret, channelId, token) {
  if (!secret || typeof channelId !== 'string' || typeof token !== 'string') return false
  const want = Buffer.from(channelToken(secret, channelId))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

/**
 * store: { channels: { put(row), get(id), remove(id), forInstance(instanceId), expiring(before) },
 *          versions: { get(id), put(id, version) } }
 * api(userId, method, url, body) → JSON (as the owner; Drive's base in bases.drive)
 * instances: { get(instanceId), polled(now) → [instance] (active Google recipes) }
 * trigger(instanceId, trigger), secret(), origin(), log, now
 */
export function createDriveWatch({ store, api, bases, instances, trigger, secret, origin, log = () => {}, now = Date.now, uuid = randomUUID }) {
  async function start(instance, fileId) {
    const id = uuid()
    const expiration = now() + WATCH_LIMITS.lifetimeMs
    const json = await api(instance.ownerId, 'POST', `${bases.drive}/drive/v3/files/${encodeURIComponent(fileId)}/watch`, { id, type: 'web_hook', address: origin() + WATCH_PATH, token: channelToken(secret(), id), expiration })
    await store.channels.put({ _id: id, instanceId: instance._id, ownerId: instance.ownerId, fileId, resourceId: json.resourceId || null, expiresAt: new Date(Number(json.expiration) || expiration) })
    return id
  }
  async function stop(row) {
    await store.channels.remove(row._id)
    if (row.resourceId) await api(row.ownerId, 'POST', `${bases.drive}/drive/v3/channels/stop`, { id: row._id, resourceId: row.resourceId }).catch(() => {})
  }

  return {
    /** Watch every file an instance reads (setup and resume); files it no longer reads stop. */
    async watch(instance) {
      const want = new Set(instance.match?.google?.fileIds || [])
      const have = await store.channels.forInstance(instance._id)
      for (const row of have) if (!want.has(row.fileId)) await stop(row)
      const watched = new Set(have.map((r) => r.fileId))
      let started = 0
      for (const fileId of want) {
        if (watched.has(fileId)) continue
        try {
          await start(instance, fileId)
          started++
        } catch (error) {
          // No push for this file (Google refused, or cannot reach this server): the poll covers it.
          log({ kind: 'drive_watch_refused', instanceId: instance._id, code: error?.code || null })
        }
      }
      return started
    },
    /** Stop every channel of an instance (pause, delete). */
    async unwatch(instanceId) {
      for (const row of await store.channels.forInstance(instanceId)) await stop(row)
    },
    /** Channels that end within two hours, renewed (a new channel, then the old one stopped). */
    async renew() {
      let renewed = 0
      for (const row of await store.channels.expiring(new Date(now() + WATCH_LIMITS.renewBeforeMs))) {
        const instance = await instances.get(row.instanceId)
        await stop(row)
        if (instance?.state !== 'active') continue
        try {
          await start(instance, row.fileId)
          renewed++
        } catch (error) {
          log({ kind: 'drive_watch_refused', instanceId: row.instanceId, code: error?.code || null })
        }
      }
      return renewed
    },
    /** The poll: one files.get per due file; a new version triggers its recipe. → files that changed */
    async poll() {
      let changed = 0
      for (const instance of (await instances.polled(now())).slice(0, WATCH_LIMITS.pollBatch)) {
        const every = instance.recipeId === 'google-design-doc' ? WATCH_LIMITS.pollDocMs : WATCH_LIMITS.pollSheetMs
        const fileIds = []
        for (const fileId of instance.match?.google?.fileIds || []) {
          const id = `${instance._id}:${fileId}`
          const seen = await store.versions.get(id)
          if (seen?.checkedAt && now() - Date.parse(seen.checkedAt) < every) continue
          let meta
          try {
            meta = await api(instance.ownerId, 'GET', `${bases.drive}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,version`)
          } catch (error) {
            log({ kind: 'drive_poll_failed', instanceId: instance._id, code: error?.code || null })
            continue
          }
          const version = String(meta.version || '')
          await store.versions.put(id, { version, checkedAt: new Date(now()).toISOString() })
          if (seen?.version && seen.version !== version) fileIds.push(fileId)
        }
        if (fileIds.length) {
          changed += fileIds.length
          await trigger(instance._id, { kind: 'vendor', event: 'google.file_changed', fileIds })
        }
      }
      return changed
    },
    /** The route Google calls. Always answers fast: 200 for a channel it knows, 401 for a bad token. */
    route() {
      return {
        method: 'POST',
        path: WATCH_PATH,
        raw: true,
        async handler(req, res) {
          const header = (name) => {
            const value = req.headers?.[name]
            return typeof value === 'string' ? value.slice(0, 300) : null
          }
          const channelId = header('x-goog-channel-id')
          const state = header('x-goog-resource-state')
          if (!verifyChannelToken(secret(), channelId, header('x-goog-channel-token'))) {
            log({ kind: 'drive_watch_unsigned' })
            return res.status(401).end()
          }
          const row = await store.channels.get(channelId)
          res.status(200).end()
          if (!row || state === 'sync') return undefined
          if (['update', 'change', 'add'].includes(state)) await trigger(row.instanceId, { kind: 'vendor', event: 'google.file_changed', fileIds: [row.fileId] }).catch(() => {})
          else if (state === 'remove' || state === 'trash') await trigger(row.instanceId, { kind: 'vendor', event: 'google.file_removed', fileIds: [row.fileId] }).catch(() => {})
          return undefined
        },
      }
    },
  }
}

/** Watch stores in memory (tests). */
export function memoryWatchStores() {
  const channels = new Map()
  const versions = new Map()
  return {
    channels: {
      put: async (row) => channels.set(row._id, row),
      get: async (id) => channels.get(id) || null,
      remove: async (id) => channels.delete(id),
      forInstance: async (instanceId) => [...channels.values()].filter((r) => r.instanceId === instanceId),
      expiring: async (before) => [...channels.values()].filter((r) => r.expiresAt < before),
      _rows: channels,
    },
    versions: {
      get: async (id) => versions.get(id) || null,
      put: async (id, row) => versions.set(id, row),
      _rows: versions,
    },
  }
}
