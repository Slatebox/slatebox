import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answersFromFlags, collect, flagsFromEnv, parseProviderSpec, resolveAnswers, SIZES } from '../src/answers.mjs'

const ctx = { freePort: 7071 }

test('flags beat the answers file, which beats exported SLATEBOX_INSTALL_* variables', () => {
  const env = { SLATEBOX_INSTALL_ADMIN_EMAIL: 'env@example.com', SLATEBOX_INSTALL_SIZE: 'large', SLATEBOX_INSTALL_AI: 'none' }
  const file = { adminEmail: 'file@example.com', size: 'team' }
  const flags = { 'admin-email': 'flag@example.com' }
  const partial = collect({ env, file, flags })
  assert.equal(partial.adminEmail, 'flag@example.com')
  assert.equal(partial.size, 'team')
  assert.equal(partial.ai.mode, 'none')
})

test('an existing install record is the base: a re-run keeps its port and settings', () => {
  const record = { name: 'slatebox', target: 'local', address: { url: 'http://localhost:7099', port: 7099 }, ai: { mode: 'none' } }
  const { answers, missing, errors } = resolveAnswers(collect({ record, flags: {} }), ctx)
  assert.deepEqual(errors, [])
  assert.deepEqual(missing, [])
  assert.equal(answers.address.port, 7099)
  assert.equal(answers.address.url, 'http://localhost:7099')
})

test('flagsFromEnv only reads SLATEBOX_INSTALL_* names and turns them into flag names', () => {
  assert.deepEqual(flagsFromEnv({ SLATEBOX_INSTALL_K8S_CONTEXT: 'kind-x', SLATEBOX_URL: 'nope', PATH: '/bin' }), { 'k8s-context': 'kind-x' })
})

test('local defaults: the first free port from 7070 and its address', () => {
  const { answers, missing } = resolveAnswers(collect({ flags: { ai: 'none' } }), ctx)
  assert.deepEqual(missing, [])
  assert.equal(answers.target, 'local')
  assert.equal(answers.name, 'slatebox')
  assert.deepEqual(answers.address, { url: 'http://localhost:7071', port: 7071, listen: '127.0.0.1' })
  assert.deepEqual(answers.size, SIZES.small)
  assert.equal(answers.sso.enabled, false)
  assert.equal(answers.backups.keep, 14)
})

test('AI has no default: without an answer it is reported missing, with its choices and no default', () => {
  const { missing } = resolveAnswers(collect({ flags: {} }), ctx)
  const ai = missing.find(question => question.field === 'ai.mode')
  assert.ok(ai, 'ai.mode is missing')
  assert.equal(ai.default, null)
  assert.deepEqual(ai.choices.map(choice => choice.value), ['none', 'cloud', 'endpoint', 'both'])
})

test('remote targets need an admin email and a host', () => {
  const { missing } = resolveAnswers(collect({ flags: { target: 'ssh', ai: 'none' } }), ctx)
  assert.deepEqual(missing.map(question => question.field).sort(), ['adminEmail', 'ssh.host'])
})

test('ssh: a domain gives https and built-in TLS on 80/443; no domain gives http://host:7070', () => {
  const withDomain = resolveAnswers(collect({ flags: { target: 'ssh', host: 'root@203.0.113.5', domain: 'boards.example.com', 'admin-email': 'ops@example.com', ai: 'none' } }), ctx)
  assert.deepEqual(withDomain.errors, [])
  assert.equal(withDomain.answers.address.url, 'https://boards.example.com')
  assert.deepEqual(withDomain.answers.ssh, { host: '203.0.113.5', user: 'root', port: 22, identity: null, sudo: 'auto', installDocker: false, dir: '/opt/slatebox', options: [] })
  const without = resolveAnswers(collect({ flags: { target: 'ssh', host: 'deploy@203.0.113.5', 'admin-email': 'ops@example.com', ai: 'none' } }), ctx)
  assert.equal(without.answers.address.url, 'http://203.0.113.5:7070')
  assert.equal(without.answers.address.port, 7070)
})

test('the port in the address always follows the published port', () => {
  const { answers } = resolveAnswers(collect({ flags: { port: '7444', ai: 'none' } }), ctx)
  assert.deepEqual(answers.address, { url: 'http://localhost:7444', port: 7444, listen: '127.0.0.1' })
  const mismatch = resolveAnswers(collect({ flags: { port: '7444', url: 'http://localhost:7070', ai: 'none' } }), ctx)
  assert.deepEqual(mismatch.errors.map(error => error.field), ['address.url'])
})

test('provider specs: presets, references, and literal keys refused', () => {
  assert.deepEqual(parseProviderSpec('id=local,kind=openai-compatible,url=http://ollama:11434/v1,model=qwen3:8b'),
    { id: 'local', kind: 'openai-compatible', baseUrl: 'http://ollama:11434/v1', model: 'qwen3:8b', keyFrom: 'none' })
  assert.deepEqual(parseProviderSpec('kind=deepinfra,key=env:DEEPINFRA_API_KEY'), { id: 'deepinfra', kind: 'deepinfra', keyFrom: 'env:DEEPINFRA_API_KEY' })
  const flags = { 'ai-provider': ['kind=openai,model=gpt-5-mini,key=env:OPENAI_API_KEY', 'id=local,kind=ollama,model=qwen3:8b'], 'ai-default': 'local' }
  const { answers, errors } = resolveAnswers(collect({ flags }), ctx)
  assert.deepEqual(errors, [])
  assert.equal(answers.ai.mode, 'providers')
  assert.equal(answers.ai.default, 'local')
  assert.equal(answers.ai.providers[0].baseUrl, 'https://api.openai.com/v1')
  assert.equal(answers.ai.providers[1].baseUrl, 'http://localhost:11434/v1')
  const literal = resolveAnswers(collect({ flags: { 'ai-provider': ['kind=deepinfra,key=sk-live-123'] } }), ctx)
  assert.deepEqual(literal.errors.map(error => error.field), ['ai.providers[0].keyFrom'])
  assert.doesNotMatch(JSON.stringify(literal.errors), /sk-live-123/, 'the refused value is not echoed')
})

test('several providers need an explicit default; it is never assumed', () => {
  const flags = { 'ai-provider': ['kind=deepinfra,key=env:A', 'id=local,kind=openai-compatible,url=http://x/v1,model=m'] }
  const { errors } = resolveAnswers(collect({ flags }), ctx)
  assert.deepEqual(errors.map(error => error.field), ['ai.default'])
})

test('validation errors name each field', () => {
  const { errors } = resolveAnswers(collect({
    file: { target: 'moon', adminEmail: 'not-an-email', size: 'huge', address: { url: 'https://x.example.com/path' }, ai: { mode: 'none' } },
  }), ctx)
  assert.deepEqual(errors.map(error => error.field).sort(), ['address.url', 'adminEmail', 'size', 'target'])
})

test('kubernetes: a route needs a host; https comes from the edge; s3 backups are refused for now', () => {
  const base = { target: 'k8s', 'admin-email': 'ops@example.com', ai: 'none' }
  const noHost = resolveAnswers(collect({ flags: { ...base, route: 'ingress' } }), ctx)
  assert.deepEqual(noHost.errors.map(error => error.field), ['address.url'])
  const ok = resolveAnswers(collect({ flags: { ...base, route: 'ingress', domain: 'boards.example.com', 'tls-issuer': 'ClusterIssuer/letsencrypt' } }), ctx)
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.answers.address.url, 'https://boards.example.com')
  assert.deepEqual(ok.answers.k8s.tlsIssuer, { kind: 'ClusterIssuer', name: 'letsencrypt' })
  const none = resolveAnswers(collect({ flags: base }), ctx)
  assert.equal(none.answers.k8s.route, 'none')
  assert.equal(none.answers.address.url, 'http://localhost:7070')
  const s3 = resolveAnswers(collect({ flags: { ...base, backups: 's3://bucket/x' } }), ctx)
  assert.deepEqual(s3.errors.map(error => error.field), ['backups.to'])
})

test('sizes: named or custom, SSO adds half a gigabyte of memory', () => {
  const { answers } = resolveAnswers(collect({ flags: { size: 'team', sso: true, ai: 'none' } }), ctx)
  assert.deepEqual(answers.size, { memory: '2560Mi', cpu: '2', storage: '20Gi' })
  const custom = resolveAnswers(collect({ file: { size: { memory: '3Gi', cpu: '3', storage: '30Gi' }, ai: { mode: 'none' } } }), ctx)
  assert.deepEqual(custom.answers.size, { memory: '3Gi', cpu: '3', storage: '30Gi' })
})

test('answersFromFlags keeps unknown-free output (only fields that were given)', () => {
  assert.deepEqual(answersFromFlags({ name: 'two' }), { name: 'two' })
})
