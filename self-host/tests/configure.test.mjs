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
 * app.env alone, nothing inherited; of the oplog URL only what follows its credentials), and the files it left in /data/secrets.
 */
async function configure(env) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const script = [
    'node /opt/slatebox/lib/configure.mjs > /run/slatebox-test.log 2>&1; code=$?',
    `printf '%s${SEP}' "$code"`,
    `cat /run/slatebox-test.log; printf '${SEP}'`,
    // What the app process gets from app.env, with the container's own environment left out.
    `[ -f /run/slatebox/app.env ] && env -i sh -c 'set -a; . /run/slatebox/app.env; set +a; node -e "process.stdout.write(JSON.stringify({ key: process.env.SLATEBOX_KEY_ENCRYPTION_KEY ?? null, settings: process.env.METEOR_SETTINGS, oplog: process.env.MONGO_OPLOG_URL ? process.env.MONGO_OPLOG_URL.split(String.fromCharCode(64)).pop() : null }))"'; printf '${SEP}'`,
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

test('without SLATEBOX_KEY_ENCRYPTION_KEY the first start makes one, keeps it in /data/secrets and never prints it', async () => {
  const run = await configure({})
  assert.equal(run.code, 0, run.log)
  assert.equal(Buffer.from(run.app.key, 'base64').length, 32)
  assert.match(run.log, /Own keys: +on, .*a key made for this installation, kept in \/data\/secrets/)
  assert.ok(!run.log.includes(run.app.key), 'the key is not in the log')
  assert.ok(!run.app.settings.includes(run.app.key), 'the key is not in the app settings')
  assert.equal(run.secretFiles, 3, 'secrets.json, mongo.key and key-encryption.key')
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

test('SLATEBOX_AI_PROVIDERS as the installer writes it: each key from its own variable, a default, nothing printed', async () => {
  const key = 'sk-provider-' + randomBytes(8).toString('hex')
  const run = await configure({
    SLATEBOX_AI_PROVIDERS: JSON.stringify([
      { id: 'gateway', kind: 'openai-compatible', baseUrl: 'https://ai.example.com/v1', model: 'model-a', keyEnv: 'SLATEBOX_AI_KEY_GATEWAY' },
      { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://host.docker.internal:11434/v1', model: 'local' },
    ]),
    SLATEBOX_AI_DEFAULT: 'gateway',
    SLATEBOX_AI_KEY_GATEWAY: key,
  })
  assert.equal(run.code, 0, run.log)
  const settings = appSettings(run)
  assert.equal(settings.ai.connections.gateway.apiKey, key)
  assert.equal(settings.ai.use.default, 'gateway')
  assert.ok(!run.log.includes(key), 'the key is not in the log')
  const stray = await configure({ SLATEBOX_AI_KEY_TYPO: key })
  assert.notEqual(stray.code, 0)
  assert.match(stray.log, /SLATEBOX_AI_KEY_TYPO: no provider in SLATEBOX_AI_PROVIDERS names this key/)
  assert.ok(!stray.log.includes(key))
})

test('a self-hosted install: edition self-host (enterprise locked without a license); SLATEBOX_SETTINGS cannot switch on payments or metering', async () => {
  const run = await configure({ SLATEBOX_SETTINGS: JSON.stringify({ public: { edition: 'cloud' } }) })
  assert.equal(run.code, 0, run.log)
  assert.equal(appSettings(run).public.edition, 'self-host')
  for (const extra of [{ stripePrivateKey: 'x' }, { metering: { enabled: true } }, { public: { stripe: { publishableKey: 'x' } } }, { wallet: {} }]) {
    const refused = await configure({ SLATEBOX_SETTINGS: JSON.stringify(extra) })
    assert.notEqual(refused.code, 0, JSON.stringify(extra))
    assert.match(refused.log, /not a setting of a self-hosted Slatebox \(payments and metering run only on Slatebox Cloud\)/)
    assert.equal(refused.secretFiles, 0, 'nothing written')
  }
})

test('live updates: change streams then polling, the oplog URL still set, method timing off; an operator packages.mongo wins', async () => {
  const run = await configure({})
  assert.equal(run.code, 0, run.log)
  const settings = appSettings(run)
  assert.deepEqual(settings.packages.mongo.reactivity, ['changeStreams', 'polling'])
  assert.equal(settings.metrics?.methodTiming, undefined)
  assert.match(run.app.oplog ?? '', /^[^@/]+\/local\?/, 'MONGO_OPLOG_URL stays until the measurement says it can go')
  const own = await configure({ SLATEBOX_SETTINGS: JSON.stringify({ packages: { mongo: { reactivity: ['polling'] } } }) })
  assert.equal(own.code, 0, own.log)
  assert.deepEqual(appSettings(own).packages.mongo.reactivity, ['polling'])
})

test('single sign-on: everyone it lets in joins the first team as a member by default; SLATEBOX_SSO_DEFAULT_ROLE=none and SLATEBOX_SSO_DOMAINS reach the app', async () => {
  const on = await configure({ SLATEBOX_SSO: 'keycloak' })
  assert.equal(on.code, 0, on.log)
  assert.equal(appSettings(on).sso.defaultRole, 'member')
  assert.equal(appSettings(on).sso.domains, undefined)
  assert.match(on.log, /SSO: +on, .*new people join the first team as members/)
  const strict = await configure({ SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_DEFAULT_ROLE: 'none', SLATEBOX_SSO_DOMAINS: 'Example.com,example.org' })
  assert.equal(strict.code, 0, strict.log)
  assert.equal(appSettings(strict).sso.defaultRole, 'none')
  assert.deepEqual(appSettings(strict).sso.domains, ['example.com', 'example.org'])
  assert.equal(appSettings(strict).public.sso.defaultRole, undefined, 'browsers get nothing new')
  assert.match(strict.log, /new people join a team only by invitation, email domains example\.com, example\.org/)
  for (const [env, message] of [
    [{ SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_DEFAULT_ROLE: 'owner' }, /SLATEBOX_SSO_DEFAULT_ROLE must be member or none/],
    [{ SLATEBOX_SSO_DEFAULT_ROLE: 'none' }, /SLATEBOX_SSO_DEFAULT_ROLE also needs SLATEBOX_SSO=keycloak/],
    [{ SLATEBOX_SSO: 'keycloak', SLATEBOX_SSO_DOMAINS: 'example.com;example.org' }, /SLATEBOX_SSO_DOMAINS: "example\.com;example\.org" is not a domain name/],
  ]) {
    const refused = await configure(env)
    assert.notEqual(refused.code, 0, JSON.stringify(env))
    assert.match(refused.log, message)
    assert.equal(refused.secretFiles, 0, 'nothing written')
  }
  const listed = JSON.parse(await ok(['run', '--rm', '--network', 'none', '-v', `${LIB}:/opt/slatebox/lib:ro`, '--entrypoint', 'node', IMAGE, '/opt/slatebox/lib/settings.mjs', '--json']))
  for (const name of ['SLATEBOX_SSO_DEFAULT_ROLE', 'SLATEBOX_SSO_DOMAINS']) assert.ok(listed.settings.includes(name), name)
})

// ------------------------------------------------------------------ team-address tunnel

// A well-formed Cloudflare Tunnel token (base64 of {a, t, s}) with made-up values.
const TUNNEL_SECRET = randomBytes(32).toString('base64')
const TUNNEL_TOKEN = Buffer.from(JSON.stringify({ a: 'f'.repeat(32), t: '0b4e2f1c-1111-4222-8333-944455556666', s: TUNNEL_SECRET })).toString('base64')

/** configure.mjs with a tunnel setting; returns the files cloudflared, Caddy, the app and the relay get. */
async function configureTunnel(env) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const show = file => `printf '%s' "$(cat ${file} 2>/dev/null)"; printf '${SEP}'`
  const script = [
    'node /opt/slatebox/lib/configure.mjs > /run/slatebox-test.log 2>&1; code=$?',
    `printf '%s${SEP}' "$code"`,
    `cat /run/slatebox-test.log; printf '${SEP}'`,
    show('/run/slatebox/tunnel.token'),
    `stat -c %a /run/slatebox/tunnel.token 2>/dev/null; printf '${SEP}'`,
    show('/run/slatebox/app.env'),
    show('/run/slatebox/relay.env'),
    show('/run/slatebox/Caddyfile'),
    show('/run/slatebox/state.env'),
  ].join('; ')
  const out = await ok(['run', '--rm', '--network', 'none', '--tmpfs', '/data:mode=1777', '--tmpfs', '/run:mode=1777',
    '-v', `${LIB}:/opt/slatebox/lib:ro`, ...envArgs, '--entrypoint', 'sh', IMAGE, '-c', script])
  const [code, log, token, tokenMode, app, relay, caddy, state] = out.split(SEP)
  return { code: Number(code), log, token, tokenMode: tokenMode.trim(), app, relay, caddy, state }
}

test('SLATEBOX_LICENSE / SLATEBOX_LICENSE_FILE: no longer needed, accepted and ignored with one line, never forwarded or printed', async () => {
  const key = `sblic1.slatebox-2026-11.${randomBytes(48).toString('base64url')}.${randomBytes(64).toString('base64url')}`
  const given = await configure({ SLATEBOX_LICENSE: key })
  assert.equal(given.code, 0, given.log)
  assert.equal(JSON.parse(given.app.settings).enterprise?.license, undefined, 'the key is not forwarded to the app')
  assert.match(given.log, /SLATEBOX_LICENSE ignored: no longer needed, integrations are free on every install/)
  assert.ok(!given.log.includes(key), 'the key is not in the log')
  // a missing file, a malformed key, or both set never stop the start any more
  const missing = await configure({ SLATEBOX_LICENSE_FILE: '/run/secrets/slatebox.license' })
  assert.equal(missing.code, 0, missing.log)
  assert.equal(JSON.parse(missing.app.settings).enterprise?.licenseFile, undefined)
  const wrong = await configure({ SLATEBOX_LICENSE: 'not-a-license-value-12345' })
  assert.equal(wrong.code, 0, wrong.log)
  assert.ok(!wrong.log.includes('not-a-license-value-12345'))
  const both = await configure({ SLATEBOX_LICENSE: key, SLATEBOX_LICENSE_FILE: '/etc/hostname' })
  assert.equal(both.code, 0, both.log)
  assert.match(both.log, /SLATEBOX_LICENSE and SLATEBOX_LICENSE_FILE ignored/)
  // with neither, no license line at all
  const none = await configure({})
  assert.equal(none.code, 0, none.log)
  assert.doesNotMatch(none.log, /License:/)
  // still accepted by name, so an installer that wrote one is not refused
  const listed = JSON.parse(await ok(['run', '--rm', '--network', 'none', '-v', `${LIB}:/opt/slatebox/lib:ro`, '--entrypoint', 'node', IMAGE, '/opt/slatebox/lib/settings.mjs', '--json']))
  for (const name of ['SLATEBOX_LICENSE', 'SLATEBOX_LICENSE_FILE']) assert.ok(listed.settings.includes(name), name)
})

test('a tunnel token: HTTPS off in Caddy, the visitor address kept, the token only in its 0600 file, never printed', async () => {
  const run = await configureTunnel({ SLATEBOX_URL: 'https://acme.slatebox.team', SLATEBOX_TUNNEL_TOKEN: TUNNEL_TOKEN })
  assert.equal(run.code, 0, run.log)
  assert.equal(run.token, TUNNEL_TOKEN)
  assert.equal(run.tokenMode, '600')
  assert.match(run.log, /Tunnel: +on, Cloudflare Tunnel 0b4e2f1c-1111-4222-8333-944455556666 for acme\.slatebox\.team/)
  assert.match(run.log, /HTTPS: +at Cloudflare, through the secure tunnel/)
  for (const where of [run.log, run.app, run.relay, run.caddy, run.state]) {
    assert.ok(!where.includes(TUNNEL_TOKEN) && !where.includes(TUNNEL_SECRET), 'the token is only in its own file')
  }
  assert.match(run.caddy, /auto_https off/)
  assert.match(run.caddy, /trusted_proxies static 127\.0\.0\.1\/32 ::1\/128/)
  assert.doesNotMatch(run.caddy, /^acme\.slatebox\.team \{/m, 'no certificate site')
  assert.match(run.app, /^HTTP_FORWARDED_COUNT='2'$/m)
  assert.match(run.app, /^ROOT_URL='https:\/\/acme\.slatebox\.team'$/m)
  assert.match(run.app, /"wsUrl":"wss:\/\/acme\.slatebox\.team\/live"/)
  assert.match(run.state, /^SLATEBOX_TUNNEL='1'$/m)
})

test('without a tunnel token nothing changes: no token file, one proxy hop, no trusted proxies', async () => {
  const run = await configureTunnel({})
  assert.equal(run.code, 0, run.log)
  assert.equal(run.token, '')
  assert.match(run.app, /^HTTP_FORWARDED_COUNT='1'$/m)
  assert.doesNotMatch(run.caddy, /trusted_proxies/)
  assert.match(run.state, /^SLATEBOX_TUNNEL='0'$/m)
  assert.match(run.log, /Tunnel: +off/)
})

test('a tunnel with SLATEBOX_HTTPS=auto, or with an http:// address, is refused', async () => {
  const auto = await configureTunnel({ SLATEBOX_URL: 'https://acme.slatebox.team', SLATEBOX_TUNNEL_TOKEN: TUNNEL_TOKEN, SLATEBOX_HTTPS: 'auto' })
  assert.equal(auto.code, 1)
  assert.match(auto.log, /SLATEBOX_HTTPS=auto cannot be used with SLATEBOX_TUNNEL_TOKEN/)
  const plain = await configureTunnel({ SLATEBOX_URL: 'http://localhost:7070', SLATEBOX_TUNNEL_TOKEN: TUNNEL_TOKEN })
  assert.equal(plain.code, 1)
  assert.match(plain.log, /SLATEBOX_URL is the tunnel's https:\/\/ address/)
  for (const run of [auto, plain]) assert.ok(!run.log.includes(TUNNEL_TOKEN))
})

test('a token that is not a Cloudflare Tunnel token is refused without printing it', async () => {
  const bad = 'not-a-tunnel-token-' + randomBytes(12).toString('hex')
  const run = await configureTunnel({ SLATEBOX_URL: 'https://acme.slatebox.team', SLATEBOX_TUNNEL_TOKEN: bad })
  assert.equal(run.code, 1)
  assert.match(run.log, /SLATEBOX_TUNNEL_TOKEN is not a Cloudflare Tunnel token \(received \d+ characters, not shown\)/)
  assert.ok(!run.log.includes(bad))
})
