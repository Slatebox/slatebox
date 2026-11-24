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
import { M1_INDEXES, runM1, runM2, M2_MARKER } from '../web/app/server/metering/migrations.mjs'
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
  // the server level may hold several of one type too
  await ai.update('root', { level: 'server', connections: [
    { name: 'one', type: 'openai-compatible', baseUrl: 'http://10.0.0.1/v1', model: 'a' },
    { name: 'two', type: 'openai-compatible', baseUrl: 'http://10.0.0.2/v1', model: 'b' },
  ] })
  assert.equal(await keys.countDocuments({ ownerType: 'server' }), 2)

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
  // a legacy key turned named: the unnamed document is replaced, not doubled
  await ai.update('ana', { level: 'me', connections: [{ name: 'deepinfra', type: 'deepinfra', apiKey: 'key-new-0123456789' }] })
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

// AI control S3: the fields a server connection gained (where its key lives, its fingerprint, the
// key a rotation replaced, on/off, its last test) against a real database, with the M1 indexes.
test('S3 connection fields round-trip in MongoDB: sealed and env keys, rotation grace, last test, services beside the models', { skip }, async (t) => {
  const db = await database(t)
  await db.collection('aiAudit').insertOne({ _id: 'x' })
  await runM1(migrationIo(db))
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const keys = db.collection('providerKeys')
  const store = createConnectionStore({ keys, choices: db.collection('aiChoices') })
  let clock = Date.parse('2026-11-24T10:00:00Z')
  const env = { SLATEBOX_AI_KEY_META: 'meta-env-key-1234' }
  const ai = createAISettings({
    store, master, settings: { public: { env: 'selfhost' } }, hosted: false, env, now: () => clock,
    loadUser: async (id) => people[id] || null, isAdmin: async (id) => id === 'root', isTeamAdmin: async () => false,
    check: async () => ({ ok: false, message: 'HTTP 401 for sk-proj-0000000000000000000000' }),
  })
  await ai.saveServerConnections('root', [
    { name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-proj-0000000000000000000000' },
    { name: 'meta', type: 'openai-compatible', baseUrl: 'https://api.meta.example/v1', model: 'muse-ember-1.0', keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_META' } },
    { name: 'search', type: 'google-cse', model: 'cx-1', apiKey: 'AIza-search-000000000000000000' },
  ])
  await ai.saveServerConnections('root', [{ name: 'oa', type: 'openai', model: 'gpt-x', apiKey: 'sk-proj-1111111111111111111111', rotate: { graceHours: 1 } }])
  const oa = await keys.findOne({ ownerType: 'server', name: 'oa' })
  assert.deepEqual([oa.keyRef, oa.keyFingerprint.startsWith('sha256:'), oa.previousCipher.until instanceof Date, oa.status], [{ kind: 'sealed' }, true, true, undefined])
  assert.deepEqual((await keys.findOne({ name: 'meta' })).keyRef, { kind: 'env', name: 'SLATEBOX_AI_KEY_META' })
  await ai.check('root', { level: 'server', name: 'oa' })
  const checked = await keys.findOne({ name: 'oa' })
  assert.equal(checked.lastCheck.ok, false)
  assert.ok(!checked.lastCheck.error.includes('sk-proj'))
  assert.equal((await ai.auxCredential('google-cse')).model, 'cx-1')
  const listed = await ai.serverConnections('root')
  assert.deepEqual(listed.connections.map((c) => [c.name, c.keyRef.kind]).sort(), [['meta', 'env'], ['oa', 'sealed'], ['search', 'sealed']])
  assert.equal(await store.clearExpiredGrace(new Date(clock)), 0)
  clock += 2 * 3600 * 1000
  assert.equal(await store.clearExpiredGrace(new Date(clock)), 1)
  assert.equal((await keys.findOne({ name: 'oa' })).previousCipher, null)
  // the unique (owner, name) index holds for the new kinds too
  await assert.rejects(keys.insertOne({ _id: randomUUID(), ownerType: 'server', ownerId: 'server', provider: 'deepgram', name: 'search' }), /E11000/)
})
