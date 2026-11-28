// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Google vendor as the recipes runtime starts it (enterprise/server/recipes/index.mjs
// VENDOR_FACTORIES): runtime deps in ({ store, clock, trigger, settings, log }), Google's vault,
// fetch and settings borrowed from the running integrations (connectors-hand-off), Drive's channels
// and the poll's versions kept as rows in the runtime's recipeLedger (kinds google.watch,
// google.poll). Its timers run on every process and are safe with many: the poll checks each file
// at its own cadence; a new version is one debounced trigger, however many processes saw it.
//   every minute   active Google recipes are watched (push, when this server is reachable over
//                  https and settings.recipes.googleWatchSecret is set) and polled
//   every 15 min   channels ending within two hours are renewed; those of paused or deleted
//                  recipes are stopped
import { recipeConnectors } from '../connectors-hand-off.mjs'
import { createVendor } from './index.mjs'
import { GOOGLE_BASES } from './session.mjs'
import { WATCH_PATH } from './watch.mjs'

const GOOGLE_ADDRESS = 'google://drive'

/** Drive's channels and the poll's versions as recipeLedger rows. */
export function ledgerWatchStores(ledger) {
  const cid = (id) => `gwatch:${id}`
  const vid = (id) => `gpoll:${id}`
  const back = (row) => (row ? { ...row, _id: row.channelId } : null)
  return {
    channels: {
      put: (row) => ledger.updateOne({ _id: cid(row._id) }, { $set: { ...row, _id: cid(row._id), channelId: row._id, kind: 'google.watch' } }, { upsert: true }),
      get: async (id) => back(await ledger.findOne({ _id: cid(id) })),
      remove: (id) => ledger.deleteOne({ _id: cid(id) }),
      forInstance: async (instanceId) => (await ledger.find({ kind: 'google.watch', instanceId }).toArray()).map(back),
      expiring: async (before) => (await ledger.find({ kind: 'google.watch', expiresAt: { $lt: before } }).toArray()).map(back),
      all: async () => (await ledger.find({ kind: 'google.watch' }, { limit: 5000 }).toArray()).map(back),
    },
    versions: {
      get: (id) => ledger.findOne({ _id: vid(id) }),
      put: (id, row) => ledger.updateOne({ _id: vid(id) }, { $set: { ...row, kind: 'google.poll' } }, { upsert: true }),
    },
  }
}

export function googleVendorFactory({ store, clock = Date.now, trigger, settings = {}, log = () => {}, timers = { setInterval, clearInterval } }) {
  const connectors = () => {
    const found = recipeConnectors()
    if (!found) throw Object.assign(new Error('Connect Google again on the Integrations page.'), { name: 'SignInNeeded', code: 'needs_sign_in' })
    return found
  }
  const watchStore = ledgerWatchStores(store.ledger)
  const origin = () => String(settings.public?.siteUrl || process.env.ROOT_URL || '').replace(/\/+$/, '')
  const secret = () => settings.recipes?.googleWatchSecret || null
  const instances = {
    get: (id) => store.instances.findOne({ _id: id }),
    polled: () => store.instances.find({ state: 'active', 'match.google.fileIds.0': { $exists: true } }, { limit: 500 }).toArray(),
  }
  const bases = () => {
    const configured = recipeConnectors()?.google.config().bases
    return configured ? { drive: configured.drive, docs: configured.docs, sheets: configured.drive === GOOGLE_BASES.drive ? GOOGLE_BASES.sheets : configured.drive } : GOOGLE_BASES
  }
  const vendor = createVendor({
    integrationOf: async (userId) => (await connectors().integrations.findOne({ ownerId: userId, address: GOOGLE_ADDRESS })) || null,
    tokenFor: (userId, { force = false } = {}) => connectors().vault.tokenFor(userId, GOOGLE_ADDRESS, { force }),
    fetch: (...args) => connectors().google.fetch(...args),
    bases: new Proxy({}, { get: (_, key) => bases()[key] }),
    verifiedScopes: () => settings.connectors?.google?.verifiedScopes || [],
    watch: { store: watchStore, instances, secret: () => secret() || '', origin },
    trigger: (instanceId, event) => trigger({ _id: instanceId }, event),
    log,
    now: clock,
  })

  // Push only where Google can reach this server and the channel token can be signed.
  const pushable = () => Boolean(secret()) && /^https:\/\//.test(origin())
  async function tick() {
    if (!recipeConnectors()) return
    if (pushable()) for (const instance of await instances.polled()) await vendor.activated(instance).catch(() => {})
    await vendor._drive.poll().catch((error) => log({ kind: 'drive_poll_failed', code: error?.code || null }))
  }
  async function tidy() {
    if (!recipeConnectors()) return
    for (const row of await watchStore.channels.all()) {
      const instance = await instances.get(row.instanceId)
      if (instance?.state !== 'active') await vendor.deactivated(row.instanceId).catch(() => {})
    }
    await vendor._drive.renew().catch(() => {})
  }
  const every = [timers.setInterval(() => void tick(), 60000), timers.setInterval(() => void tidy(), 15 * 60000)]
  for (const timer of every) timer?.unref?.()
  vendor.stop = () => every.forEach((timer) => timers.clearInterval(timer))
  vendor.tick = tick
  vendor.tidy = tidy
  return vendor
}
googleVendorFactory.routes = () => [{ method: 'POST', path: WATCH_PATH, raw: true, vendor: 'google' }]
