// The Slack and Google vendors as the recipes runtime starts them (VENDOR_FACTORIES), over the
// runtime's own store (memory Mongo): the Slack events route's hand-off reaches the recipes that watch
// a channel (recipeInbox rows, one debounced trigger each), the channel ledger lives in recipeLedger
// beside the runtime's rows without touching them, a run's session reads through the integrations'
// vault and fetch, and nothing works without the running integrations (sign in again). Google: the
// minute timer polls each picked file and triggers on a new version.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-google-factories.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMemoryDb } from './fakes/mongo-memory.mjs'
import { createRecipeStore } from '../enterprise/server/recipes/store.mjs'
import { setRecipeConnectors } from '../enterprise/server/recipes/vendors/connectors-hand-off.mjs'
import { slackRecipeIngest, setSlackRecipeIngest } from '../enterprise/server/recipes/vendors/slack/hand-off.mjs'
import { slackVendorFactory } from '../enterprise/server/recipes/vendors/slack/factory.mjs'
import { googleVendorFactory } from '../enterprise/server/recipes/vendors/google/factory.mjs'
import { ACCOUNT, CHANNEL, TEAM, USERS } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { fakeSlackApi, memoryGates } from './fakes/recipe-lite-context.mjs'
import { googleWorld } from './fakes/google-recipe-world.mjs'

const TOKEN = 'xoxp-factory-test'

/** The Slack Web API over HTTP (form posts), answered by the fake. */
function slackFetch(api) {
  const { call } = fakeSlackApi(api)
  return async (url, init) => {
    const method = new URL(url).pathname.replace('/api/', '')
    const params = Object.fromEntries(new URLSearchParams(init.body))
    try {
      const json = await call(init.headers.authorization.replace('Bearer ', ''), method, params)
      return { status: 200, json: async () => json, headers: { get: () => null } }
    } catch (error) {
      return { status: 200, json: async () => ({ ok: false, error: error.slack }), headers: { get: () => null } }
    }
  }
}

function runtime() {
  const db = createMemoryDb()
  const store = createRecipeStore((name) => db[name])
  const triggered = []
  const trigger = async (selector, event) => triggered.push({ selector, event })
  return { db, store, triggered, trigger, clock: () => Date.parse('2026-11-27T18:00:00Z') }
}

test('Slack: the events route\'s hand-off reaches the watching recipes; a session reads through the integrations; none without them', async () => {
  const rt = runtime()
  setRecipeConnectors(null)
  setSlackRecipeIngest(null)
  const vendor = slackVendorFactory(rt)
  assert.equal(slackRecipeIngest(), vendor.ingest, 'the factory hands its ingest to the Slack route')
  assert.deepEqual(slackVendorFactory.routes(), [], 'Slack\'s events come in on the Slack route')
  await rt.store.instances.insertOne({ _id: 'i1', ownerId: 'ana', state: 'active', recipeId: 'slack-decision-log', match: { slack: { teamId: TEAM, channels: [CHANNEL.id] } } })
  await rt.store.instances.insertOne({ _id: 'i2', ownerId: 'ana', state: 'paused', recipeId: 'slack-timeline', match: { slack: { teamId: TEAM, channels: [CHANNEL.id] } } })
  const kept = await slackRecipeIngest().handle({ type: 'event_callback', team_id: TEAM, event: { type: 'message', channel: CHANNEL.id, ts: '1795200000.000001', user: 'U0ANA', text: 'We decided to ship Friday' } })
  assert.deepEqual(kept, { kept: 1, triggered: 1 })
  assert.deepEqual(rt.triggered, [{ selector: { _id: 'i1' }, event: { kind: 'vendor', event: 'slack.message', channels: [CHANNEL.id] } }], 'the paused one is not')
  const row = await rt.store.inbox.findOne({ _id: `slack:${TEAM}:${CHANNEL.id}:1795200000.000001` })
  assert.deepEqual(row.instanceIds, ['i1'])

  const instance = await rt.store.instances.findOne({ _id: 'i1' })
  await assert.rejects(vendor.session(instance), { code: 'needs_sign_in' }, 'no integrations running: sign in again')
  const api = { token: TOKEN, me: 'U0ANA', channels: [{ id: CHANNEL.id, name: CHANNEL.name, members: ['U0ANA'] }], users: USERS }
  setRecipeConnectors({
    vault: { tokenFor: async (userId, address) => (userId === 'ana' && address === 'slack://workspace' ? TOKEN : null) },
    integrations: { findOne: async ({ ownerId, address }) => (ownerId === 'ana' && address === 'slack://workspace' ? { status: 'active', slackTeamId: TEAM, slackUserId: 'U0ANA', account: ACCOUNT } : null) },
    slack: { fetch: slackFetch(api), config: () => ({ apiBase: 'https://slack.com', listed: false, historyLimit: 15, historyPerMinute: 1 }), gates: memoryGates() },
    google: { fetch: async () => { throw new Error('unused') }, config: () => ({}) },
  })
  const session = await vendor.session(instance)
  assert.equal(await session.isMember(CHANNEL.id), true)
  assert.equal((await session.inbox(CHANNEL.id)).length, 1)
  await session.ledger(CHANNEL.id).upsert([{ key: 'dec:C0CHECKOUT1:1', kind: 'decision', data: { title: 'Ship Friday' }, sourceRef: { ts: '1' } }])
  const ledgerRow = await rt.store.ledger.findOne({ _id: `slack:${TEAM}:${CHANNEL.id}:dec:C0CHECKOUT1:1` })
  assert.deepEqual([ledgerRow.instanceIds, ledgerRow.teamId, 'instanceId' in ledgerRow], [['i1'], TEAM, false], 'a channel row, not one of the runtime\'s per-instance rows')
  assert.ok(await session.claimFold(CHANNEL.id))
  await session.releaseFold(CHANNEL.id, { foldedTs: '1795200000.000001', lastFoldAt: '2026-11-27T18:00:00.000Z', backfilled: true, pendingThreads: [] })
  assert.equal((await session.foldState(CHANNEL.id)).foldedTs, '1795200000.000001')
  await vendor.forget('i1')
  assert.equal(await rt.store.ledger.findOne({ _id: ledgerRow._id }), null, 'deleting the recipe drops rows no other recipe reads')
  setRecipeConnectors(null)
  setSlackRecipeIngest(null)
})

test('Google: the watch route is the runtime\'s raw route; the minute timer polls each file and triggers on a new version', async () => {
  const rt = runtime()
  const SHEET = 'sheet0123456789abc'
  const gw = googleWorld({ files: { [SHEET]: { name: 'Roster', mimeType: 'application/vnd.google-apps.spreadsheet', version: 3, tabs: { People: [['Name']] } } } })
  const timers = { made: [], setInterval: (fn, ms) => (timers.made.push(ms), { unref() {} }), clearInterval: () => {} }
  setRecipeConnectors({
    vault: { tokenFor: async () => gw.state.token },
    integrations: { findOne: async () => ({ status: 'active' }) },
    slack: { fetch: async () => { throw new Error('unused') }, config: () => ({}), gates: memoryGates() },
    google: { fetch: gw.fetch, config: () => ({ bases: { drive: 'https://www.googleapis.com', docs: 'https://docs.googleapis.com' } }) },
  })
  let at = Date.parse('2026-11-27T18:00:00Z')
  const vendor = googleVendorFactory({ ...rt, clock: () => at, settings: {}, timers })
  assert.deepEqual(timers.made, [60000, 900000])
  assert.deepEqual(googleVendorFactory.routes(), [{ method: 'POST', path: '/integrations/google/watch', raw: true, vendor: 'google' }])
  await rt.store.instances.insertOne({ _id: 'g1', ownerId: 'ana', state: 'active', recipeId: 'google-sheet-board', match: { google: { fileIds: [SHEET] } } })
  await vendor.tick()
  assert.equal(gw.state.calls['files.watch'] || 0, 0, 'no watch secret or https address: poll only')
  assert.equal(rt.triggered.length, 0, 'the first look records the version')
  gw.state.files[SHEET].version = 4
  at += 5 * 60000
  await vendor.tick()
  assert.deepEqual(rt.triggered, [{ selector: { _id: 'g1' }, event: { kind: 'vendor', event: 'google.file_changed', fileIds: [SHEET] } }])
  const s = await vendor.session(await rt.store.instances.findOne({ _id: 'g1' }))
  assert.equal((await s.fileMeta(SHEET)).name, 'Roster')
  setRecipeConnectors(null)
})
