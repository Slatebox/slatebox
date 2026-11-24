// Which environment variables a connection saved in the app may read its key from (spec 1.2), and
// which writes only a person may make (spec 6.2). Without the first rule an administrator, or an
// agent holding ai:admin, could point a connection at a host they control and read any secret of
// the process; without the second, an agent could send an AI key to such a host.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENV_KEY_NAME, agentRefusal, envKeyAllowlist, envKeyRefusal } from '../web/app/server/ai-control/key-policy.mjs'

test('SLATEBOX_AI_KEY_* names are allowed; the key-encryption key, database, Meteor, Stripe, Daily and Deepgram never are', () => {
  for (const name of ['SLATEBOX_AI_KEY_GEMINI', 'SLATEBOX_AI_KEY_META_1', 'SLATEBOX_AI_KEY_X']) assert.equal(envKeyRefusal(name), null, name)
  for (const name of ['SLATEBOX_KEY_ENCRYPTION_KEY', 'SLATEBOX_KEY_ENCRYPTION_KEY_NEXT', 'MONGO_URL', 'MONGO_OPLOG_URL', 'METEOR_SETTINGS', 'STRIPE_SECRET_KEY', 'DAILY_API_KEY', 'DEEPGRAM_SECRET']) {
    assert.match(envKeyRefusal(name), /can never be used/, name)
  }
  // anything else needs the settings file's allowlist
  for (const name of ['PATH', 'HOME', 'META_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'SLATEBOX_AI_KEY_']) assert.ok(envKeyRefusal(name), name)
  assert.equal(envKeyRefusal('META_API_KEY', { ai: { envKeyAllowlist: ['META_API_KEY'] } }), null)
  // the allowlist never reaches the names that are refused outright
  assert.match(envKeyRefusal('MONGO_URL', { ai: { envKeyAllowlist: ['MONGO_URL'] } }), /can never be used/)
  assert.match(envKeyRefusal('SLATEBOX_KEY_ENCRYPTION_KEY', { ai: { envKeyAllowlist: ['SLATEBOX_KEY_ENCRYPTION_KEY'] } }), /can never be used/)
  // malformed names and allowlist entries
  for (const name of ['lower_case', 'WITH-DASH', '', null, 'A'.repeat(80)]) assert.match(envKeyRefusal(name), /capitals/, String(name))
  assert.deepEqual(envKeyAllowlist({ ai: { envKeyAllowlist: ['GOOD_NAME', 'bad name', 42] } }), ['GOOD_NAME'])
  assert.equal(ENV_KEY_NAME.test(`SLATEBOX_AI_KEY_${'A'.repeat(41)}`), false)
})

test('an agent may save a keyless connection to a fixed address and change labels and models; nothing that moves a key', () => {
  const locked = { baseUrl: 'https://api.deepinfra.com/v1/openai', baseUrlLocked: true }
  const open = { baseUrl: null, baseUrlLocked: false }
  assert.equal(agentRefusal('connection', { name: 'di', type: 'deepinfra', keyRef: { kind: 'none' } }, null, { provider: locked }), null)
  assert.equal(agentRefusal('connection', { name: 'di', type: 'deepinfra', model: 'm2' }, { provider: 'deepinfra', baseUrl: locked.baseUrl }, { provider: locked }), null)
  assert.match(agentRefusal('connection', { name: 'di', type: 'deepinfra', apiKey: 'k' }, null, { provider: locked }), /send a key/)
  assert.match(agentRefusal('connection', { name: 'di', type: 'deepinfra', apiKey: '' }, null, { provider: locked }), /send a key/)
  assert.match(agentRefusal('connection', { name: 'di', type: 'deepinfra', keyRef: { kind: 'env', name: 'SLATEBOX_AI_KEY_DEEPINFRA' } }, null, { provider: locked }), /keyRef/)
  assert.match(agentRefusal('connection', { name: 'own', type: 'openai-compatible', baseUrl: 'https://evil.example/v1' }, null, { provider: open }), /address can be chosen/)
  assert.match(agentRefusal('connection', { name: 'own', type: 'openai-compatible', baseUrl: 'https://evil.example/v1' }, { provider: 'openai-compatible', baseUrl: 'https://good.example/v1' }, { provider: open }), /baseUrl/)
  assert.equal(agentRefusal('connection', { name: 'own', type: 'openai-compatible', baseUrl: 'https://good.example/v1/' }, { provider: 'openai-compatible', baseUrl: 'https://good.example/v1' }, { provider: open }), null)
  assert.match(agentRefusal('connection', { name: 'own', type: 'deepinfra' }, { provider: 'openai-compatible', baseUrl: 'https://good.example/v1' }, { provider: locked }), /provider/)
  assert.match(agentRefusal('connection', { name: 'di', type: 'deepinfra', rotate: { graceHours: 1 } }, { provider: 'deepinfra' }, { provider: locked }), /rotate/)
})

test('an agent may relabel a provider or change its capabilities, never its address, key style, headers or protocol', () => {
  const stored = { _id: 'gemini', label: 'Gemini', protocol: 'openai-chat', baseUrl: 'https://g.example/v1', auth: { style: 'bearer' }, extraHeaders: {} }
  assert.equal(agentRefusal('provider', { id: 'gemini', label: 'Google', protocol: 'openai-chat', baseUrl: 'https://g.example/v1/', auth: { style: 'bearer' }, defaultCapabilities: { vision: true } }, stored), null)
  assert.equal(agentRefusal('provider', { id: 'gemini', label: 'Google', protocol: 'openai-chat' }, stored), null)
  assert.match(agentRefusal('provider', { id: 'gemini', label: 'G', protocol: 'openai-chat', baseUrl: 'https://evil.example/v1' }, stored), /baseUrl/)
  assert.match(agentRefusal('provider', { id: 'gemini', label: 'G', protocol: 'openai-chat', auth: { style: 'query', name: 'key' } }, stored), /auth/)
  assert.match(agentRefusal('provider', { id: 'gemini', label: 'G', protocol: 'openai-chat', extraHeaders: { 'x-a': 'b' } }, stored), /headers/)
  assert.match(agentRefusal('provider', { id: 'gemini', label: 'G', protocol: 'openai-images' }, stored), /protocol/)
  assert.match(agentRefusal('provider', { id: 'new', label: 'N', protocol: 'openai-chat', baseUrl: 'https://n.example/v1' }, null), /baseUrl|address/)
  assert.equal(agentRefusal('provider', { id: 'new', label: 'N', protocol: 'openai-chat' }, null), null)
})
