// The server's provider keys live only in the backend (ai-control/keys.mjs): sealed with the
// existing key-encryption key, one active key per provider, revocable (cipher wiped, record kept)
// and rotatable (add, test, switch, old one revoked). No answer, list, audit row or error ever
// carries a key: only its fingerprint. Fake keys and a fake master key throughout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { aiControlWorld, allStrings, fakeMaster, FAKE_MASTER_ENV } from './ai-control-kit.mjs'
import { keyFingerprint, publicKey } from '../web/app/server/ai-control/keys.mjs'
import { loadMasterKey, open as openKey, seal } from '../web/app/server/metering/vault.mjs'
import { createAppRegistry } from '../web/app/server/actions/index.mjs'

const KEY_A = 'sk-test-meta-aaaaaaaaaaaaaaaaaaaa1111'
const KEY_B = 'sk-test-meta-bbbbbbbbbbbbbbbbbbbb2222'
const KEY_C = 'sk-test-meta-cccccccccccccccccccc3333'

async function withMeta(options) {
  const w = await aiControlWorld(options)
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' }, models: ['muse-ember-1.0'] })
  return w
}

const noKeyIn = (value, ...keys) => {
  const strings = allStrings(value).join('\n')
  for (const key of keys) assert.ok(!strings.includes(key), 'a key appears in the output')
}

test('encryption round trip with the existing SLATEBOX_KEY_ENCRYPTION_KEY: the same vault, AAD bound to the provider', async () => {
  const master = loadMasterKey(FAKE_MASTER_ENV)
  assert.ok(master)
  const owner = { ownerType: 'server', ownerId: 'server', provider: 'meta' }
  const cipher = seal({ master, owner, plaintext: KEY_A })
  assert.equal(openKey({ master, owner, cipher }), KEY_A)
  assert.throws(() => openKey({ master, owner: { ...owner, provider: 'openai' }, cipher }), 'a cipher copied to another provider does not open')
  const w = await withMeta()
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const doc = w.keys.rows.find((row) => row._id === saved.id)
  assert.equal(doc.kind, 'key')
  assert.equal(doc.ownerType, 'server')
  assert.equal(doc.cipher.keyId, master.keyId, 'sealed under the existing master key')
  assert.equal(openKey({ master: fakeMaster(), owner, cipher: doc.cipher }), KEY_A)
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, KEY_A)
})

test('a key is never returned: add, list, test, the audit trail and the snapshot carry only its fingerprint', async () => {
  const w = await withMeta()
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A, label: 'Main' })
  assert.equal(saved.status, 'active', 'the first key of a provider is active')
  assert.equal(saved.keyFingerprint, keyFingerprint(KEY_A))
  assert.match(saved.keyFingerprint, /^sha256:[0-9a-f]{8}…1111$/)
  assert.ok(!('cipher' in saved))
  const tested = await w.keyStore.test({ id: saved.id })
  noKeyIn([saved, await w.keyStore.list(), tested, w.audited, w.raw.audit.rows, w.control.get(), w.snapshot()], KEY_A)
  assert.equal(w.snapshot().keys.meta.keyFingerprint, saved.keyFingerprint, 'the snapshot knows meta has an active key')
  assert.ok(!allStrings(w.raw.audit.rows).some((s) => s.includes('aaaaaaaaaaaaaaaa')))
})

test('a duplicate key is refused, and a revoked key is never accepted again', async () => {
  const w = await withMeta()
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A }), /already saved/)
  await w.keyStore.revoke({ actor: w.actor, id: saved.id, reason: 'leaked' })
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A }), /revoked and cannot be used again/)
})

test('one active key per provider; activate switches and revokes the old key, wiping its cipher', async () => {
  const w = await withMeta()
  const first = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const second = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_B })
  assert.equal(second.status, 'standby', 'a second key waits')
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, KEY_A)
  const out = await w.keyStore.activate({ actor: w.actor, id: second.id })
  assert.equal(out.key.status, 'active')
  assert.equal(out.revoked.id, first.id)
  const old = w.keys.rows.find((row) => row._id === first.id)
  assert.equal(old.status, 'revoked')
  assert.equal(old.cipher, undefined, 'the old cipher is wiped')
  assert.equal(old.keyFingerprint, first.keyFingerprint, 'its record stays')
  assert.equal(w.keys.rows.filter((row) => row.provider === 'meta' && row.status === 'active').length, 1)
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, KEY_B)
  // the unique index holds: a second active key cannot be written behind the store's back
  await assert.rejects(w.keys.insertOne({ _id: 'x', ownerType: 'server', ownerId: 'server', kind: 'key', provider: 'meta', status: 'active', keyFingerprint: 'sha256:other' }), (error) => error.code === 11000)
})

test('rotate ("cycle"): the new key is tested and switched to only when the test passes; the old one is revoked at once', async () => {
  let accepts = KEY_B
  const w = await withMeta({ check: async (connection) => (connection.apiKey === accepts ? { ok: true, message: 'Connected.' } : { ok: false, message: `The endpoint did not accept the key ${connection.apiKey}.` }) })
  const first = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  accepts = 'nothing'
  const failed = await w.keyStore.rotate({ actor: w.actor, provider: 'meta', apiKey: KEY_B })
  assert.equal(failed.activated, false)
  assert.equal(failed.key.status, 'standby', 'a failing test keeps the new key as standby')
  assert.equal(failed.test.ok, false)
  noKeyIn(failed, KEY_B)
  assert.match(failed.test.message, /\[redacted\]|did not accept/)
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, KEY_A, 'the old key still answers')
  accepts = KEY_C
  const done = await w.keyStore.rotate({ actor: w.actor, provider: 'meta', apiKey: KEY_C, reason: 'quarterly' })
  assert.equal(done.activated, true)
  assert.equal(done.revoked.id, first.id)
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, KEY_C)
  assert.equal(w.keys.rows.find((row) => row._id === first.id).status, 'revoked')
  assert.ok(w.keys.rows.find((row) => row._id === done.key.id).lastTest.ok)
})

test('revoke: the cipher is wiped, the record stays, and the parts that used it say plainly that there is no key', async () => {
  const w = await withMeta()
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const out = await w.keyStore.revoke({ actor: w.actor, id: saved.id, reason: 'leaked' })
  assert.equal(out.wasActive, true)
  const doc = w.keys.rows.find((row) => row._id === saved.id)
  assert.equal(doc.status, 'revoked')
  assert.equal(doc.cipher, undefined)
  assert.equal(doc.revokedBy, 'admin1')
  assert.deepEqual(await w.keyStore.keyFor('meta'), { error: 'Meta (Muse) has no active key. An administrator adds one in Admin → AI control.' })
  const route = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(route.connection, null)
  assert.match(route.error, /Meta \(Muse\) has no active key/)
  assert.ok(w.raw.audit.rows.some((row) => row.action === 'ai.keys.revoke' && row.reason === 'leaked'))
})

test('remove deletes a standby or revoked key; an active key must be revoked first', async () => {
  const w = await withMeta()
  const active = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const standby = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_B })
  await assert.rejects(w.keyStore.remove({ actor: w.actor, id: active.id, reason: 'x' }), /Revoke the active key first/)
  await w.keyStore.remove({ actor: w.actor, id: standby.id, reason: 'not needed' })
  assert.equal(w.keys.rows.some((row) => row._id === standby.id), false)
})

test('keyFor opens the active key per request and touches lastUsedAt at most once per 5 minutes per key', async () => {
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const w = await withMeta({ now: () => new Date(clock) })
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const writes = []
  const update = w.keys.updateOne.bind(w.keys)
  w.keys.updateOne = async (filter, change, options) => {
    if (change.$set?.lastUsedAt) writes.push(change.$set.lastUsedAt)
    return update(filter, change, options)
  }
  await w.keyStore.keyFor('meta')
  await w.keyStore.keyFor('meta')
  clock += 60 * 1000
  await w.keyStore.keyFor('meta')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(writes.length, 1)
  clock += 5 * 60 * 1000
  await w.keyStore.keyFor('meta')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(writes.length, 2)
  assert.ok(w.keys.rows.find((row) => row._id === saved.id).lastUsedAt)
})

test('without SLATEBOX_KEY_ENCRYPTION_KEY a key is not stored, and says what to set', async () => {
  const w = await aiControlWorld({ master: null })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' } })
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A }), (error) => error.status === 503 && /SLATEBOX_KEY_ENCRYPTION_KEY/.test(error.message))
  assert.equal(w.keys.rows.length, 0)
})

test('a key saved under another master key reads as "add it again", never as a crash', async () => {
  const w = await withMeta()
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: KEY_A })
  const other = { key: Buffer.alloc(32, 9), keyId: 'deadbeef' }
  const row = w.keys.rows.find((r) => r._id === saved.id)
  row.cipher = seal({ master: other, owner: { ownerType: 'server', ownerId: 'server', provider: 'meta' }, plaintext: KEY_A })
  assert.match((await w.keyStore.keyFor('meta')).error, /another SLATEBOX_KEY_ENCRYPTION_KEY/)
})

test('services beside the models keep their keys the same way: a Stability key, a picture-search key with its cx', async () => {
  const w = await aiControlWorld()
  await w.keyStore.add({ actor: w.actor, provider: 'stability', apiKey: 'sk-test-stability-0000000000001234' })
  assert.equal((await w.aiSettings.auxCredential('stability')).apiKey, 'sk-test-stability-0000000000001234')
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'google-cse', apiKey: 'AIza-test-key-0000000000000000000' }), /search engine id/i)
  await w.keyStore.add({ actor: w.actor, provider: 'google-cse', apiKey: 'AIza-test-key-0000000000000000000', model: 'cx-123' })
  assert.equal((await w.aiSettings.auxCredential('google-cse')).model, 'cx-123')
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'nounproject', apiKey: 'onlyonepart' }), /key:secret/)
})

test('the ai.keys.* actions: a person sends, switches, revokes and deletes; an agent may only list and test a saved key; revoke and remove need a reason', () => {
  const registry = createAppRegistry()
  const byId = Object.fromEntries(registry.list().map((a) => [a.id, a]))
  for (const id of ['ai.keys.add', 'ai.keys.activate', 'ai.keys.rotate', 'ai.keys.revoke', 'ai.keys.remove']) {
    assert.deepEqual(byId[id].principals, ['person'], id)
    assert.ok(!byId[id].mounts.http, `${id} has no HTTP route`)
    assert.equal(byId[id].scope, 'ai:admin')
  }
  assert.deepEqual(byId['ai.keys.list'].principals, ['person', 'agent'])
  assert.deepEqual(byId['ai.keys.test'].principals, ['person', 'agent'])
  assert.ok(byId['ai.keys.revoke'].input.required.includes('reason'))
  assert.ok(byId['ai.keys.remove'].input.required.includes('reason'))
  assert.ok(!byId['ai.keys.rotate'].input.required.includes('reason'), 'a rotation needs no reason')
  assert.equal(byId['ai.keys.add'].input.properties.apiKey.writeOnly, true)
  for (const action of Object.values(byId).filter((a) => a.id.startsWith('ai.keys.'))) {
    assert.ok(!JSON.stringify(action.output || {}).includes('cipher'), `${action.id} never answers with a cipher`)
  }
  assert.equal(publicKey({ _id: 'k', provider: 'meta', status: 'active', cipher: { data: 'x' } }).cipher, undefined)
})
