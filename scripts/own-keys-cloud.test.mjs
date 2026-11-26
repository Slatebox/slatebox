// Own AI and call keys on Slatebox Cloud (owner, 2026-11-26, replacing the 2026-11-22 rule "own keys
// are for self-hosted Slatebox"): "users can bring their own keys and put them in the backend so
// that they can bind to whatever model they want. They don't have to activate if they self-host,
// but this is all option for the cloud."
//
// Restated whole on 2026-11-26: every test here used to assert that Cloud refuses, hides and never
// routes to an own key. They now assert the new decision:
//   - people and teams may add their own connections and keys on Cloud, and bind any feature to
//     them; the order is the person's choice, then the team's, then Slatebox's; an administrator's
//     off switches (a part, all AI, own AI for everyone) still win;
//   - a request an own key serves spends no Slatebox credits and needs no Pro; a request on
//     Slatebox's models is metered as before, and nothing is served by Slatebox while counted as own;
//   - on Cloud an own connection is public https only, at save and at every request; private
//     endpoints stay a self-hosted choice; keys are sealed, never returned, logged or audited;
//     saves are rate-limited;
//   - the words: "Use your own key" on Cloud, optional and free to use; on self-host, the
//     administrator's or people's keys turn agent features on, and nothing about payments.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import * as ownKeys from '../web/app/imports/api/common/own-keys.mjs'
import { COPY, DEFAULT_METERING, OWN_KEY_COPY, copyFor, messageFor, resolveMetering, route } from '../web/app/server/metering/policy.mjs'
import { payRoute } from '../web/app/imports/api/billing/pay-route.mjs'
import { refusalPay } from '../web/app/server/metering/refusal-pay.mjs'
import { refusalAction } from '../web/app/imports/ui/components/billing/pay/pay-notice.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { agentFor, assertEndpointHost, endpointRules, guardedLookup } from '../web/app/server/methods/ai/endpoint-policy.mjs'
import { publicLookup } from '../web/app/server/common/safe-fetch.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { METER_RATE_LIMITS } from '../web/app/server/metering/limits.mjs'
import { chargeFixed, chargeProviderCall, installMeter, runAIAction } from '../web/app/server/metering/context.mjs'
import { meterWorld } from './fixtures/meter-world.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = (path) => read(`web/app/${path}`)
const NOW = Date.UTC(2026, 10, 26, 12)
// Slatebox Cloud's meter: Pro needed from now
const cloudMeter = (ownKeys) => resolveMetering({ deploy: { proRequiredFrom: 'now' }, ownKeys })
const person = { id: 'p1', anonymous: false, emailVerified: true }
const noPro = { ...person, included: false, pro: false }
const withPro = { ...person, included: true, pro: true }
const ask = (settings, over = {}) => route({ kind: 'ai', person: noPro, teamId: 't1', keys: {}, usage: {}, wallets: {}, global: {}, estimateMicros: 5000, settings, now: NOW, ...over })

// ---------- the one rule ----------

test('own-keys.mjs states one rule for every server: no Cloud refusal is left anywhere in the app', () => {
  assert.deepEqual(Object.keys(ownKeys).sort(), ['selfHosted'])
  assert.equal(ownKeys.selfHosted({ public: { env: 'selfhost' } }), true)
  for (const env of ['prod', 'test', 'dev', undefined, 'self-host', 'SELFHOST', '']) assert.equal(ownKeys.selfHosted({ public: { env } }), false, String(env))
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`
    if (['node_modules', '.meteor', 'generated'].includes(name)) return []
    return statSync(path).isDirectory() ? walk(path) : /\.(mjs|js|jsx|cjs)$/.test(name) ? [path] : []
  })
  const root = new URL('../web/app/', import.meta.url).pathname.replace(/\/$/, '')
  for (const file of [...walk(`${root}/server`), ...walk(`${root}/imports`)]) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /OWN_KEYS_CLOUD|ownKeysAllowed|'own-keys-cloud'/, file)
    assert.doesNotMatch(text, /own (AI|keys?|connections?)[^\n]{0,40}(is|are) (a )?self-hosted (feature|only)|for self-hosted Slatebox only/i, file)
  }
})

// ---------- the meter: own keys skip Slatebox credits, Slatebox's models stay metered ----------

test('on Cloud an own AI key pays first: no Pro needed, no Slatebox credits; a team key likewise; call keys too', () => {
  const on = cloudMeter(true)
  assert.equal(on.ownKeys, true)
  const mine = ask(on, { keys: { personal: { ai: true } } })
  assert.deepEqual([mine.ok, mine.route, mine.keyOwner], [true, 'byok', { type: 'user', id: 'p1' }])
  const team = ask(on, { keys: { team: { ai: true } } })
  assert.deepEqual([team.ok, team.route, team.keyOwner], [true, 'byok', { type: 'org', id: 't1' }])
  for (const kind of ['voice', 'video']) assert.equal(ask(on, { kind, keys: { personal: { daily: true } } }).route, 'byok', kind)
  // with Pro too, the own key serves and Pro credits are left alone
  assert.equal(ask(on, { person: withPro, keys: { personal: { ai: true } } }).route, 'byok')
  // an unconfirmed email still uses its own key
  assert.equal(ask(on, { person: { ...noPro, emailVerified: false }, keys: { personal: { ai: true } } }).route, 'byok')
})

test('still metered on Slatebox\'s models: no own key for this feature means Pro credits, a balance, or the Pro refusal', () => {
  const on = cloudMeter(true)
  assert.equal(ask(on, { person: withPro }).route, 'free')
  assert.equal(ask(on, { person: withPro, keys: { personal: { ai: false } } }).route, 'free', 'a key that does not serve this feature pays nothing')
  assert.equal(ask(on, { wallets: { personal: { balanceMicros: 1_000_000 } } }).route, 'balance')
  assert.equal(ask(on).code, 'pro')
  // an AI key never covers image search or image generation, which use Slatebox's own keys
  for (const kind of ['imageSearch', 'imageGeneration']) assert.equal(ask(on, { kind, keys: { personal: { ai: true } } }).code, 'pro-images', kind)
  // own keys off (no vault key, or an administrator turned own AI off): a saved key is never used
  for (const kind of ['ai', 'voice']) assert.notEqual(ask(cloudMeter(false), { kind, keys: { personal: { ai: true, daily: true } } }).route, 'byok', kind)
  // a stored meter setting cannot turn them on: the vault and the switch decide (meteor.js)
  assert.equal(resolveMetering({ stored: { ownKeys: true } }).ownKeys, false)
})

test('through the real meter: a request on an own key spends nothing of Slatebox\'s; one on Slatebox\'s model is counted', async () => {
  const settings = { ...structuredClone(DEFAULT_METERING), free: { ...DEFAULT_METERING.free, proRequiredFrom: 'now' }, ownKeys: true }
  const own = await meterWorld({ keys: { ai: true }, person: { included: false, pro: false }, settings })
  const answer = await runAIAction({ feature: 'workshop' }, async () => {
    await chargeProviderCall({ ref: 'own-1', provider: 'connection', model: 'm', usage: { inputTokens: 50_000, outputTokens: 50_000, totalTokens: 100_000 } })
    return 'drafted'
  })
  assert.equal(answer, 'drafted', 'no Pro needed')
  assert.deepEqual(own.spent(), { drafts: 0, todayMicros: 0, monthMicros: 0, heldDay: 0, heldMonth: 0 })
  assert.equal(own.paid(), 0, 'Slatebox paid nothing')
  assert.equal(own.global().monthFreeMicros, 0)
  const event = own.events.get('own-1')
  assert.deepEqual([event.route, event.chargeMicros ?? 0], ['byok', 0])
  installMeter(null)

  const served = await meterWorld({ keys: {}, person: { included: true, pro: true }, settings })
  await runAIAction({ feature: 'workshop' }, () => chargeProviderCall({ ref: 'sb-1', provider: 'connection', model: 'm', usage: { inputTokens: 1000, outputTokens: 1000, totalTokens: 2000 } }))
  assert.equal(served.events.get('sb-1').route, 'free')
  assert.ok(served.spent().monthMicros > 0, 'Pro credits are spent on Slatebox\'s model')
  assert.ok(served.paid() > 0)
  installMeter(null)

  // inside an own-key request, image search on Slatebox's key is its own metered use
  const mixed = await meterWorld({ keys: { ai: true }, person: { included: false, pro: false }, wallet: { balanceMicros: 5_000_000, refundableMicros: 5_000_000 }, settings })
  const out = await runAIAction({ feature: 'workshop' }, () => chargeFixed({ ref: 'img-1', kind: 'imageSearch', costMicros: 5000, model: 'search' }))
  assert.equal(out.route, 'balance')
  assert.ok(mixed.wallet().balanceMicros < 5_000_000)
  installMeter(null)
})

test('nothing is served by Slatebox\'s key while counted as own: the request, the meter and the image path agree', () => {
  const req = app('server/methods/ai/req.js')
  // a byok request goes only to the person's or team's own connection, else it stops
  assert.match(req, /\(ownKey && !chosen\?\.own\)/)
  assert.match(req, /failure: ownKey && !chosen\?\.own \? 'stop' : 'config'/)
  // an own connection's call is left uncharged only when it was really an own connection
  assert.match(req, /aiOpts\.unpaid = Boolean\(chosen\?\.own\)/)
  const meteor = app('server/metering/meteor.js')
  // the meter counts an AI key only when the person's own choice serves this feature
  assert.match(meteor, /const ai = aiScope === \(ownerType === 'user' \? 'me' : 'team'\)/)
  assert.match(meteor, /return choice\?\.own && !choice\.error \? choice\.scope : null/)
  const credentials = meteor.slice(meteor.indexOf('export async function credentialsFor'), meteor.indexOf('// ---------- writes'))
  assert.match(credentials, /if \(choice\?\.own && !choice\.error\) return \{ provider: 'connection', ref: choice\.ref \}/)
  assert.match(credentials, /throw new Meteor\.Error\('own-key'/)
  // own keys are on with the vault and the administrator's switch, read with the meter's settings
  assert.match(meteor, /const VAULT = Boolean\(master\)/)
  assert.match(meteor, /return server\?\.ownProviders === true/)
  assert.match(meteor, /resolveMetering\(\{ stored, deploy: Meteor\.settings\.metering, ownKeys: await ownKeysOn\(\) \}\)/)
  assert.match(app('server/methods/stabilityai.js'), /return chosen\.own \? viaConnection\(\) : runAIAction/)
})

// ---------- AI settings on Cloud ----------

function memoryStore() {
  const keys = [], uses = new Map()
  const match = (owner) => (doc) => doc.ownerType === owner.type && doc.ownerId === owner.id
  return {
    keys,
    async listConnections(owner) { return keys.filter(match(owner)).map((doc) => ({ ...doc })) },
    async saveConnection(owner, doc) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === doc.name)
      if (i >= 0) keys[i] = { ...doc, ownerType: owner.type, ownerId: owner.id }
      else keys.push({ ...doc, ownerType: owner.type, ownerId: owner.id })
    },
    async removeConnection(owner, name) {
      const i = keys.findIndex((k) => match(owner)(k) && k.name === name)
      if (i >= 0) keys.splice(i, 1)
    },
    async getUse(owner) { return uses.get(`${owner.type}:${owner.id}`) || { use: {} } },
    async setUse(owner, value) { uses.set(`${owner.type}:${owner.id}`, value) },
  }
}

const resolveTo = (address) => (host, options, callback) => callback(null, [{ address, family: address.includes(':') ? 6 : 4 }])

function cloud({ settings = { public: { env: 'prod' } }, resolve = resolveTo('93.184.216.34'), saveLimit, audit } = {}) {
  const store = memoryStore()
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const people = { ana: { _id: 'ana', orgId: 'team1' }, bo: { _id: 'bo', orgId: 'team1' }, root: { _id: 'root' } }
  const ai = createAISettings({
    store, master, hosted: true, settings,
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user._id === 'ana',
    check: async () => ({ ok: true, reachable: true, models: [], tools: 'yes', message: 'ok' }),
    assertHost: (baseUrl, rules) => assertEndpointHost(baseUrl, rules, resolve),
    ...(saveLimit && { saveLimit }),
    ...(audit && { audit }),
  })
  return { ai, store }
}

const desk = { name: 'desk', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm', apiKey: 'desk-key-0123456789abcdef' }

test('a call on someone\'s own call key never falls back to Slatebox\'s key: no key, no request, the call ends', () => {
  const meteor = app('server/metering/meteor.js')
  assert.match(meteor, /if \(call\.provider === 'own-key' && !ownKey\) throw new Meteor\.Error\('huddle-unavailable'/)
  assert.match(meteor, /call\.provider === 'own-key' \? ownKey : Meteor\.settings\.daily\?\.apiKey/)
  assert.doesNotMatch(meteor, /ownKey \|\| Meteor\.settings\.daily/)
  assert.match(meteor, /endedReason: 'own-key-removed'/)
  const daily = app('server/methods/daily.js')
  assert.match(daily, /if \(call\.provider === 'own-key' && !ownKey\) \{\n\s+await endOpenCall\(call, \{ reason: 'left'/)
})

test('on Cloud a person and a team add their own connections and bind features to them: the person\'s, then the team\'s, then Slatebox\'s', async () => {
  const { ai, store } = cloud()
  await ai.update('ana', { level: 'team', connections: [{ ...desk, name: 'shared', apiKey: 'team-key-0123456789abcdef' }], use: { default: 'team:shared' } })
  assert.equal((await ai.resolveFor({ userId: 'bo', feature: 'workshop' })).ref, 'team:shared', 'a member without a choice uses the team\'s')
  await ai.update('ana', { level: 'me', connections: [desk], use: { shape: 'me:desk', chat: 'me:desk' } })
  const shape = await ai.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.deepEqual([shape.ref, shape.own, shape.connection.apiKey], ['me:desk', true, desk.apiKey])
  assert.equal(shape.rules.publicOnly, true)
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'generation' })).ref, 'team:shared', 'what she did not choose follows her team')
  // Test connection works on Cloud too
  assert.equal((await ai.check('ana', { level: 'me', name: 'desk' })).ok, true)
  const view = await ai.view('ana')
  assert.deepEqual([view.hosted, view.ownProviders, view.server.ownProvidersLocked], [true, true, false])
  assert.deepEqual(view.mine.connections.map((c) => c.name), ['desk'])
  assert.equal(view.effective.chat.own, true)
  assert.equal(store.keys.length, 2)
})

test('admin off still wins on Cloud: a part turned off, all AI off, and own AI off for everyone', async () => {
  const { aiControlWorld } = await import('./ai-control-kit.mjs')
  const { createAdminOps } = await import('../web/app/server/ai-control/admin.mjs')
  const w = await aiControlWorld({ settings: { public: { env: 'prod' } }, hosted: true })
  await w.choices.insertOne({ _id: 'user:ana', use: { chat: 'me:desk', shape: 'me:desk' } })
  await w.keys.insertOne({ _id: 'own1', ownerType: 'user', ownerId: 'ana', name: 'desk', provider: 'openai-compatible', baseUrl: 'https://desk.example.org/v1', model: 'own-model', capabilities: { tools: true }, cipher: null, last4: '' })
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })).own, true)
  await w.bindings.set({ actor: w.actor, changes: [{ surface: 'chat', use: 'off' }] })
  const off = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.deepEqual([off.disabled, off.own, off.connection], [true, false, null])
  assert.equal((await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })).own, true, 'a part still on keeps her own choice')
  // the AI tab says so too: a part turned off is not shown on her own key
  const shown = await w.aiSettings.view('ana')
  assert.deepEqual([shown.effective.chat.own, shown.effective.chat.scope], [false, 'builtin'])
  assert.equal(shown.effective.shape.own, true)
  const ops = createAdminOps({ store: w.store, audit: w.raw.audit, bindings: w.bindings })
  await ops.setGlobal({ actor: w.actor, aiEnabled: false, message: 'AI is off today.', reason: 'test' })
  await w.holder.refresh({ force: true })
  const all = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.deepEqual([all.disabled, all.own], [true, false])

  // the administrator's switch for own AI, in the app and in the settings file
  const { ai } = cloud()
  await ai.update('ana', { level: 'me', connections: [desk], use: { default: 'me:desk' } })
  await ai.update('root', { level: 'server', ownProviders: 'off' })
  assert.equal((await ai.resolveFor({ userId: 'ana', feature: 'workshop' })).own, false)
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ ...desk, name: 'other' }] }), { code: 'forbidden' })
  // Test connection is refused too: no request leaves Slatebox for an endpoint while own AI is off
  await assert.rejects(ai.check('ana', { level: 'me', name: 'desk' }), { code: 'forbidden' })
  await assert.rejects(ai.check('ana', { level: 'me', connection: { ...desk, name: 'new' } }), { code: 'forbidden' })
  const locked = cloud({ settings: { public: { env: 'prod' }, ai: { ownProviders: 'off' } } })
  assert.equal((await locked.ai.view('ana')).ownProviders, false)
  await locked.ai.update('root', { level: 'server', ownProviders: 'on' })
  assert.equal((await locked.ai.view('ana')).ownProviders, false, 'the settings file has the last word')
})

test('Cloud refuses private, loopback, link-local and metadata addresses when saved, also behind a public name', async () => {
  const { ai, store } = cloud()
  for (const baseUrl of [
    'http://llm.example.com/v1', 'https://10.0.0.5/v1', 'https://192.168.1.20/v1', 'https://172.16.0.1/v1', 'https://127.0.0.1/v1', 'https://localhost/v1',
    'https://[::1]/v1', 'https://169.254.169.254/latest', 'https://168.63.129.16/v1', 'https://[::ffff:168.63.129.16]/v1', 'https://metadata.google.internal/v1',
    'https://mongo.default.svc.cluster.local/v1', 'https://redis/v1', 'https://[fd00:ec2::254]/v1', 'https://100.100.100.200/v1',
  ]) {
    await assert.rejects(ai.update('ana', { level: 'me', connections: [{ ...desk, baseUrl }] }), { code: 'invalid_request' }, baseUrl)
    await assert.rejects(ai.check('ana', { level: 'me', connection: { ...desk, baseUrl } }), { code: 'invalid_request' }, baseUrl)
  }
  // a public name that resolves inside (DNS rebinding at save)
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '168.63.129.16', '::1', 'fd00::1']) {
    const rebinding = cloud({ resolve: resolveTo(address) })
    await assert.rejects(rebinding.ai.update('ana', { level: 'me', connections: [desk] }), { code: 'invalid_request' }, address)
  }
  assert.equal(store.keys.length, 0)
  // private endpoints are a self-hosted operator's choice: on Cloud the switch changes nothing
  const asked = cloud({ settings: { public: { env: 'prod' }, ai: { privateEndpoints: 'on' } } })
  await assert.rejects(asked.ai.update('ana', { level: 'me', connections: [{ ...desk, baseUrl: 'http://192.168.1.20/v1' }] }), { code: 'invalid_request' })
  assert.deepEqual([...endpointRules({ hosted: true, level: 'person', privateEndpoints: true }).allow], ['public'])
  assert.deepEqual([...endpointRules({ hosted: true, level: 'team', privateEndpoints: true }).allow], ['public'])
})

test('Cloud refuses private addresses at every request too: the lookup the connection itself uses', async () => {
  const rules = endpointRules({ hosted: true, level: 'person' })
  const lookupFails = (lookup, host) => new Promise((resolve) => lookup(host, { all: true }, (error) => resolve(Boolean(error))))
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '168.63.129.16', '::ffff:10.0.0.1', '::1', 'fe80::1', 'fd00:ec2::254', '64:ff9b::a9fe:a9fe',
    // the old site-local range, and metadata at the /48 position of the local-use NAT64 network
    'fec0::1', '64:ff9b:1:a9fe:a9:fe00::']) {
    assert.equal(await lookupFails(guardedLookup(rules, resolveTo(address)), 'llm.example.com'), true, address)
    assert.equal(await lookupFails(publicLookup(resolveTo(address)), 'llm.example.com'), true, address)
  }
  assert.equal(await lookupFails(publicLookup(resolveTo('93.184.216.34')), 'llm.example.com'), false)
  // the request's agent on Cloud is the public-only one, with its own lookup
  const agent = agentFor('https://llm.example.com/v1', rules)
  assert.equal(typeof agent.options.lookup, 'function')
  // and a connection saved before whose address no longer passes is not used
  const { ai, store } = cloud()
  store.keys.push({ ownerType: 'user', ownerId: 'ana', name: 'old', provider: 'openai-compatible', baseUrl: 'http://10.0.0.5/v1', model: 'm', capabilities: {}, cipher: null, last4: '' })
  await ai.update('ana', { level: 'me', use: { chat: 'me:old' } })
  const resolved = await ai.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.match(resolved.error, /cannot be used/)
})

test('a provider of the server\'s that takes no key is never a person\'s own connection (it would be Slatebox\'s, counted as theirs)', async () => {
  const { aiControlWorld } = await import('./ai-control-kit.mjs')
  const w = await aiControlWorld({ settings: { public: { env: 'prod' } }, hosted: true })
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'other', id: 'box', label: 'Our box', baseUrl: 'https://box.example.com/v1', auth: { style: 'none' } } })
  await w.holder.refresh({ force: true })
  await assert.rejects(w.aiSettings.update('ana', { level: 'me', connections: [{ name: 'free', type: 'box', model: 'm' }] }), (error) => error.code === 'invalid_request' && /this server's own models/.test(error.message))
  // one written before is not used
  await w.keys.insertOne({ _id: 'own2', ownerType: 'user', ownerId: 'ana', name: 'free', provider: 'box', baseUrl: 'https://box.example.com/v1', model: 'm', capabilities: {}, cipher: null, last4: '' })
  await w.choices.insertOne({ _id: 'user:ana', use: { chat: 'me:free' } })
  const resolved = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.match(resolved.error, /this server's own models/)
})

test('keys stay sealed: never returned, never in the audit trail, never in the log', async () => {
  const audited = []
  const lines = []
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
  for (const name of Object.keys(original)) console[name] = (...args) => lines.push(args.map(String).join(' '))
  try {
    const { ai, store } = cloud({ audit: async (entry) => { audited.push(entry) } })
    await ai.update('ana', { level: 'me', connections: [desk], use: { chat: 'me:desk' } })
    await ai.update('ana', { level: 'team', connections: [{ ...desk, name: 'shared' }] })
    await ai.check('ana', { level: 'me', name: 'desk' })
    await ai.resolveFor({ userId: 'ana', feature: 'chat' })
    assert.doesNotMatch(JSON.stringify(store.keys), new RegExp(desk.apiKey))
    assert.doesNotMatch(JSON.stringify(await ai.view('ana')), new RegExp(desk.apiKey))
    assert.equal(audited.length, 2)
    assert.doesNotMatch(JSON.stringify(audited), new RegExp(desk.apiKey))
    assert.match(JSON.stringify(audited), /keyFingerprint/)
  } finally {
    Object.assign(console, original)
  }
  assert.doesNotMatch(lines.join('\n'), new RegExp(desk.apiKey))
  // keys.save and keys.list return the last four only (vault.mjs describeKey), and its audit row has no key
  const meteor = app('server/metering/meteor.js')
  const save = meteor.slice(meteor.indexOf("async 'keys.save'"), meteor.indexOf("async 'keys.remove'"))
  assert.match(save, /Audit\.insertAsync\(\{ type: 'own-key-saved', userId: user\._id, ownerType: owner\.ownerType, ownerId: owner\.ownerId, provider: input\.provider, created: now \}\)/)
  assert.match(save, /return describeKey\(doc\)/)
})

test('saving keys is rate-limited: the AI settings per person, keys.save per person and per address', async () => {
  const { ai } = cloud({ saveLimit: { count: 2, windowMs: 60_000 } })
  await ai.update('ana', { level: 'me', connections: [desk] })
  await ai.update('ana', { level: 'me', connections: [{ ...desk, name: 'two' }] })
  await assert.rejects(ai.update('ana', { level: 'me', connections: [{ ...desk, name: 'three' }] }), { code: 'rate_limited' })
  // choosing without saving a connection is not a key save
  await ai.update('ana', { level: 'me', use: { chat: 'me:desk' } })
  const rules = METER_RATE_LIMITS.filter((r) => r.method === 'keys.save')
  assert.deepEqual(rules.map((r) => r.per).sort(), ['address', 'user'])
  for (const rule of rules) assert.ok(rule.count <= 20 && rule.intervalMs >= 60_000, rule.per)
})

test('keys.* on Cloud: saved and listed where the vault and the administrator allow, never refused for being Cloud', () => {
  const meteor = app('server/metering/meteor.js')
  const save = meteor.slice(meteor.indexOf("async 'keys.save'"), meteor.indexOf("async 'keys.remove'"))
  assert.match(save, /if \(!VAULT\) throw new Meteor\.Error\('unavailable', NOT_AVAILABLE\)/)
  assert.match(save, /if \(!await ownKeysAvailable\(\)\) throw new Meteor\.Error\('own-keys-off', OWN_KEYS_OFF\)/)
  assert.ok(save.indexOf('ownKeysAvailable()') < save.indexOf('keyDocument('), 'refused before the key is sealed')
  // a person's endpoint: public https only, and its name must not resolve to a private address
  assert.match(save, /checkOwnEndpoint\(/)
  assert.match(save, /assertPublicHost\(/)
  assert.match(meteor, /Meteor\.settings\.public\.ownKeys = VAULT/)
  assert.match(meteor, /ownKeysAvailable: settings\.ownKeys,/)
})

// ---------- the pay sheet ----------

test('the pay sheet offers an own key where own keys are on and no payments are taken; never where they are off', () => {
  const summary = { emailVerified: true, proState: null, proAvailable: false, topUpsAvailable: false }
  assert.deepEqual(payRoute({ code: 'ai-today', summary: { ...summary, ownKeysAvailable: true } }), { action: 'own-key', wallet: null })
  assert.deepEqual(payRoute({ code: 'ai-today', summary }), { action: 'help', wallet: null })
  // Cloud with payments: Pro or a top-up, as before
  assert.deepEqual(payRoute({ code: 'pro', summary: { ...summary, proAvailable: true, topUpsAvailable: true, ownKeysAvailable: true } }), { action: 'pro', wallet: null })
  const verified = { _id: 'u', emails: [{ verified: true }] }
  assert.deepEqual(refusalPay({ code: 'ai-today', user: verified, flags: { proAvailable: false, topUpsAvailable: false, ownKeysAvailable: true } }), { action: 'own-key', wallet: null })
  const refusal = { error: 'ai-today', reason: 'x', details: { pay: { action: 'own-key', wallet: null } } }
  assert.equal(refusalAction(refusal, { summary: { ...summary, topUpsAvailable: true }, ownKeys: true }).action, 'own-key')
  assert.equal(refusalAction(refusal, { summary: { ...summary, topUpsAvailable: true }, ownKeys: false }).action, 'topup', 'a server that cannot keep keys works it out again')
  // the pay sheet shows only where the meter runs, where payments are taken: its own-key words say top-ups are unavailable, not payments
  assert.match(app('imports/ui/components/billing/pay/BlockedPane.jsx'), /'own-key': 'Top-ups are not available right now\. Use your own AI or call key instead: requests on it spend no Slatebox credits\.'/)
  assert.doesNotMatch(app('imports/ui/components/billing/pay/BlockedPane.jsx'), /Payments are not taken/)
  // the browser reads the server's own answer, not which server it is
  for (const file of ['imports/ui/components/PayNotice.jsx', 'imports/ui/components/billing/pay/BlockedPane.jsx']) {
    assert.match(app(file), /Meteor\.settings\.public\.ownKeys/, file)
  }
})

test('the meter\'s words name own keys where they are on, Cloud included', () => {
  const on = cloudMeter(true)
  assert.equal(copyFor(on), copyFor({ ownKeys: true }))
  assert.equal(messageFor('ai-today', null, on), OWN_KEY_COPY.aiToday)
  // Cloud's own-key words keep Pro and the balance, and never call the provider's AI free
  assert.match(messageFor('pro', null, on), /Get Pro or top up in your profile, or use your own AI key: it spends no Slatebox credits\./)
  assert.match(OWN_KEY_COPY.getProCalls, /or a balance, or use your own call key: it spends no Slatebox credits/)
  assert.match(OWN_KEY_COPY.unverified, /Your own key and your balance still work\./)
  for (const [name, text] of Object.entries(OWN_KEY_COPY)) assert.doesNotMatch(text, /which is free|for free/, name)
  assert.equal(messageFor('ai-today', null, cloudMeter(false)), COPY.aiToday)
})

// ---------- what people read ----------

const SELF_HOST_PAYMENT_WORDS = /credit|\bPro\b|top[- ]?up|balance|pay|charge|price|Stripe/i

test('the AI tab: "Use your own key" on Cloud and self-host; Cloud says optional, free to use, no credits spent; self-host says keys turn agent features on', () => {
  const ai = app('imports/ui/components/profile/AISettings.jsx')
  assert.doesNotMatch(ai, /!settings\.hosted &&/, 'nothing is hidden on Cloud')
  assert.match(ai, /title="Use your own key"/)
  assert.match(ai, /\{settings\.team && <Level/)
  const [cloudLine, selfLine] = [...ai.matchAll(/settings\.hosted\n\s+\? '((?:[^'\\]|\\.)*)'\n\s+: '((?:[^'\\]|\\.)*)'/g)][0].slice(1)
  assert.match(cloudLine, /Use your own key/)
  assert.match(cloudLine, /optional and free to use/)
  assert.match(cloudLine, /spend no Slatebox credits/)
  assert.match(cloudLine, /public https/)
  assert.match(selfLine, /Agent features run on the models this server\\'s administrator set up, or on your own/)
  // the invitation shows only where own connections can be added; turned off and a guest read different words
  assert.match(ai, /\{settings\.mine \? \(\n\s+<FinePrint>/)
  assert.match(ai, /Sign in to use your own connections\./)
  // on Cloud the address type promises only public https
  assert.match(ai, /hostedLabel: 'Other \(OpenAI-compatible\): any public https host'/)
  assert.match(ai, /title="Your team's own key"/)
  assert.match(ai, /'People may use their own AI and call keys'/)
  assert.doesNotMatch(selfLine, SELF_HOST_PAYMENT_WORDS)
  // the effective line: on self-host it says nothing of credits
  assert.match(ai, /const ownTag = settings\.hosted \? ' \(your own key, no Slatebox credits\)' : ' \(your own key\)'/)
  // an administrator's switch for own AI shows on Cloud too
  assert.match(ai, /<FormControlLabel\n\s+control=\{<Switch checked=\{settings\.ownProviders\}/)
})

test('team settings: the team\'s own key is an option on Cloud; self-host words say keys turn agent features on and nothing about payments', () => {
  const team = app('imports/ui/pages/TeamSettings.jsx')
  assert.doesNotMatch(team, /There is nothing to connect here/)
  const [cloudLine, selfLine] = [...team.matchAll(/settings\.hosted\n\s+\? `([^`]*)`\n\s+: `([^`]*)`/g)][0].slice(1)
  assert.match(cloudLine, /^Use the \$\{noun\}'s own key/)
  assert.match(cloudLine, /optional and free to use/)
  assert.match(cloudLine, /spend no Slatebox credits/)
  assert.match(selfLine, /Agent features run on the models this server's administrator set up, or on the \$\{noun\}'s own/)
  assert.doesNotMatch(selfLine, SELF_HOST_PAYMENT_WORDS)
  // the keys section shows only where the meter says own keys are on, so the card's title does not promise it
  assert.match(team, /<Card title="Team balance" icon=\{CreditCardOutlined\}>/)
  assert.doesNotMatch(team, /Team balance and keys/)
  const balance = app('imports/ui/components/billing/TeamBalance.jsx')
  assert.match(balance, /\{summary\.ownKeysAvailable && \(\n\s+<AccountSection title="Use the team's own key">/)
  assert.match(balance, /Team keys are optional and free to use\. A request one of them serves spends no Slatebox credits, with or without Pro/)
  // the older keys panel says the same as the AI tab and points at it for per-feature choices
  const own = app('imports/ui/components/billing/OwnKeys.jsx')
  assert.match(own, /Optional and free to use: requests on your own key spend no Slatebox credits\./)
  assert.doesNotMatch(own, /we charge nothing/)
})

test('Credits: "Use your own key" where own keys are on, and its words say no Slatebox credits are spent', () => {
  const credits = app('imports/ui/components/billing/Credits.jsx')
  assert.match(credits, /\{summary\.ownKeysAvailable && \(\n\s+<AccountSection title="Use your own key">/)
  assert.match(credits, /Or use your own AI and call keys: optional, free to use, and they spend no Slatebox credits\./)
  assert.doesNotMatch(credits, /always free/)
})

test('docs, the API and exec words: own keys are an option on Cloud, not a self-hosted feature', () => {
  for (const path of ['README.md', 'packages/slatebox-mcp/README.md']) {
    const readme = read(path)
    assert.match(readme, /On Slatebox Cloud, agent features come with Slatebox Pro, or use your own AI key and spend no Slatebox credits; on a self-hosted Slatebox, the administrator's keys or your own turn them on\./, path)
    assert.doesNotMatch(readme, /a self-hosted Slatebox can use its own AI key/, path)
  }
  const web = read('web/README.md')
  assert.doesNotMatch(web, /Cloud takes no own keys|Own AI and call keys are a self-hosted feature/)
  assert.match(web, /People and teams may add their own AI connections and keys on Cloud and self-hosted alike/)
  const metering = app('server/metering/README.md')
  assert.match(metering, /Own AI and call keys work on Slatebox Cloud as on a self-hosted Slatebox/)
  const selfHost = read('self-host/README.md')
  assert.match(selfHost, /Agent features turn on with the models you connect here, or with\npeople's own/)
  const integrations = read('docs/integrations.md')
  assert.match(integrations, /or on your own key, which spends no Slatebox credits/)
  const example = JSON.parse(app('settings.example.json'))
  assert.equal(example.ai.ownProviders, 'on')
  assert.match(example.ai['//'], /optional on Slatebox Cloud, where a request they serve spends no Slatebox credits/)
  for (const file of ['server/actions/generated/exec-tool.json', 'server/actions/generated/contract.json', 'server/actions/generated/openapi.json']) {
    const text = app(file)
    assert.doesNotMatch(text, /self-hosted Slatebox: Slatebox Cloud refuses it|on a self-hosted server: (adds|whether)|own AI on a self-hosted server/, file)
  }
  assert.match(app('server/actions/generated/exec-tool.json'), /Own AI is optional, on Slatebox Cloud and self-hosted alike\. On Slatebox Cloud requests it serves spend no Slatebox credits/)
  assert.match(app('server/actions/generated/exec-tool.json'), /On Slatebox Cloud an address must be public https; on a self-hosted Slatebox a model on the host is at host\.docker\.internal/)
})
