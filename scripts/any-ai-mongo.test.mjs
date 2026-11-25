// Any AI against a real MongoDB: the providerKeys indexes must let one owner keep several named
// connections of the same type (two OpenAI-compatible endpoints, a named DeepInfra key beside an
// older unnamed one), while an owner still has at most one unnamed key per provider. A stub store
// cannot show this: the unique index lives in the database.
//
// Runs against SLATEBOX_TEST_MONGO_PORT when it is set; otherwise it starts a throwaway mongod
// (SLATEBOX_TEST_MONGOD, or the one in the Meteor dev bundle) on a free port and stops it after.
// Skips when neither a port nor a mongod binary is available.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { M1_INDEXES, runM1, runM2, runM5, M2_MARKER, M5_MARKER } from '../web/app/server/metering/migrations.mjs'
import { createKeyStore } from '../web/app/server/ai-control/keys.mjs'
import { importSettingsKeys } from '../web/app/server/migrations/ai-control-002.mjs'
import { PROVIDER_PRESETS } from '../web/app/server/ai-control/provider-presets.mjs'
import { BUILTIN_PROVIDERS } from '../web/app/server/ai-control/providers.mjs'
import { createConnectionStore } from '../web/app/server/methods/ai/connection-store.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { loadMasterKey, seal, last4 } from '../web/app/server/metering/vault.mjs'

function findMongod() {
  if (process.env.SLATEBOX_TEST_MONGOD) return process.env.SLATEBOX_TEST_MONGOD
  const tools = join(homedir(), '.meteor/packages/meteor-tool')
  if (!existsSync(tools)) return null
  for (const version of readdirSync(tools).sort().reverse()) {
    const dir = join(tools, version)
    for (const arch of existsSync(dir) ? readdirSync(dir) : []) {
      const bin = join(dir, arch, 'dev_bundle/mongodb/bin/mongod')
      if (existsSync(bin)) return bin
    }
  }
  return null
}

function findDriver() {
  if (process.env.SLATEBOX_TEST_MONGODB_DRIVER) return process.env.SLATEBOX_TEST_MONGODB_DRIVER
  try {
    return createRequire(new URL('../web/app/package.json', import.meta.url)).resolve('mongodb')
  } catch {}
  const npm = join(homedir(), '.meteor/packages/npm-mongo')
  if (!existsSync(npm)) return null
  for (const version of readdirSync(npm).sort().reverse()) {
    const dir = join(npm, version, 'npm/node_modules/mongodb')
    if (existsSync(dir)) return dir
  }
  return null
}

const freePort = () => new Promise((ok, fail) => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => ok(port)) })
  server.on('error', fail)
})

const mongod = process.env.SLATEBOX_TEST_MONGO_PORT ? null : findMongod()
const driver = findDriver()
const skip = !driver || (!process.env.SLATEBOX_TEST_MONGO_PORT && !mongod) ? 'no MongoDB available' : false

async function database(t) {
  let port = Number(process.env.SLATEBOX_TEST_MONGO_PORT)
  if (!port) {
    port = await freePort()
    const dir = mkdtempSync(join(tmpdir(), 'slatebox-anyai-mongo-'))
    const child = spawn(mongod, ['--dbpath', dir, '--port', String(port), '--bind_ip', '127.0.0.1', '--quiet'], { stdio: 'ignore' })
    t.after(() => { child.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }) })
  }
  const { MongoClient } = createRequire(import.meta.url)(driver)
  const client = new MongoClient(`mongodb://127.0.0.1:${port}`, { serverSelectionTimeoutMS: 20000 })
  await client.connect()
  const db = client.db('slatebox_anyai_' + randomUUID().replaceAll('-', ''))
  t.after(async () => { await db.dropDatabase().catch(() => {}); await client.close() })
  return db
}

function migrationIo(db) {
  const markers = db.collection('systemSettings')
  return {
    hasMarker: async (id) => Boolean(await markers.findOne({ _id: id })),
    setMarker: (id) => markers.updateOne({ _id: id }, { $set: { done: Date.now() } }, { upsert: true }),
    ensureIndex: (collection, spec, options) => db.collection(collection).createIndex(spec, options || {}),
    indexes: async (collection) => db.collection(collection).indexes().catch(() => []),
    dropIndex: (collection, name) => db.collection(collection).dropIndex(name),
    hasSettings: async (id) => Boolean(await markers.findOne({ _id: id })),
    insertSettings: (doc) => markers.insertOne(doc),
  }
}

const people = { ana: { _id: 'ana', orgId: 'team1' }, root: { _id: 'root' } }
function settingsOn(db, master) {
  return createAISettings({
    store: createConnectionStore({ keys: db.collection('providerKeys'), choices: db.collection('aiChoices') }),
    master, settings: { public: { env: 'selfhost' } }, hosted: false,
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user._id === 'ana',
    check: async () => ({ ok: true, reachable: true, tools: 'yes', message: 'ok' }),
  })
}

test('an installation migrated before named connections: the old index is replaced and any mix saves', { skip }, async (t) => {
  const db = await database(t)
  const keys = db.collection('providerKeys')
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  // the database as M1 left it before this change: unique (owner, provider)
  await keys.createIndex({ ownerType: 1, ownerId: 1, provider: 1 }, { unique: true })
  await db.collection('systemSettings').insertOne({ _id: 'migration:pricing-1', done: 1 })
  const legacy = (provider, extra = {}) => ({ _id: randomUUID(), ownerType: 'user', ownerId: 'ana', provider, last4: '6789',
    cipher: seal({ master, owner: { ownerType: 'user', ownerId: 'ana', provider }, plaintext: 'key-0123456789' }), created: 1, ...extra })
  await keys.insertOne(legacy('deepinfra'))
  await keys.insertOne(legacy('daily'))

  assert.equal(await runM2(migrationIo(db)), true)
  assert.equal(await runM2(migrationIo(db)), false, 'once')
  assert.ok(await db.collection('systemSettings').findOne({ _id: M2_MARKER }))
  assert.ok(!(await keys.indexes()).some((i) => i.name === 'ownerType_1_ownerId_1_provider_1'), 'the old index is gone')

  const ai = settingsOn(db, master)
  // two OpenAI-compatible endpoints, and a named DeepInfra key beside the older unnamed one
  await ai.update('ana', { level: 'me', connections: [
    { name: 'desk', type: 'openai-compatible', baseUrl: 'http://192.168.1.20:11434/v1', model: 'a' },
    { name: 'lan', type: 'openai-compatible', baseUrl: 'http://192.168.1.30:1234/v1', model: 'b' },
    { name: 'di-big', type: 'deepinfra', apiKey: 'key-big-0123456789', model: 'x' },
  ], use: { chat: 'me:desk', generation: 'me:lan', presentation: 'me:di-big' } })
  assert.equal(await keys.countDocuments({ ownerType: 'user', ownerId: 'ana' }), 5)
  const view = await ai.view('ana')
  assert.deepEqual(view.mine.connections.map((c) => c.name).sort(), ['deepinfra', 'desk', 'di-big', 'lan'])
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).connection.baseUrl, 'http://192.168.1.30:1234/v1')

  // the older own-keys panel (keys.save, metering/meteor.js) still keeps one unnamed key per
  // provider: saving again replaces it in place
  const filter = { ownerType: 'user', ownerId: 'ana', provider: 'openai-compatible', name: { $exists: false } }
  const keysSave = (baseUrl) => keys.updateOne(filter, { $set: { ownerType: 'user', ownerId: 'ana', provider: 'openai-compatible', baseUrl, model: 'm', last4: '', cipher: null }, $setOnInsert: { _id: randomUUID() } }, { upsert: true })
  await keysSave('https://llm.example.com/v1')
  await keysSave('https://llm2.example.com/v1')
  assert.equal(await keys.countDocuments(filter), 1)
  assert.equal((await keys.findOne(filter)).baseUrl, 'https://llm2.example.com/v1')
  const meteorGlue = (await import('node:fs')).readFileSync(new URL('../web/app/server/metering/meteor.js', import.meta.url), 'utf8')
  assert.match(meteorGlue, /\$setOnInsert: \{ _id: Random\.id\(\) \} \}, \{ upsert: true \}\)/, 'keys.save sets the id only on insert')
  assert.doesNotMatch(meteorGlue, /replaceOne\(\{ ownerType: owner\.ownerType[^\n]*_id: Random\.id\(\)/)
  // and the database still refuses a second unnamed key of one provider, or a second connection of one name
  await assert.rejects(keys.insertOne(legacy('deepinfra')), /E11000/)
  await assert.rejects(keys.insertOne({ _id: randomUUID(), ownerType: 'user', ownerId: 'ana', provider: 'openai', name: 'desk' }), /E11000/)
  // a removed connection is gone, and saving it again works
  await ai.update('ana', { level: 'me', remove: ['lan'] })
  await ai.update('ana', { level: 'me', connections: [{ name: 'lan', type: 'openai-compatible', baseUrl: 'http://192.168.1.31/v1', model: 'c' }] })
  assert.equal(await keys.countDocuments({ ownerType: 'user', ownerId: 'ana', name: 'lan' }), 1)
  // a legacy key turned named: the unnamed document is replaced, not doubled (a connection names its model)
  await ai.update('ana', { level: 'me', connections: [{ name: 'deepinfra', type: 'deepinfra', apiKey: 'key-new-0123456789', model: 'x' }] })
  assert.equal(await keys.countDocuments({ ownerType: 'user', ownerId: 'ana', provider: 'deepinfra' }), 2)
  assert.equal(await keys.countDocuments({ ownerType: 'user', ownerId: 'ana', provider: 'deepinfra', name: { $exists: false } }), 0)
})

test('a fresh installation gets the new indexes from M1 and M2 changes nothing', { skip }, async (t) => {
  const db = await database(t)
  await db.collection('aiAudit').insertOne({ _id: 'x' })
  await runM1(migrationIo(db))
  const before = (await db.collection('providerKeys').indexes()).map((i) => i.name).sort()
  assert.ok(!before.includes('ownerType_1_ownerId_1_provider_1'))
  await runM2(migrationIo(db))
  assert.deepEqual((await db.collection('providerKeys').indexes()).map((i) => i.name).sort(), before)
  const providerIndexes = M1_INDEXES.filter(([collection]) => collection === 'providerKeys')
  assert.ok(providerIndexes.every(([, , options]) => options.unique && options.partialFilterExpression && options.name))
})

// The server's provider keys against a real database (metering/migrations.mjs M5): beside the own
// keys an installation already has, at most one active key per provider, each key once (so two
// servers importing a settings-file key at once store it once), and a revoked key never returns.
test('server keys in MongoDB: M5 indexes beside the own keys, one active key per provider, an import that is idempotent and parallel-safe', { skip }, async (t) => {
  const db = await database(t)
  await db.collection('aiAudit').insertOne({ _id: 'x' })
  await runM1(migrationIo(db))
  await runM2(migrationIo(db))
  const keys = db.collection('providerKeys')
  // an installation from before: the server's unnamed Daily key and a person's unnamed key
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  await keys.insertOne({ _id: randomUUID(), ownerType: 'server', ownerId: 'server', provider: 'daily', last4: '9999', cipher: seal({ master, owner: { ownerType: 'server', ownerId: 'server', provider: 'daily' }, plaintext: 'daily-test-9999' }) })
  assert.equal(await runM5(migrationIo(db)), true)
  assert.equal(await runM5(migrationIo(db)), false, 'once')
  assert.ok(await db.collection('systemSettings').findOne({ _id: M5_MARKER }))
  const names = (await keys.indexes()).map((i) => i.name)
  for (const name of ['providerKeys_unnamed_provider', 'providerKeys_named', 'providerKeys_key_fingerprint', 'providerKeys_key_active']) assert.ok(names.includes(name), name)
  assert.ok('kind' in (await keys.indexes()).find((i) => i.name === 'providerKeys_unnamed_provider').partialFilterExpression)
  const store = createKeyStore({
    keys, master, providerOf: (id) => BUILTIN_PROVIDERS[id] || (PROVIDER_PRESETS[id] ? { _id: id, ...PROVIDER_PRESETS[id] } : null),
    check: async () => ({ ok: true, message: 'Connected.' }),
  })
  const actor = { userId: 'root', principal: 'person', via: 'ddp' }
  const first = await store.add({ actor, provider: 'meta', apiKey: 'sk-test-meta-aaaaaaaaaaaaaaaa1111' })
  await store.add({ actor, provider: 'meta', apiKey: 'sk-test-meta-bbbbbbbbbbbbbbbb2222' })
  // the database itself refuses a second active key and a key saved twice
  await assert.rejects(keys.insertOne({ _id: randomUUID(), ownerType: 'server', ownerId: 'server', kind: 'key', provider: 'meta', status: 'active', keyFingerprint: 'sha256:x' }), /E11000/)
  await assert.rejects(keys.insertOne({ _id: randomUUID(), ownerType: 'server', ownerId: 'server', kind: 'key', provider: 'meta', status: 'standby', keyFingerprint: first.keyFingerprint }), /E11000/)
  // several key documents of one provider sit beside the unnamed Daily key and the named-connection index
  assert.equal(await keys.countDocuments({ ownerType: 'server', provider: 'meta', kind: 'key' }), 2)
  // a settings-file key moved by two servers at once is stored once
  const settings = { ai: { connections: { gem: { type: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', apiKey: 'AIza-test-gemini-00000000000000000' } } } }
  const catalog = { ensureProvider: async ({ id }) => ({ _id: id }) }
  const quiet = { info() {}, warn() {}, error() {} }
  const reports = await Promise.all([1, 2, 3].map(() => importSettingsKeys({ settings, keys: store, catalog, log: quiet })))
  assert.equal(await keys.countDocuments({ provider: 'gemini', kind: 'key' }), 1)
  assert.equal(reports.reduce((n, r) => n + r.moved.length, 0), 1)
  assert.equal(reports.reduce((n, r) => n + r.failed.length, 0), 0)
  // revoked: the record stays without its cipher, and the settings file never brings it back
  const gem = await store.activeOf('gemini')
  await store.revoke({ actor, id: gem.id, reason: 'leaked' })
  const revoked = await keys.findOne({ _id: gem.id })
  assert.deepEqual([revoked.status, revoked.cipher], ['revoked', undefined])
  const again = await importSettingsKeys({ settings, keys: store, catalog, log: quiet })
  assert.deepEqual(again.revoked.map((r) => r.provider), ['gemini'])
  assert.equal(await keys.countDocuments({ provider: 'gemini', kind: 'key' }), 1)
  assert.match((await store.keyFor('gemini')).error, /no active key/)
})
