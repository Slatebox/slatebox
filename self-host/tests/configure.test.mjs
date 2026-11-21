// The start-up step on its own: this checkout's configure.mjs, run inside the
// image under test with nothing else started, so a setting can be checked in
// seconds. The data and run folders are fresh for every case and vanish with it.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { IMAGE, ok } from './lib.mjs'

const LIB = fileURLToPath(new URL('../rootfs/opt/slatebox/lib', import.meta.url))
const SEP = '\u001e'

/**
 * Run configure.mjs with these settings. Returns its exit code, everything it
 * printed (the container log), the app's environment as the app reads it (from
 * app.env alone, nothing inherited), and the files it left in /data/secrets.
 */
async function configure(env) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const script = [
    'node /opt/slatebox/lib/configure.mjs > /run/slatebox-test.log 2>&1; code=$?',
    `printf '%s${SEP}' "$code"`,
    `cat /run/slatebox-test.log; printf '${SEP}'`,
    // What the app process gets from app.env, with the container's own environment left out.
    `[ -f /run/slatebox/app.env ] && env -i sh -c 'set -a; . /run/slatebox/app.env; set +a; node -e "process.stdout.write(JSON.stringify({ key: process.env.SLATEBOX_KEY_ENCRYPTION_KEY ?? null, settings: process.env.METEOR_SETTINGS }))"'; printf '${SEP}'`,
    'ls -A /data/secrets 2>/dev/null | wc -l',
  ].join('; ')
  const out = await ok(['run', '--rm', '--network', 'none',
    '--tmpfs', '/data:mode=1777', '--tmpfs', '/run:mode=1777',
    '-v', `${LIB}:/opt/slatebox/lib:ro`, ...envArgs, '--entrypoint', 'sh', IMAGE, '-c', script])
  const [code, log, app, secretFiles] = out.split(SEP)
  return { code: Number(code), log, app: app ? JSON.parse(app) : null, secretFiles: Number(secretFiles.trim()) }
}

test('SLATEBOX_KEY_ENCRYPTION_KEY reaches the app through app.env and is never printed', async () => {
  const key = randomBytes(32).toString('base64') // what `openssl rand -base64 32` prints
  const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: key })
  assert.equal(run.code, 0, run.log)
  assert.equal(run.app.key, key)
  assert.equal(Buffer.from(run.app.key, 'base64').length, 32)
  assert.match(run.log, /Own keys: +on/)
  assert.ok(!run.log.includes(key), 'the key is not in the log')
  assert.ok(!run.app.settings.includes(key), 'the key is not in the app settings')
})

test('SLATEBOX_KEY_ENCRYPTION_KEY may be given in URL-safe base64 without padding', async () => {
  const key = randomBytes(32).toString('base64url')
  const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: key })
  assert.equal(run.code, 0, run.log)
  assert.equal(Buffer.from(run.app.key, 'base64').toString('hex'), Buffer.from(key, 'base64url').toString('hex'))
})

test('without SLATEBOX_KEY_ENCRYPTION_KEY the log says how to turn own keys on', async () => {
  const run = await configure({})
  assert.equal(run.code, 0, run.log)
  assert.equal(run.app.key, null)
  assert.match(run.log, /Own keys: +off \(set SLATEBOX_KEY_ENCRYPTION_KEY/)
})

test('a SLATEBOX_KEY_ENCRYPTION_KEY that is not 32 bytes of base64 stops the start without printing it', async () => {
  const cases = [
    randomBytes(16).toString('base64'), // too short
    randomBytes(32).toString('hex'), // openssl rand -hex 32: valid base64 characters, but 48 bytes
    `${randomBytes(32).toString('base64').slice(0, 40)}!@#$`, // not base64 at all
  ]
  for (const value of cases) {
    const run = await configure({ SLATEBOX_KEY_ENCRYPTION_KEY: value })
    assert.equal(run.code, 1, `${value} is refused`)
    assert.match(run.log, /SLATEBOX_KEY_ENCRYPTION_KEY must be 32 random bytes in base64, for example the output of openssl rand -base64 32/)
    assert.ok(!run.log.includes(value), 'the refused value is not printed')
    assert.doesNotMatch(run.log, /\n\s+at .*:\d+:\d+\)?/, 'no stack trace for an operator mistake')
    assert.equal(run.app, null, 'no app.env was written')
    assert.equal(run.secretFiles, 0, 'nothing was created before the mistake was reported')
  }
})

// ---------- AI: any mix the operator chooses (lib/ai-config.mjs) ----------

const appSettings = (run) => JSON.parse(run.app.settings)

test('SLATEBOX_AI_URL and SLATEBOX_AI_MODEL wire one endpoint for every feature; the key stays out of the log', async () => {
  const key = `endpoint-${randomBytes(8).toString('hex')}`
  const run = await configure({ SLATEBOX_AI_URL: 'http://host.docker.internal:11434/v1', SLATEBOX_AI_MODEL: 'any-model', SLATEBOX_AI_KEY: key })
  assert.equal(run.code, 0, run.log)
  const settings = appSettings(run)
  assert.deepEqual(settings.ai, {
    connections: { server: { type: 'openai-compatible', baseUrl: 'http://host.docker.internal:11434/v1', model: 'any-model', apiKey: key } },
    use: { default: 'server' },
  })
  assert.equal(settings.selfHosted.workshopAI, true)
  assert.deepEqual(settings.selfHosted.workshopProvider, { baseUrl: 'http://host.docker.internal:11434/v1', model: 'any-model', apiKey: key }, 'an older app still finds its endpoint')
  assert.match(run.log, /AI drafts: on, using host\.docker\.internal:11434 \(server, any-model\)/)
  assert.match(run.log, /Own AI: +on/)
  assert.ok(!run.log.includes(key))
})

test('SLATEBOX_AI_CONFIG mixes a model on the host with a cloud provider, and SLATEBOX_AI_OWN_PROVIDERS turns people\'s own AI off', async () => {
  const key = `sk-${randomBytes(8).toString('hex')}`
  const config = {
    connections: {
      desk: { type: 'openai-compatible', url: 'http://host.docker.internal:11434/v1', model: 'local-model', vision: false },
      cloud: { type: 'openai', key, model: 'cloud-model', images: true },
    },
    use: { default: 'desk', images: 'cloud', vision: 'cloud' },
  }
  const run = await configure({ SLATEBOX_AI_CONFIG: JSON.stringify(config), SLATEBOX_AI_OWN_PROVIDERS: 'off' })
  assert.equal(run.code, 0, run.log)
  const { ai } = appSettings(run)
  assert.deepEqual(ai.use, { default: 'desk', images: 'cloud', vision: 'cloud' })
  assert.equal(ai.connections.cloud.apiKey, key)
  assert.equal(ai.connections.desk.baseUrl, 'http://host.docker.internal:11434/v1')
  assert.equal(ai.ownProviders, 'off')
  assert.match(run.log, /Own AI: +off/)
  assert.ok(!run.log.includes(key))
})

test('an AI endpoint at a cloud metadata address stops the start before anything is written', async () => {
  const run = await configure({ SLATEBOX_AI_URL: 'http://169.254.169.254/latest', SLATEBOX_AI_MODEL: 'm' })
  assert.equal(run.code, 1)
  assert.match(run.log, /cloud metadata address/)
  assert.doesNotMatch(run.log, /\n\s+at .*:\d+:\d+\)?/, 'no stack trace for an operator mistake')
  assert.equal(run.app, null)
  assert.equal(run.secretFiles, 0)
})

test('slatebox ai check tests the server connections from inside the container', async () => {
  // A stub OpenAI-compatible server inside the same container (the network is off).
  const stub = `require('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); q.resume(); q.on('end', () => s.end(q.url.endsWith('/models') ? '{"data":[{"id":"stub-model"}]}' : '{"choices":[{"message":{"role":"assistant","tool_calls":[{"id":"c","type":"function","function":{"name":"ping","arguments":"{}"}}]}}]}')) }).listen(4399, '127.0.0.1')`
  const script = [
    `node -e '${stub.replace(/'/g, "'\\''")}' & sleep 0.5`,
    'node /opt/slatebox/lib/configure.mjs > /dev/null',
    "env -i PATH=\"$PATH\" sh -c 'set -a; . /run/slatebox/app.env; set +a; node /opt/slatebox/lib/ai-cli.mjs check; node /opt/slatebox/lib/ai-cli.mjs'",
  ].join('; ')
  const out = await ok(['run', '--rm', '--network', 'none', '--tmpfs', '/data:mode=1777', '--tmpfs', '/run:mode=1777',
    '-v', `${LIB}:/opt/slatebox/lib:ro`, '-e', 'SLATEBOX_AI_URL=http://127.0.0.1:4399/v1', '-e', 'SLATEBOX_AI_MODEL=stub-model', '-e', 'SLATEBOX_AI_KEY=stub-secret-0001',
    '--entrypoint', 'sh', IMAGE, '-c', script])
  assert.match(out, /server: connected, stub-model listed, calls tools/)
  assert.match(out, /default uses server/)
  assert.ok(!out.includes('stub-secret-0001'))
})
