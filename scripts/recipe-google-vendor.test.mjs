// Google as a recipe vendor (enterprise/server/recipes/vendors/google): the run's session (drive.file,
// every call budgeted, a refused token renewed once then "connect again"); Drive's push channels
// (watched on activate, the token an HMAC checked in constant time, renewed before they end, stopped
// on pause); the poll (one files.get per file at its cadence, a trigger only on a new version); and
// write-back's hard limits (one cell of the granted column, never a formula, never before Google
// verified the scope).
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-google-vendor.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkGoogleHardLimits, SPREADSHEETS_SCOPE } from '../enterprise/server/recipes/vendors/google/index.mjs'
import { channelToken, verifyChannelToken, WATCH_LIMITS, WATCH_PATH } from '../enterprise/server/recipes/vendors/google/watch.mjs'
import { a1, columnLetter } from '../enterprise/server/recipes/vendors/google/session.mjs'
import { countingBudget } from './fakes/recipe-lite-context.mjs'
import { googleWorld } from './fakes/google-recipe-world.mjs'

const SHEET = 'sheet0123456789abc'
const files = () => ({ [SHEET]: { name: 'Roster', mimeType: 'application/vnd.google-apps.spreadsheet', version: 7, tabs: { People: [['Name'], ['Ana']] } } })

test('session: the owner\'s token, every call budgeted; a refused token renewed once, then "connect again"', async () => {
  const w = googleWorld({ files: files() })
  const instance = w.addInstance('g1', 'google-sheet-board', { fileId: SHEET, template: 'org-chart' })
  const budget = countingBudget({ vendorCalls: 2 })
  const s = await w.vendor.session(instance, { budget })
  assert.equal((await s.fileMeta(SHEET)).version, '7')
  assert.deepEqual(await s.sheetValues(SHEET, a1('People', 'A1:Z10')), [['Name'], ['Ana']])
  await assert.rejects(s.sheetTabs(SHEET), { code: 'budget' })
  await assert.rejects(s.fileMeta('../etc'), { code: 'bad_file_id' })
  w.state.vault = 'ya29.expired'
  w.state.refreshed = 'ya29.test-token'
  const again = await w.vendor.session(instance)
  assert.equal((await again.fileMeta(SHEET)).name, 'Roster', 'renewed once under the vault\'s lease')
  w.state.refreshed = null
  await assert.rejects(again.fileMeta(SHEET), { code: 'needs_sign_in' })
  w.integration.status = 'needs_sign_in'
  await assert.rejects(w.vendor.session(instance), { code: 'needs_sign_in' })
  assert.equal(a1("Bob's tab", 'B2'), "'Bob''s tab'!B2")
  assert.deepEqual([0, 25, 26, 27].map(columnLetter), ['A', 'Z', 'AA', 'AB'])
})

test('watch: a channel per file on activate (its token an HMAC of its id); Google\'s ping triggers the recipe; a bad token is 401; renewal and stop', async () => {
  const w = googleWorld({ files: files() })
  const instance = w.addInstance('g1', 'google-sheet-board', { fileId: SHEET, template: 'org-chart' })
  assert.equal(await w.vendor.activated(instance), 1)
  const [watch] = w.state.watches
  assert.equal(watch.address, 'https://app.slatebox.com' + WATCH_PATH)
  assert.equal(watch.type, 'web_hook')
  assert.equal(watch.token, channelToken('watch-secret-0123456789', watch.id))
  assert.ok(verifyChannelToken('watch-secret-0123456789', watch.id, watch.token))
  assert.ok(!verifyChannelToken('watch-secret-0123456789', watch.id, watch.token.slice(0, -1) + (watch.token.endsWith('0') ? '1' : '0')), 'one character changed')
  assert.equal(await w.vendor.activated(instance), 0, 'already watched')
  const [route] = w.vendor.routes()
  const ping = async (headers) => {
    const res = { statusCode: 0, status(code) { this.statusCode = code; return this }, end() { return this } }
    await route.handler({ headers }, res)
    return res.statusCode
  }
  assert.equal(await ping({ 'x-goog-channel-id': watch.id, 'x-goog-channel-token': watch.token, 'x-goog-resource-state': 'sync' }), 200)
  assert.equal(w.triggers.length, 0, 'the first "sync" ping is not a change')
  assert.equal(await ping({ 'x-goog-channel-id': watch.id, 'x-goog-channel-token': watch.token, 'x-goog-resource-state': 'update' }), 200)
  assert.deepEqual(w.triggers, [{ instanceId: 'g1', trigger: { kind: 'vendor', event: 'google.file_changed', fileIds: [SHEET] } }])
  assert.equal(await ping({ 'x-goog-channel-id': watch.id, 'x-goog-channel-token': 'forged', 'x-goog-resource-state': 'update' }), 401)
  assert.equal(w.triggers.length, 1)
  // Two hours before it ends, a new channel replaces it.
  w.clock.at += WATCH_LIMITS.lifetimeMs - WATCH_LIMITS.renewBeforeMs + 60000
  assert.equal(await w.vendor._drive.renew(), 1)
  assert.equal(w.state.watches.length, 2)
  assert.deepEqual(w.state.stops, [{ id: watch.id, resourceId: 'res-' + SHEET }])
  await w.vendor.deactivated('g1')
  assert.equal(w.watchStore.channels._rows.size, 0)
  assert.equal(w.state.stops.length, 2)
})

test('poll: one files.get per file at its cadence; a trigger only when the version changed', async () => {
  const w = googleWorld({ files: files() })
  w.addInstance('g1', 'google-sheet-board', { fileId: SHEET, template: 'org-chart' })
  assert.equal(await w.vendor._drive.poll(), 0, 'the first look only records the version')
  w.clock.at += 60000
  assert.equal(await w.vendor._drive.poll(), 0)
  assert.equal(w.state.calls['files.get'], 1, 'not due yet (every 5 minutes for a sheet)')
  w.clock.at += WATCH_LIMITS.pollSheetMs
  assert.equal(await w.vendor._drive.poll(), 0, 'same version')
  w.state.files[SHEET].version = 8
  w.clock.at += WATCH_LIMITS.pollSheetMs
  assert.equal(await w.vendor._drive.poll(), 1)
  assert.deepEqual(w.triggers.map((t) => t.trigger.event), ['google.file_changed'])
  assert.deepEqual(w.vendor.intervals().map((i) => i.name), ['google-poll', 'google-watch-renew'])
})

test('write-back: one cell of the granted column of the granted sheet, never a formula; not offered until Google verified the scope', async () => {
  const grant = { scope: { fileId: SHEET, tab: 'Board', columns: ['B'] } }
  const write = { kind: 'google.write_sheet', target: { fileId: SHEET, range: "'Board'!B5" }, body: { values: [['Done']] }, key: 'cell:1' }
  assert.equal(checkGoogleHardLimits(write, grant), null)
  assert.equal(checkGoogleHardLimits({ ...write, target: { fileId: SHEET, range: "'Board'!C5" } }, grant), 'refused', 'another column')
  assert.equal(checkGoogleHardLimits({ ...write, target: { fileId: SHEET, range: "'Other'!B5" } }, grant), 'refused', 'another tab')
  assert.equal(checkGoogleHardLimits({ ...write, target: { fileId: 'another0123456789', range: "'Board'!B5" } }, grant), 'refused', 'another file')
  assert.equal(checkGoogleHardLimits({ ...write, target: { fileId: SHEET, range: "'Board'!B5:B9" } }, grant), 'refused', 'a range')
  assert.equal(checkGoogleHardLimits({ ...write, body: { values: [['=IMPORTXML("x")']] } }, grant), 'refused', 'a formula')
  const off = googleWorld({ files: files() })
  const instance = off.addInstance('g1', 'google-sheet-board', { fileId: SHEET, template: 'kanban' })
  assert.equal(off.vendor.writesOffered(), false)
  await assert.rejects(off.vendor.perform(write, { instance, grant }), { code: 'refused' })
  const on = googleWorld({ files: files(), verified: [SPREADSHEETS_SCOPE] })
  const inst = on.addInstance('g1', 'google-sheet-board', { fileId: SHEET, template: 'kanban' })
  assert.equal(on.vendor.writesOffered(), true)
  await assert.rejects(on.vendor.perform({ ...write, target: { fileId: SHEET, range: "'Board'!C5" } }, { instance: inst, grant }), { code: 'refused' })
  assert.deepEqual(await on.vendor.perform(write, { instance: inst, grant }), { ref: `${SHEET}:'Board'!B5` })
  assert.deepEqual(on.state.writes, [{ fileId: SHEET, range: "'Board'!B5", values: [['Done']] }])
})
