// ai-control-002, part 1: every model key still in the settings file (or the environment variable a
// settings entry names, or API_KEY_DEEP_INFRA) moves into the backend once, idempotently, and the
// app never reads a key from the settings file again. A revoked key never comes back; the backend's
// own key wins; a key that cannot be stored keeps answering from memory for this boot, with an
// alert. The log names the settings path and never the value. Fake keys throughout.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { aiControlWorld, allStrings } from './ai-control-kit.mjs'
import { importSettingsKeys, settingsKeySources } from '../web/app/server/migrations/ai-control-002.mjs'
import { keyFingerprint } from '../web/app/server/ai-control/keys.mjs'

const META = 'sk-test-meta-1111111111111111111111aaaa'
const OPENAI = 'sk-test-openai-22222222222222222222bbbb'
const ANTHROPIC = 'sk-ant-test-333333333333333333333cccc'
const STABILITY = 'sk-test-stab-44444444444444444444dddd'
const DEEPINFRA = 'test-deepinfra-5555555555555555eeee'
const LLAMA = 'LLM|test-llama-6666666666666666ffff'

// the shape of prod's settings (§0 of the plan), with fake keys
const prodSettings = () => ({
  public: { env: 'prod' },
  ai: {
    connections: { 'meta-muse': { type: 'openai-compatible', baseUrl: 'https://api.meta.ai/v1', model: 'muse-ember-1.0', apiKey: META, toolChoice: 'auto', capabilities: { tools: true } } },
    use: { presentation: 'meta-muse', generation: 'meta-muse', chat: 'meta-muse' },
    features: { layout: { provider: 'deepinfra', engine: 'Qwen/Qwen3-235B-A22B-Instruct-2507' } },
  },
  openai: { apiKey: OPENAI },
  anthropic: { apiKey: ANTHROPIC },
  stabilityai: { apiKey: STABILITY },
  nounProject: { key: 'noun-test-key', secret: 'noun-test-secret' },
  llama: { apiKey: LLAMA },
})
const ENV = { API_KEY_DEEP_INFRA: DEEPINFRA }

function logger() {
  const lines = []
  const log = { info: (text) => lines.push(text), warn: (text) => lines.push(text), error: (text) => lines.push(text) }
  return { lines, log }
}

async function run(w, settings = prodSettings(), env = ENV) {
  const { lines, log } = logger()
  const health = []
  const report = await importSettingsKeys({ settings, env, keys: w.keyStore, catalog: w.catalog, log, health: (entry) => health.push(entry) })
  return { report, lines, health }
}

test('the sources: the meta-muse inline key, OpenAI, Anthropic, Stability and the DeepInfra environment key; Noun Project is not a model key; the Llama key is skipped', () => {
  const { found, skipped } = settingsKeySources(prodSettings(), ENV)
  assert.deepEqual(found.map((f) => [f.path, f.provider, f.source]), [
    ['ai.connections.meta-muse.apiKey', 'meta', 'settings-import'],
    ['openai.apiKey', 'openai', 'settings-import'],
    ['anthropic.apiKey', 'anthropic', 'settings-import'],
    ['the environment variable API_KEY_DEEP_INFRA', 'deepinfra', 'env-import'],
    ['stabilityai.apiKey', 'stability', 'settings-import'],
  ])
  assert.deepEqual(skipped.map((s) => s.path), ['llama.apiKey'])
  // apiKeyEnv: the key is read from the variable the entry names
  const named = settingsKeySources({ ai: { connections: { gem: { type: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.8-flash', apiKeyEnv: 'GEMINI_KEY' } } } }, { GEMINI_KEY: 'AIza-test-77777777777777777777' })
  assert.deepEqual(named.found.map((f) => [f.provider, f.value]), [['gemini', 'AIza-test-77777777777777777777']])
  // an address no preset knows: an Other provider named like the connection
  const other = settingsKeySources({ ai: { connections: { local: { type: 'openai-compatible', baseUrl: 'https://models.example.org/v1/', model: 'm', apiKey: 'sk-test-local-88888888' } } } }, {})
  assert.deepEqual(other.found.map((f) => [f.provider, f.preset, f.baseUrl]), [['local', 'other', 'https://models.example.org/v1']])
})

test('first boot moves every model key into the backend as its provider\'s active key; the log names the path to remove and never the key', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  const { report, lines } = await run(w)
  assert.deepEqual(report.moved.map((m) => m.provider).sort(), ['anthropic', 'deepinfra', 'meta', 'openai', 'stability'])
  for (const provider of ['meta', 'openai', 'anthropic', 'deepinfra', 'stability']) {
    const active = await w.keyStore.activeOf(provider)
    assert.equal(active.status, 'active', provider)
  }
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, META)
  assert.equal((await w.keyStore.keyFor('deepinfra')).apiKey, DEEPINFRA)
  assert.equal((await w.keyStore.activeOf('deepinfra')).source, 'env-import')
  assert.equal((await w.keyStore.activeOf('meta')).source, 'settings-import')
  // providers made from presets: Meta (Muse) at api.meta.ai, not "OpenAI-compatible endpoint"
  assert.equal(w.snapshot().providers.meta.label, 'Meta (Muse)')
  assert.equal(w.snapshot().providers.meta.baseUrl, 'https://api.meta.ai/v1')
  assert.ok(lines.some((line) => line.includes(`moved the meta key (${keyFingerprint(META)}) from settings.ai.connections.meta-muse.apiKey into the backend; you can remove settings.ai.connections.meta-muse.apiKey now`)))
  assert.ok(lines.some((line) => line.includes('settings.llama.apiKey is not moved')))
  const everything = [lines, report, w.raw.audit.rows, w.control.get()]
  for (const key of [META, OPENAI, ANTHROPIC, STABILITY, DEEPINFRA, LLAMA]) assert.ok(!allStrings(everything).join('\n').includes(key), 'a key reached a log, a report or the audit trail')
  assert.ok(w.raw.audit.rows.some((row) => row.action === 'ai.keys.import' && row.actor.principal === 'system'))
})

test('a second boot changes nothing: the same documents, and the settings entries reported as removable', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  await run(w)
  const before = structuredClone(w.keys.rows)
  const { report, lines } = await run(w)
  assert.equal(report.moved.length, 0)
  assert.equal(report.kept.length, 5)
  assert.deepEqual(w.keys.rows.map((r) => r._id).sort(), before.map((r) => r._id).sort())
  assert.ok(lines.some((line) => /is already in the backend; you can remove settings\.ai\.connections\.meta-muse\.apiKey now/.test(line)))
})

test('two servers importing at once store each key once (the unique index): the second counts it as already moved', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  const both = await Promise.all([run(w), run(w)])
  assert.equal(w.keys.rows.filter((r) => r.provider === 'meta').length, 1)
  assert.equal(both.reduce((n, b) => n + b.report.moved.filter((m) => m.provider === 'meta').length, 0), 1)
  assert.equal(both.reduce((n, b) => n + b.report.failed.length, 0), 0)
})

test('a revoked key is never brought back: the settings entry is ignored, warned about and shown on the admin page', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  await run(w)
  const meta = await w.keyStore.activeOf('meta')
  await w.keyStore.revoke({ actor: w.actor, id: meta.id, reason: 'leaked' })
  const { report, lines, health } = await run(w)
  assert.deepEqual(report.revoked.map((r) => r.provider), ['meta'])
  assert.equal(await w.keyStore.activeOf('meta'), null)
  assert.ok(lines.some((line) => /revoked in Admin → AI control\. It is not used; remove it/.test(line)))
  assert.ok(health.some((h) => h.kind === 'keys-settings' && h.id === 'meta'))
  assert.match((await w.keyStore.keyFor('meta')).error, /has no active key/)
})

test('the backend\'s own key wins over a different key in the settings file', async () => {
  const w = await aiControlWorld()
  await w.catalog.addProvider({ actor: w.actor, input: { preset: 'meta' } })
  await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: 'sk-test-meta-admin-9999999999999999' })
  const { report, lines } = await run(w)
  assert.deepEqual(report.ignored.map((r) => r.provider), ['meta'])
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, 'sk-test-meta-admin-9999999999999999')
  assert.ok(lines.some((line) => /the backend has its own meta key .* is ignored, remove it/.test(line)))
})

test('no encryption key: nothing is written, the key answers from memory for this boot, and a red alert says why and how to fix it', async () => {
  const w = await aiControlWorld({ master: null, settings: prodSettings() })
  const { report, lines, health } = await run(w)
  assert.equal(w.keys.rows.length, 0, 'nothing written')
  assert.deepEqual(report.failed.map((f) => f.provider).sort(), ['anthropic', 'deepinfra', 'meta', 'openai', 'stability'])
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, META, 'served from memory')
  assert.ok(health.some((h) => h.kind === 'keys-import' && h.id === 'meta' && /could not be moved to the backend .*SLATEBOX_KEY_ENCRYPTION_KEY/.test(h.problem)))
  assert.ok(!allStrings([lines, health, report]).join('\n').includes(META))
  // and the request path answers with it
  const route = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(route.connection.apiKey, META)
  assert.equal(route.connection.baseUrl, 'https://api.meta.ai/v1')
})

test('after the import no runtime path reads a key from the settings file or the environment', async () => {
  // behaviour: settings and env full of keys, nothing in the backend, no import run → no key reaches a request
  const w = await aiControlWorld({ settings: prodSettings() })
  process.env.API_KEY_DEEP_INFRA_TEST_GUARD = DEEPINFRA
  const route = await w.aiSettings.resolveFor({ userId: 'ana', feature: 'chat' })
  assert.equal(route.connection, null)
  assert.match(route.error, /Meta \(Muse\) has no active key/)
  assert.equal(await w.aiSettings.auxCredential('stability'), null)
  delete process.env.API_KEY_DEEP_INFRA_TEST_GUARD
  // source: outside the one-time import, nothing names a settings key or API_KEY_DEEP_INFRA
  const root = new URL('../web/app/server/', import.meta.url).pathname
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!['node_modules', 'generated'].includes(name)) walk(path)
      } else if (/\.(m?js|cjs)$/.test(name)) files.push(path)
    }
  }
  walk(root)
  const offenders = files
    .filter((path) => !path.endsWith('migrations/ai-control-002.mjs'))
    .filter((path) => /settings\??\.(openai|anthropic|deepinfra|openrouter)\??\.apiKey|stabilityai\??\.apiKey|API_KEY_DEEP_INFRA|ai\??\.connections\b|\.apiKeyEnv\b/.test(readFileSync(path, 'utf8').replace(/\/\/.*$/gm, '')))
    .map((path) => path.slice(root.length))
  assert.deepEqual(offenders, [], 'only ai-control-002 reads a key from the settings file')
})

test('a revoked key that an administrator then deletes is still never brought back by the next boot\'s import', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  await run(w)
  const meta = await w.keyStore.activeOf('meta')
  await w.keyStore.revoke({ actor: w.actor, id: meta.id, reason: 'leaked' })
  await w.keyStore.remove({ actor: w.actor, id: meta.id, reason: 'tidy up' })
  assert.ok(!(await w.keyStore.list({ provider: 'meta' })).some((k) => k.id === meta.id), 'the deleted key is gone from the list')
  const { report } = await run(w)
  assert.deepEqual(report.revoked.map((r) => r.provider), ['meta'])
  assert.equal(await w.keyStore.activeOf('meta'), null)
  assert.match((await w.keyStore.keyFor('meta')).error, /has no active key/)
  await assert.rejects(w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: META }), /revoked and cannot be used again/)
})

test('a key kept from the settings file for this boot stops answering once an administrator acts on that provider in the backend', async () => {
  // the import could not store the key this boot (the database refused), so it answers from memory
  const w = await aiControlWorld({ settings: prodSettings() })
  const add = w.keyStore.add
  w.keyStore.add = async () => { throw new Error('the database refused') }
  await run(w)
  w.keyStore.add = add
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, META, 'served from memory')
  // the administrator adds the same key by hand, then revokes it: nothing answers with it any more
  const saved = await w.keyStore.add({ actor: w.actor, provider: 'meta', apiKey: META })
  await w.keyStore.revoke({ actor: w.actor, id: saved.id, reason: 'leaked' })
  assert.match((await w.keyStore.keyFor('meta')).error, /has no active key/)
  assert.ok(!w.keyStore.fromSettings().includes('meta'))
})

test('a key the database refuses as a duplicate that is not actually stored (an older index) answers from memory, never lost', async () => {
  const w = await aiControlWorld({ settings: prodSettings() })
  const add = w.keyStore.add
  w.keyStore.add = async (args) => {
    if (args.provider === 'meta') { const error = new Error('This key is already saved.'); error.status = 409; throw error }
    return add(args)
  }
  const { report, health } = await run(w)
  w.keyStore.add = add
  assert.deepEqual(report.failed.map((f) => f.provider), ['meta'])
  assert.ok(!report.kept.some((k) => k.provider === 'meta'))
  assert.equal((await w.keyStore.keyFor('meta')).apiKey, META, 'served from memory')
  assert.ok(health.some((h) => h.kind === 'keys-import' && h.id === 'meta'))
})
