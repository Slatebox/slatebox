import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aiEnv, capabilitiesFromProbe, LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'

const legacy = { settings: LEGACY_SETTINGS, commands: ['backup', 'restore', 'password-link', 'health', 'version', 'sso'] }
const multi = { settings: [...LEGACY_SETTINGS, 'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT'], commands: legacy.commands }

const deepinfra = { id: 'deepinfra', kind: 'deepinfra', keyFrom: 'env:DEEPINFRA_API_KEY' }
const endpoint = { id: 'local', kind: 'openai-compatible', baseUrl: 'http://ollama:11434/v1', model: 'qwen3:8b', keyFrom: 'none' }
const withKey = { ...endpoint, id: 'vllm', baseUrl: 'https://llm.internal/v1', keyFrom: 'file:/run/token' }

test('AI off writes nothing', () => {
  assert.deepEqual(aiEnv({ mode: 'none' }, legacy, { target: 'local' }), { env: {}, secrets: {}, notes: [], hostGateway: false })
})

test('legacy image, one DeepInfra key: SLATEBOX_AI_KEY from its reference', () => {
  const out = aiEnv({ mode: 'providers', providers: [deepinfra], default: 'deepinfra' }, legacy, { target: 'local' })
  assert.deepEqual(out.env, {})
  assert.deepEqual(out.secrets, { SLATEBOX_AI_KEY: 'env:DEEPINFRA_API_KEY' })
})

test('legacy image, one endpoint: URL and model as settings, token as a secret only when it has one', () => {
  assert.deepEqual(aiEnv({ mode: 'providers', providers: [endpoint], default: 'local' }, legacy, { target: 'k8s' }),
    { env: { SLATEBOX_AI_URL: 'http://ollama:11434/v1', SLATEBOX_AI_MODEL: 'qwen3:8b' }, secrets: {}, notes: [], hostGateway: false })
  assert.deepEqual(aiEnv({ mode: 'providers', providers: [withKey], default: 'vllm' }, legacy, { target: 'local' }).secrets,
    { SLATEBOX_AI_KEY: 'file:/run/token' })
})

test('legacy image refuses a mix with exit code 2 and says why', () => {
  assert.throws(() => aiEnv({ mode: 'providers', providers: [deepinfra, endpoint], default: 'local' }, legacy, { target: 'local' }),
    error => error.exitCode === 2 && /supports one AI provider/.test(error.message))
})

test('multi-provider image: one JSON list plus a key variable per provider, values never inlined', () => {
  const out = aiEnv({ mode: 'providers', providers: [deepinfra, endpoint, withKey], default: 'local' }, multi, { target: 'k8s' })
  assert.deepEqual(JSON.parse(out.env.SLATEBOX_AI_PROVIDERS), [
    { id: 'deepinfra', kind: 'deepinfra', keyEnv: 'SLATEBOX_AI_KEY_DEEPINFRA' },
    { id: 'local', kind: 'openai-compatible', baseUrl: 'http://ollama:11434/v1', model: 'qwen3:8b' },
    { id: 'vllm', kind: 'openai-compatible', baseUrl: 'https://llm.internal/v1', model: 'qwen3:8b', keyEnv: 'SLATEBOX_AI_KEY_VLLM' },
  ])
  assert.equal(out.env.SLATEBOX_AI_DEFAULT, 'local')
  assert.deepEqual(out.secrets, { SLATEBOX_AI_KEY_DEEPINFRA: 'env:DEEPINFRA_API_KEY', SLATEBOX_AI_KEY_VLLM: 'file:/run/token' })
})

test('an endpoint on this computer is reached from the container through host.docker.internal', () => {
  const local = { ...endpoint, baseUrl: 'http://localhost:11434/v1' }
  const out = aiEnv({ mode: 'providers', providers: [local], default: 'local' }, legacy, { target: 'local' })
  assert.equal(out.env.SLATEBOX_AI_URL, 'http://host.docker.internal:11434/v1')
  assert.equal(out.hostGateway, true)
  assert.match(out.notes.join('\n'), /host\.docker\.internal/)
  assert.throws(() => aiEnv({ mode: 'providers', providers: [local], default: 'local' }, legacy, { target: 'k8s' }),
    error => error.exitCode === 2 && /localhost/.test(error.message))
})

test('capabilities come from the image: settings --json first, the unknown-setting message as a fallback', () => {
  assert.deepEqual(capabilitiesFromProbe({ settingsJson: '{"settings":["SLATEBOX_URL","SLATEBOX_AI_PROVIDERS"],"commands":["backup","admin"]}' }),
    { settings: ['SLATEBOX_URL', 'SLATEBOX_AI_PROVIDERS'], commands: ['backup', 'admin'], source: 'settings --json' })
  const probe = capabilitiesFromProbe({
    configureOutput: 'Unknown setting SLATEBOX_INSTALLER_PROBE. The settings are: SLATEBOX_URL, SLATEBOX_HTTPS, SLATEBOX_KEY_ENCRYPTION_KEY, MONGO_URL (in capitals).\n',
    usage: 'Usage, from the Docker host:\n  docker exec slatebox slatebox backup > x\n  docker exec slatebox slatebox health\n  docker exec slatebox slatebox sso [admin-password]\n',
  })
  assert.deepEqual(probe, { settings: ['SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_KEY_ENCRYPTION_KEY', 'MONGO_URL'], commands: ['backup', 'health', 'sso'], source: 'probe' })
  assert.equal(capabilitiesFromProbe({}), null)
})
