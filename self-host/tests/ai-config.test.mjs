// The operator's AI settings, as configure.mjs reads them: any mix of cloud providers and
// OpenAI-compatible endpoints (a model on the host, the network or a host provider), a default
// and a choice per feature, and the one switch for people's own AI. Pure: runs without the image.
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import { checkConnections, operatorAI } from '../rootfs/opt/slatebox/lib/ai-config.mjs'

const env = (values) => (name) => values[name]

test('nothing set: no operator AI, people may add their own', () => {
  const ai = operatorAI(env({}))
  assert.equal(ai.settings, null)
  assert.equal(ai.on, false)
  assert.match(ai.summary[0], /^AI drafts: off \(set SLATEBOX_AI_URL and SLATEBOX_AI_MODEL, SLATEBOX_AI_CONFIG or SLATEBOX_AI_KEY/)
  assert.match(ai.summary[1], /^Own AI: +on, people may connect their own/)
})

test('SLATEBOX_AI_URL and SLATEBOX_AI_MODEL become the server\'s default connection for every feature', () => {
  const ai = operatorAI(env({ SLATEBOX_AI_URL: 'http://host.docker.internal:11434/v1', SLATEBOX_AI_MODEL: 'any-model', SLATEBOX_AI_KEY: 'endpoint-secret-1234' }))
  assert.deepEqual(ai.settings, {
    connections: { server: { type: 'openai-compatible', baseUrl: 'http://host.docker.internal:11434/v1', model: 'any-model', apiKey: 'endpoint-secret-1234' } },
    use: { default: 'server' },
  })
  assert.equal(ai.on, true)
  assert.equal(ai.deepInfraKey, undefined, 'the key belongs to the endpoint, not to DeepInfra')
  assert.match(ai.summary[0], /^AI drafts: on, using host\.docker\.internal:11434 \(server, any-model\); default: server$/)
  assert.ok(!ai.summary.join('\n').includes('endpoint-secret-1234'))
})

test('SLATEBOX_AI_KEY alone is a DeepInfra key for the built-in AI, as before', () => {
  const ai = operatorAI(env({ SLATEBOX_AI_KEY: 'di-secret-12345678' }))
  assert.equal(ai.settings, null)
  assert.equal(ai.deepInfraKey, 'di-secret-12345678')
  assert.equal(ai.on, true)
  assert.match(ai.summary[0], /^AI drafts: on, using DeepInfra$/)
})

test('SLATEBOX_AI_CONFIG mixes freely: a local model for some features, a cloud one for others', () => {
  const config = {
    connections: {
      desk: { type: 'openai-compatible', url: 'http://host.docker.internal:11434/v1', model: 'local-model', tools: true, vision: false },
      cloud: { type: 'openai', key: 'sk-cloud-secret-0001', model: 'cloud-model', images: true, vision: true },
      lan: { type: 'openai-compatible', url: 'http://192.168.1.40:8000/v1/', model: 'lan-model', maxTokens: 4096 },
    },
    use: { default: 'desk', vision: 'cloud', images: 'cloud', presentation: 'lan' },
    ownProviders: 'off',
  }
  const ai = operatorAI(env({ SLATEBOX_AI_CONFIG: JSON.stringify(config) }))
  assert.deepEqual(ai.settings, {
    connections: {
      desk: { type: 'openai-compatible', baseUrl: 'http://host.docker.internal:11434/v1', model: 'local-model', capabilities: { tools: true, vision: false } },
      cloud: { type: 'openai', model: 'cloud-model', apiKey: 'sk-cloud-secret-0001', capabilities: { vision: true, images: true } },
      lan: { type: 'openai-compatible', baseUrl: 'http://192.168.1.40:8000/v1', model: 'lan-model', maxTokens: 4096 },
    },
    use: { default: 'desk', vision: 'cloud', images: 'cloud', presentation: 'lan' },
    ownProviders: 'off',
  })
  const log = ai.summary.join('\n')
  assert.match(log, /AI drafts: on, using host\.docker\.internal:11434 \(desk, local-model\), api\.openai\.com \(cloud, cloud-model\), 192\.168\.1\.40:8000 \(lan, lan-model\)/)
  assert.match(log, /images: cloud/)
  assert.match(log, /Own AI: +off/)
  assert.ok(!log.includes('sk-cloud-secret-0001'))
})

test('SLATEBOX_AI_OWN_PROVIDERS is the one switch', () => {
  assert.equal(operatorAI(env({ SLATEBOX_AI_OWN_PROVIDERS: 'off' })).settings.ownProviders, 'off')
  assert.equal(operatorAI(env({ SLATEBOX_AI_OWN_PROVIDERS: 'on' })).settings.ownProviders, 'on')
  assert.throws(() => operatorAI(env({ SLATEBOX_AI_OWN_PROVIDERS: 'maybe' })), /SLATEBOX_AI_OWN_PROVIDERS must be on or off/)
})

test('a wrong AI setting stops the start with a plain message and never prints a key', () => {
  const cases = [
    [{ SLATEBOX_AI_CONFIG: '{nope' }, /SLATEBOX_AI_CONFIG must be a JSON object/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://169.254.169.254/v1', model: 'x' } } }) }, /metadata/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://[fd00:ec2::254]/v1', model: 'x' } } }) }, /metadata/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://metadata.google.internal/v1', model: 'x' } } }) }, /metadata/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://u:sk-in-url-secret@llm.lan/v1', model: 'x' } } }) }, /key/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'ftp://llm.lan/v1', model: 'x' } } }) }, /http/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://llm.lan/v1' } } }) }, /model/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai', model: 'x' } } }) }, /needs a key/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'magic', model: 'x' } } }) }, /type/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { 'Bad Name': { type: 'openai', key: 'k-12345678', model: 'x' } } }) }, /name/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { m: { type: 'openai-compatible', url: 'http://llm.lan/v1', model: 'x', vision: 'yes' } } }) }, /true or false/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ use: { default: 'nothing' } }) }, /nothing/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ use: { telepathy: 'builtin' } }) }, /telepathy/],
    [{ SLATEBOX_AI_CONFIG: JSON.stringify({ shout: true }) }, /shout/],
    [{ SLATEBOX_AI_URL: 'http://llm.lan/v1', SLATEBOX_AI_MODEL: 'x', SLATEBOX_AI_CONFIG: JSON.stringify({ connections: { server: { type: 'openai-compatible', url: 'http://other.lan/v1', model: 'y' } } }) }, /server/],
  ]
  for (const [values, message] of cases) {
    assert.throws(() => operatorAI(env(values)), (error) => {
      assert.match(error.message, message, JSON.stringify(values))
      assert.ok(!/sk-in-url-secret|k-12345678/.test(error.message), 'no key in the message')
      assert.equal(error.constructor.name, 'Plain')
      return true
    })
  }
})

test('slatebox ai check tests every server connection and prints no key', async (t) => {
  const seen = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    seen.push({ url: req.url, auth: req.headers.authorization })
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }))
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'ping', arguments: '{"ok":true}' } }] } }] }))
  })
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  t.after(() => server.close())
  const base = `http://127.0.0.1:${server.address().port}/v1`
  const lines = await checkConnections({
    connections: { stub: { type: 'openai-compatible', baseUrl: base, model: 'stub-model', apiKey: 'stub-secret-0001' }, gone: { type: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'm' } },
  }, { timeoutMs: 2000 })
  const text = lines.join('\n')
  assert.match(text, /stub: connected, stub-model listed, calls tools/)
  assert.match(text, /gone: could not reach http:\/\/127\.0\.0\.1:9\/v1/)
  assert.ok(!text.includes('stub-secret-0001'))
  assert.equal(seen[0].auth, 'Bearer stub-secret-0001')
})

// ---------- review fixes (2026-11-21) ----------

test('SLATEBOX_AI_PRIVATE_ENDPOINTS=off keeps people\'s own AI on public addresses, separately from the switch', () => {
  const off = operatorAI(env({ SLATEBOX_AI_PRIVATE_ENDPOINTS: 'off' }))
  assert.deepEqual(off.settings, { connections: {}, use: {}, privateEndpoints: 'off' })
  assert.match(off.summary.join('\n'), /people's own AI may use public addresses only \(SLATEBOX_AI_PRIVATE_ENDPOINTS=off\)/)
  assert.equal(operatorAI(env({})).settings, null, 'on is the default and needs no setting')
  const fromConfig = operatorAI(env({ SLATEBOX_AI_CONFIG: JSON.stringify({ privateEndpoints: 'off' }) }))
  assert.equal(fromConfig.settings.privateEndpoints, 'off')
  assert.equal(operatorAI(env({ SLATEBOX_AI_CONFIG: JSON.stringify({ privateEndpoints: 'off' }), SLATEBOX_AI_PRIVATE_ENDPOINTS: 'on' })).settings.privateEndpoints, 'on', 'the variable wins')
  assert.throws(() => operatorAI(env({ SLATEBOX_AI_PRIVATE_ENDPOINTS: 'lan' })), /SLATEBOX_AI_PRIVATE_ENDPOINTS must be on or off/)
})

test('other clouds\' metadata addresses, and metadata wrapped in NAT64 or 6to4, are refused', () => {
  for (const url of ['http://192.0.0.192/v1', 'http://[fd20:ce::254]/v1', 'http://168.63.129.16/v1', 'http://[64:ff9b::a9fe:a9fe]/v1',
    'http://[2002:a9fe:a9fe::1]/v1', 'http://[0:0:0:0:0:ffff:a9fe:a9fe]/v1']) {
    assert.throws(() => operatorAI(env({ SLATEBOX_AI_URL: url, SLATEBOX_AI_MODEL: 'm' })), /metadata/, url)
  }
  assert.equal(operatorAI(env({ SLATEBOX_AI_URL: 'http://[64:ff9b::a00:1]/v1', SLATEBOX_AI_MODEL: 'm' })).on, true, 'a NAT64 private address is the operator\'s to use')
})

test('configure accepts SLATEBOX_AI_PRIVATE_ENDPOINTS, and the docs and slatebox ai name it', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  assert.match(read('rootfs/opt/slatebox/lib/configure.mjs'), /'SLATEBOX_AI_PRIVATE_ENDPOINTS'/)
  assert.match(read('README.md'), /SLATEBOX_AI_PRIVATE_ENDPOINTS/)
  assert.match(read('DESIGN.md'), /SLATEBOX_AI_PRIVATE_ENDPOINTS/)
  assert.match(read('rootfs/opt/slatebox/lib/ai-cli.mjs'), /privateEndpoints/)
})
