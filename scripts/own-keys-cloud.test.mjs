// Own AI and call keys are a self-hosted feature (owner, 2026-11-22). On Slatebox Cloud
// (app.slatebox.com, test.slatebox.com) AI and calls come with Slatebox Pro credits and top-ups:
// nothing offers, saves, tests or uses a person's or team's own key, and no Cloud-facing words say
// own keys are free. The rule is about which server this is (public.env), never about the person.
// A self-hosted Slatebox keeps all of it unchanged.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { OWN_KEYS_CLOUD, ownKeysAllowed, selfHosted } from '../web/app/imports/api/common/own-keys.mjs'
import { COPY, DEFAULT_METERING, OWN_KEY_COPY, allowanceSummary, copyFor, messageFor, resolveMetering, route } from '../web/app/server/metering/policy.mjs'
import { payRoute } from '../web/app/imports/api/billing/pay-route.mjs'
import { refusalPay } from '../web/app/server/metering/refusal-pay.mjs'
import { refusalAction } from '../web/app/imports/ui/components/billing/pay/pay-notice.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const app = (path) => read(`web/app/${path}`)
const NOW = Date.UTC(2026, 10, 22, 12)
// words that offer or praise an own key
const OWN_WORDS = /own (AI|key|keys|Daily key)|Daily key|AI key|connect your own|bring your own/i

// ---------- the one signal ----------

test('own keys are allowed only where public.env is selfhost; every other env is Slatebox Cloud', () => {
  assert.equal(ownKeysAllowed({ public: { env: 'selfhost' } }), true)
  assert.equal(selfHosted({ public: { env: 'selfhost' } }), true)
  for (const env of ['prod', 'test', 'dev', undefined, 'self-host', 'SELFHOST', '']) {
    assert.equal(ownKeysAllowed({ public: { env } }), false, String(env))
  }
  assert.equal(ownKeysAllowed(undefined), false)
  assert.equal(ownKeysAllowed({}), false)
  assert.match(OWN_KEYS_CLOUD, /self-hosted Slatebox/)
  assert.match(OWN_KEYS_CLOUD, /Slatebox Pro credits and top-ups/)
})

test('every server-side and browser surface reads the same signal (own-keys.mjs), not a per-person check', () => {
  assert.match(app('server/metering/meteor.js'), /const OWN_KEYS = ownKeysAllowed\(Meteor\.settings\)/)
  assert.match(app('server/methods/ai/ai-settings.js'), /export const hosted = !selfHosted\(Meteor\.settings\)/)
  for (const file of ['imports/ui/pages/TeamSettings.jsx', 'imports/ui/components/PayNotice.jsx', 'imports/ui/components/billing/pay/BlockedPane.jsx']) {
    assert.match(app(file), /ownKeysAllowed\(Meteor\.settings\)/, file)
  }
})

// ---------- the meter ----------

const person = { id: 'p1', anonymous: false, emailVerified: true }
const allKeys = { personal: { ai: true, daily: true }, team: { ai: true, daily: true } }
// on Cloud without Pro the month's amount is not theirs (meteor.js personOf: proIncluded)
const noPro = { ...person, included: false }
const ask = (settings, over = {}) => route({ kind: 'ai', person, teamId: 't1', keys: allKeys, usage: {}, wallets: {}, global: {}, estimateMicros: 5000, settings, now: NOW, ...over })

test('the meter is Cloud unless told it is self-hosted, and a stored setting cannot turn own keys on', () => {
  assert.equal(resolveMetering().ownKeys, false)
  assert.equal(resolveMetering({ deploy: { proRequiredFrom: 'now' } }).ownKeys, false)
  assert.equal(resolveMetering({ stored: { ownKeys: true } }).ownKeys, false)
  assert.equal(resolveMetering({ ownKeys: true }).ownKeys, true)
})

test('Slatebox Cloud never routes to an own key saved before; a self-hosted meter still does', () => {
  const cloud = resolveMetering({ deploy: { proRequiredFrom: 'now' } })
  const selfHost = resolveMetering({ ownKeys: true })
  for (const kind of ['ai', 'voice', 'video']) {
    const r = ask(cloud, { kind, person: noPro })
    assert.deepEqual([r.ok, r.route], [false, undefined], kind)
    assert.notEqual(r.route, 'byok', kind)
    assert.equal(r.keyOwner, undefined, kind)
    assert.equal(ask(selfHost, { kind }).route, 'byok', kind)
  }
  // with the included amount (Cloud before the switch, or Pro) Slatebox pays, never the saved key
  const included = resolveMetering()
  assert.equal(ask(included).route, 'free')
  assert.equal(ask(cloud, { person: { ...person, included: true, pro: true } }).route, 'free')
})

test('Cloud\'s refusals never offer an own key; a self-hosted meter keeps its words', () => {
  for (const [name, text] of Object.entries(COPY)) assert.doesNotMatch(text, OWN_WORDS, name)
  for (const name of Object.keys(OWN_KEY_COPY)) assert.ok(name in COPY, `${name} has Cloud words too`)
  assert.match(OWN_KEY_COPY.getPro, /connect your own AI, which is free/)
  const cloud = resolveMetering({ deploy: { proRequiredFrom: 'now' } })
  const selfHost = resolveMetering({ ownKeys: true })
  const codes = ['unverified', 'ai-today', 'ai-month', 'ai-paused', 'calls-today', 'calls-month', 'calls-paused', 'video-stage', 'free-stopped', 'pro', 'pro-calls', 'pro-images', 'pro-past-due', 'balance', 'frozen']
  for (const code of codes) {
    for (const who of [null, { pro: true }]) assert.doesNotMatch(messageFor(code, who, cloud), OWN_WORDS, code)
  }
  assert.equal(messageFor('ai-today', null, selfHost), OWN_KEY_COPY.aiToday)
  assert.equal(messageFor('ai-today', { pro: true }, selfHost), OWN_KEY_COPY.proAiToday)
  assert.equal(copyFor(cloud), COPY)
  // the refusals route() gives on Cloud, with and without Pro
  const refusals = [
    ask(cloud, { keys: {}, person: noPro }),
    ask(cloud, { keys: {}, person: noPro, kind: 'voice' }),
    ask(cloud, { keys: {}, person: noPro, kind: 'imageSearch' }),
    ask(cloud, { keys: {}, person: { ...person, included: false, proPastDue: true } }),
    ask(cloud, { keys: {}, person: { ...person, included: true, pro: true }, usage: { aiActionsToday: 30 } }),
    ask(resolveMetering(), { keys: {}, usage: { aiActionsToday: 30 } }),
    ask(resolveMetering(), { keys: {}, person: { ...person, emailVerified: false } }),
  ]
  for (const r of refusals) {
    assert.equal(r.ok, false)
    assert.doesNotMatch(r.message, OWN_WORDS, r.code)
  }
})

test('the Credits summary\'s paused-stage note leaves own keys out on Cloud', () => {
  const settings = resolveMetering()
  const global = { monthFreeMicros: settings.budget.monthlyMicros * 1.2, todayFreeMicros: 0 }
  const cloud = allowanceSummary({ person: { ...person, included: true }, global, settings, now: NOW })
  assert.equal(cloud.stageNote, COPY.stagePaused)
  assert.doesNotMatch(cloud.stageNote, OWN_WORDS)
  const own = allowanceSummary({ person: { ...person, included: true }, global, settings: { ...settings, ownKeys: true }, now: NOW })
  assert.equal(own.stageNote, OWN_KEY_COPY.stagePaused)
  assert.deepEqual(DEFAULT_METERING.ownKeys, undefined, 'the defaults carry no own-key switch')
})

// ---------- the pay sheet ----------

test('on Cloud the pay sheet never answers own-key: without top-ups it is Pro or help', () => {
  const cloud = { emailVerified: true, proState: null, proAvailable: true, topUpsAvailable: false }
  for (const code of ['ai-today', 'calls-month', 'balance', 'presentations-today']) {
    assert.deepEqual(payRoute({ code, summary: cloud }), { action: 'pro', wallet: null }, code)
    assert.deepEqual(payRoute({ code, summary: { ...cloud, proAvailable: false } }), { action: 'help', wallet: null }, code)
    assert.deepEqual(payRoute({ code, summary: { ...cloud, proState: { active: true } } }), { action: 'help', wallet: null }, code)
  }
  assert.deepEqual(payRoute({ code: 'pro-calls', summary: { ...cloud, proAvailable: false } }), { action: 'help', wallet: null })
  // a self-hosted server without payments still points at own keys
  assert.deepEqual(payRoute({ code: 'ai-today', summary: { ...cloud, ownKeysAvailable: true } }), { action: 'own-key', wallet: null })
  // the server's answer: own keys only when the server says so
  const verified = { _id: 'u', emails: [{ verified: true }] }
  assert.deepEqual(refusalPay({ code: 'ai-today', user: verified, flags: { proAvailable: false, topUpsAvailable: false } }), { action: 'help', wallet: null })
  assert.deepEqual(refusalPay({ code: 'ai-today', user: verified, flags: { proAvailable: false, topUpsAvailable: false, ownKeysAvailable: true } }), { action: 'own-key', wallet: null })
})

test('in the browser, an own-key answer from the wire is worked out again on Cloud', () => {
  const refusal = { error: 'ai-today', reason: 'x', details: { pay: { action: 'own-key', wallet: null } } }
  const summary = { emailVerified: true, proState: null, proAvailable: true, topUpsAvailable: true }
  assert.equal(refusalAction(refusal, { summary }).action, 'topup')
  assert.equal(refusalAction(refusal, { summary: { ...summary, topUpsAvailable: false } }).action, 'pro')
  assert.equal(refusalAction(refusal, { summary, ownKeys: true }).action, 'own-key')
  const blocked = app('imports/ui/components/billing/pay/BlockedPane.jsx')
  assert.match(blocked, /given\.kind === 'own-key' && !ownKeysAllowed\(Meteor\.settings\) \? \{ \.\.\.given, kind: 'help' \}/)
})

// ---------- AI settings ----------

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

// One database, read by a self-hosted server and by Slatebox Cloud: what was saved before the
// rule stays stored, and Cloud never uses it.
function servers() {
  const store = memoryStore()
  const master = loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
  const people = { ana: { _id: 'ana', orgId: 'team1' }, root: { _id: 'root' } }
  const make = (hosted) => createAISettings({
    store, master, hosted, settings: { public: { env: hosted ? 'prod' : 'selfhost' } },
    loadUser: async (id) => people[id] || null,
    isAdmin: async (id) => id === 'root',
    isTeamAdmin: async (user) => user._id === 'ana',
    check: async () => ({ ok: true, reachable: true, models: [], tools: 'yes', message: 'ok' }),
  })
  return { store, selfHost: make(false), cloud: make(true) }
}

const desk = { name: 'desk', type: 'openai-compatible', baseUrl: 'https://llm.example.com/v1', model: 'm', apiKey: 'desk-key-0123456789' }

test('Cloud refuses a person\'s or team\'s own AI with one sentence: save, choose, test, switch on', async () => {
  const { cloud, store } = servers()
  const refused = { code: 'forbidden', message: OWN_KEYS_CLOUD }
  await assert.rejects(cloud.update('ana', { level: 'me', connections: [desk] }), refused)
  await assert.rejects(cloud.update('ana', { level: 'me', connections: [{ ...desk, apiKey: undefined }] }), refused)
  await assert.rejects(cloud.update('ana', { level: 'team', connections: [desk] }), refused)
  await assert.rejects(cloud.update('ana', { level: 'me', use: { chat: 'builtin' } }), refused)
  await assert.rejects(cloud.check('ana', { level: 'me', connection: desk }), refused)
  await assert.rejects(cloud.check('ana', { level: 'team', connection: desk }), refused)
  await assert.rejects(cloud.update('root', { level: 'server', ownProviders: 'on' }), refused)
  assert.equal(store.keys.length, 0, 'nothing was saved')
  // the operator's own AI is not an own key: an administrator still sets Cloud's server AI
  await cloud.update('root', { level: 'server', connections: [desk], use: { chat: 'server:desk' } })
  assert.equal((await cloud.resolveFor({ userId: 'ana', feature: 'workshop' })).scope, 'server')
})

test('Cloud shows no own connections and never uses one saved before; self-host keeps using it; removing still works', async () => {
  const { cloud, selfHost, store } = servers()
  await selfHost.update('ana', { level: 'me', connections: [desk], use: { default: 'me:desk' } })
  await selfHost.update('ana', { level: 'team', connections: [{ ...desk, name: 'shared' }], use: { default: 'team:shared' } })
  assert.equal((await selfHost.resolveFor({ userId: 'ana', feature: 'workshop' })).own, true)

  const view = await cloud.view('ana')
  assert.equal(view.hosted, true)
  assert.equal(view.ownProviders, false)
  assert.equal(view.server.ownProvidersLocked, true)
  assert.equal(view.mine, null)
  assert.equal(view.team, null)
  assert.doesNotMatch(JSON.stringify(view), /desk|shared/)
  for (const feature of view.features) assert.equal(view.effective[feature.id].own, false, feature.id)
  const resolved = await cloud.resolveFor({ userId: 'ana', feature: 'workshop' })
  assert.equal(resolved.own, false)
  assert.notEqual(resolved.scope, 'me')
  assert.notEqual(resolved.scope, 'team')
  assert.equal(resolved.connection?.apiKey, undefined, 'no saved key is opened for a request')

  // the data stays (nothing is deleted by the rule), and its owner may still remove it
  assert.equal(store.keys.length, 2)
  await cloud.update('ana', { level: 'me', remove: ['desk'] })
  assert.equal(store.keys.length, 1)
})

// ---------- keys.* (own AI and Daily keys), source guards ----------

test('keys.save refuses on Cloud before anything is read or written; keys.list offers nothing; routing reads no key', () => {
  const meteor = app('server/metering/meteor.js')
  const save = meteor.slice(meteor.indexOf("async 'keys.save'"), meteor.indexOf("async 'keys.remove'"))
  assert.match(save, /if \(!OWN_KEYS\) throw new Meteor\.Error\('own-keys-cloud', OWN_KEYS_CLOUD\)/)
  assert.ok(save.indexOf('!OWN_KEYS') < save.indexOf('keyDocument('), 'refused before the key is sealed')
  const list = meteor.slice(meteor.indexOf("async 'keys.list'"), meteor.indexOf("async 'keys.save'"))
  assert.match(list, /!OWN_KEYS\) return \{ available: OWN_KEYS && Boolean\(master\)/)
  assert.match(meteor, /async function keyAvailability\(ownerType, ownerId, aiScope\) \{\n  if \(!ownerId \|\| !OWN_KEYS\) return \{\}/)
  assert.match(meteor, /if \(family === 'ai'\) \{\n    if \(!OWN_KEYS\) throw new Meteor\.Error\('own-key', OWN_KEYS_CLOUD\)/)
  assert.match(meteor, /Meteor\.settings\.public\.ownKeys = OWN_KEYS && Boolean\(master\)/)
  assert.match(meteor, /ownKeysAvailable: OWN_KEYS && Boolean\(master\),/)
  assert.match(meteor, /resolveMetering\(\{ stored, deploy: Meteor\.settings\.metering, ownKeys: OWN_KEYS \}\)/)
})

// ---------- what people see ----------

test('Credits, team settings and the AI tab show own keys only where the server allows them', () => {
  const credits = app('imports/ui/components/billing/Credits.jsx')
  assert.match(credits, /\{summary\.ownKeysAvailable && \(\n\s+<AccountSection title="Your own keys">/)
  const team = app('imports/ui/components/billing/TeamBalance.jsx')
  assert.match(team, /\{summary\.ownKeysAvailable && \(\n\s+<AccountSection title="Team keys">/)
  assert.match(app('imports/ui/pages/TeamSettings.jsx'), /ownKeysAllowed\(Meteor\.settings\) \? 'Team balance and keys' : 'Team balance'/)
  const ai = app('imports/ui/components/profile/AISettings.jsx')
  assert.match(ai, /\{!settings\.hosted && \(settings\.mine/)
  assert.match(ai, /\{!settings\.hosted && settings\.team && <Level/)
  assert.match(ai, /\{!settings\.hosted && \(\n\s+<FormControlLabel/)
  assert.match(ai, /settings\.hosted\n\s+\? 'On Slatebox Cloud, AI comes with Slatebox Pro credits and top-ups/)
})

// The words Cloud shows, with the self-hosted branch (and comments) taken out.
const cloudText = (source) => source
  .replace(/\/\/.*$/gm, '')
  .replace(/summary\.ownKeysAvailable\s*\?\s*'[^']*'/g, '')
  .replace(/settings\.hosted\s*\?\s*('[^']*')\s*:\s*'[^']*'/g, '$1')
  .replace(/ownKeysAllowed\(Meteor\.settings\) \? '[^']*'/g, '')

test('copy guards: no Cloud-facing words say own keys are free', () => {
  for (const file of [
    'imports/ui/components/billing/ProPanel.jsx', 'imports/ui/components/billing/Credits.jsx', 'imports/ui/components/billing/TeamBalance.jsx',
    'imports/ui/pages/TeamSettings.jsx', 'imports/ui/components/billing/billing-date.mjs',
  ]) {
    const text = cloudText(app(file))
    assert.doesNotMatch(text, /stay free without it|always free|own AI and call keys|own keys and your balance|own key and your balance/i, file)
  }
  assert.doesNotMatch(app('imports/ui/components/billing/ProPanel.jsx'), /own AI|own key/i)
  // the AI tab's Cloud line
  const ai = cloudText(app('imports/ui/components/profile/AISettings.jsx'))
  assert.doesNotMatch(ai.slice(ai.indexOf('<FinePrint>'), ai.indexOf('</FinePrint>')), /cost nothing|your key/)
})

test('copy guards: the exec, API and MCP words name own AI as self-hosted only, and the exec description stays short', () => {
  const exec = JSON.parse(app('server/actions/generated/exec-tool.json'))
  const text = JSON.stringify(exec)
  assert.doesNotMatch(text, /top-ups and own keys/)
  assert.match(text, /Own AI \(levels me and team\) is for self-hosted Slatebox: Slatebox Cloud refuses it/)
  for (const path of ['README.md', 'packages/slatebox-mcp/README.md']) {
    const readme = read(path)
    assert.doesNotMatch(readme, /so is AI on your own key|Your own AI and call keys are free/, path)
    assert.match(readme.split('\n')[2], /The canvas is free\. On Slatebox Cloud, AI comes with Slatebox Pro; a self-hosted Slatebox can use its own AI key\./, path)
  }
  const contract = app('server/actions/generated/contract.json')
  assert.doesNotMatch(contract, /top-ups and own keys/)
})

// Custom shapes are AI like any other feature: on Cloud they are paid by Pro credits and top-ups,
// never by a person's or team's own connection, even one chosen for shapes before.
test('Cloud draws shapes with the server\'s AI only; a self-hosted server still uses an own choice for shape', async () => {
  const { cloud, selfHost } = servers()
  await selfHost.update('ana', { level: 'me', connections: [desk], use: { shape: 'me:desk' } })
  const own = await selfHost.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.equal(own.ref, 'me:desk')
  assert.equal(own.own, true)
  const onCloud = await cloud.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.equal(onCloud.own, false)
  assert.notEqual(onCloud.scope, 'me')
  assert.notEqual(onCloud.scope, 'team')
  await assert.rejects(cloud.update('ana', { level: 'me', use: { shape: 'me:desk' } }), { code: 'forbidden', message: OWN_KEYS_CLOUD })
  // the operator may route Cloud's shapes to a server connection (as test and prod do with meta-muse)
  await cloud.update('root', { level: 'server', connections: [{ ...desk, name: 'meta-muse', toolChoice: 'auto' }], use: { shape: 'server:meta-muse' } })
  const served = await cloud.resolveFor({ userId: 'ana', feature: 'shape' })
  assert.equal(served.ref, 'server:meta-muse')
  assert.equal(served.own, false)
  assert.equal(served.connection.toolChoice, 'auto')
})
