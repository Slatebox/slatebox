// This computer, real Docker, a real image: install, re-run, AI from inside the
// container, backup and restore, an upgrade that fails and rolls back with the
// data intact, status, uninstall that keeps data, then delete.
//
//   SLATEBOX_IMAGE=<local image> node --test --test-concurrency=1 test/integration/local.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { parseEnvFile } from '../../src/secrets.mjs'
import { available, buildTestImages, cleanup, docker, fakeAiEndpoint, freePort, home as makeHome, RUN_ID, slatebox, track } from './lib.mjs'

const skip = !available() && 'set SLATEBOX_IMAGE to a local one-container image'
const name = `${RUN_ID}-local`
let images, home, port, env

before(async () => {
  if (skip) return
  images = buildTestImages()
  home = makeHome()
  port = await freePort()
  env = { SLATEBOX_INSTALL_HOME: home }
  track.container(name)
  track.volume(`${name}-data`)
})
after(() => { if (!skip) cleanup() })

function marker(action) {
  const body = action === 'write'
    ? "await col.insertOne({ _id: 'marker', at: new Date() })"
    : "process.stdout.write(String(await col.countDocuments({ _id: 'marker' })))"
  const script = `const { mongodb } = await import('/opt/slatebox/lib/common.mjs'); const c = new (mongodb().MongoClient)(process.env.MONGO_URL); await c.connect(); const col = c.db().collection('installer_marker'); ${body}; await c.close()`
  return docker(['exec', '-i', name, 'sh', '-c', 'set -a; . /run/slatebox/app.env; set +a; exec node --input-type=module -'], { input: script })
}

const secretsFile = () => join(home, 'installs', name, 'secrets.env')

// Restated (the one-container image on prod accepts SLATEBOX_KEY_ENCRYPTION_KEY and lists its settings): the plan
// reads what the image accepts from the image itself, and warns about own keys only for an image without the key.
// (The warning for an older image is pinned in render.test.mjs.)
test('the plan reads what the image accepts from the image: own keys on when it takes SLATEBOX_KEY_ENCRYPTION_KEY', { skip }, async () => {
  const result = await slatebox(['plan', '--name', name, '--image', images.base, '--ai', 'none', '--port', String(port), '--backups', 'off', '--json'], { env })
  assert.equal(result.code, 0, result.stderr)
  const plan = result.events.find(event => event.event === 'plan')
  const listed = JSON.parse(docker(['run', '--rm', '--network', 'none', '--entrypoint', '/opt/slatebox/bin/slatebox', images.base, 'settings', '--json']).stdout)
  if (listed.settings.includes('SLATEBOX_KEY_ENCRYPTION_KEY')) assert.doesNotMatch(plan.warnings.join('\n'), /does not accept SLATEBOX_KEY_ENCRYPTION_KEY/)
  else assert.match(plan.warnings.join('\n'), /does not accept SLATEBOX_KEY_ENCRYPTION_KEY/)
})

test('install as an agent would: healthy, answering, the key generated and kept out of every output', { skip, timeout: 900_000 }, async () => {
  const result = await slatebox(['install', '--name', name, '--image', images.current, '--ai', 'none', '--port', String(port),
    '--admin-email', 'ops@example.com', '--backups', 'off', '--yes', '--json', '--agent', 'yes'], { env })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(result.events.every(event => !event.unparsed), 'stdout is NDJSON throughout')
  const done = result.events.at(-1)
  assert.equal(done.event, 'done')
  assert.equal(done.address, `http://localhost:${port}`)
  const response = await fetch(`${done.address}/readyz`)
  assert.equal((await response.json()).ok, true)
  assert.equal(docker(['inspect', '--format', '{{.State.Health.Status}}', name]).stdout.trim(), 'healthy')
  const key = parseEnvFile(readFileSync(secretsFile(), 'utf8')).SLATEBOX_KEY_ENCRYPTION_KEY
  assert.equal(Buffer.from(key, 'base64').length, 32)
  assert.equal(statSync(secretsFile()).mode & 0o777, 0o600)
  assert.match(docker(['logs', name]).stdout, /Own keys: +on/)
  const record = readFileSync(join(home, 'installs', name, 'install.yaml'), 'utf8')
  for (const text of [result.stdout, result.stderr, record, docker(['logs', name]).stdout + docker(['logs', name]).stderr]) {
    assert.ok(!text.includes(key), 'the key appears nowhere but the secrets file')
  }
  assert.equal(marker('write').code, 0)
})

test('the same install again: nothing to change, same container, same key', { skip, timeout: 300_000 }, async () => {
  const id = docker(['inspect', '--format', '{{.Id}}', name]).stdout.trim()
  const key = readFileSync(secretsFile(), 'utf8')
  const result = await slatebox(['install', '--name', name, '--image', images.current, '--json'], { env })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.at(-1).nothingToChange, true)
  assert.equal(docker(['inspect', '--format', '{{.Id}}', name]).stdout.trim(), id)
  assert.equal(readFileSync(secretsFile(), 'utf8'), key)
})

test('an AI endpoint on this computer: added, reached from inside the container, tested there', { skip, timeout: 900_000 }, async () => {
  const endpoint = await fakeAiEndpoint()
  try {
    const added = await slatebox(['ai', 'add', `id=local,kind=openai-compatible,url=http://localhost:${endpoint.port}/v1,model=fake-model`, '--name', name, '--yes', '--json'], { env })
    assert.equal(added.code, 0, added.stderr)
    const settings = parseEnvFile(readFileSync(join(home, 'installs', name, 'slatebox.env'), 'utf8'))
    // Restated (the image takes several providers): the endpoint is written in SLATEBOX_AI_PROVIDERS, not SLATEBOX_AI_URL.
    const providers = JSON.parse(settings.SLATEBOX_AI_PROVIDERS)
    assert.deepEqual(providers.map(provider => [provider.id, provider.baseUrl, provider.model]), [['local', `http://host.docker.internal:${endpoint.port}/v1`, 'fake-model']])
    assert.match(docker(['logs', name]).stdout, new RegExp(`AI drafts: on, using host\\.docker\\.internal:${endpoint.port}`))
    const tested = await slatebox(['ai', 'test', '--name', name, '--json'], { env })
    assert.equal(tested.code, 0, tested.stderr)
    const report = tested.events.at(-1)
    assert.deepEqual(report.models, ['fake-model'])
    assert.equal(report.toolCalls, true)
    assert.equal(report.toolChoiceHonoured, true)
    assert.ok(endpoint.seen.some(request => request.url === '/v1/chat/completions'), 'the request came from the container')
    assert.equal(marker('read').stdout, '1', 'data survived the recreate')
  } finally {
    await endpoint.close()
  }
})

test('backup and restore through the CLI', { skip, timeout: 900_000 }, async () => {
  const backup = await slatebox(['backup', '--name', name, '--json'], { env })
  assert.equal(backup.code, 0, backup.stderr)
  const file = backup.events.at(-1).file
  assert.ok(existsSync(file))
  assert.equal(readFileSync(file).subarray(0, 2).toString('hex'), '1f8b', 'a gzip archive')
  assert.equal(marker('write').code !== 0, true, 'the marker is already there (duplicate key)')
  const restored = await slatebox(['restore', file, '--name', name, '--yes', '--json'], { env })
  assert.equal(restored.code, 0, restored.stderr)
  assert.equal(marker('read').stdout, '1')
})

test('an upgrade that never gets healthy: backed up first, rolled back, data intact, exit 5', { skip, timeout: 1_200_000 }, async () => {
  const before = docker(['inspect', '--format', '{{.Image}}', name]).stdout.trim()
  const result = await slatebox(['upgrade', '--name', name, '--to', images.broken, '--yes', '--json', '--health-timeout', '75'], { env })
  assert.equal(result.code, 5, result.stderr)
  assert.equal(result.events.at(-1).exitCode, 5)
  assert.equal(docker(['inspect', '--format', '{{.Image}}', name]).stdout.trim(), before, 'the previous image is running')
  assert.equal(docker(['inspect', '--format', '{{.State.Health.Status}}', name]).stdout.trim(), 'healthy')
  assert.equal(marker('read').stdout, '1', 'the data is intact')
  assert.ok(result.events.some(event => event.id === 'backup' && event.status === 'ok'), 'backed up before the upgrade')
  assert.ok(result.events.some(event => event.id === 'rollback' && event.status === 'ok'))
})

test('status reports health, version and AI', { skip, timeout: 120_000 }, async () => {
  const result = await slatebox(['status', '--name', name, '--json'], { env })
  assert.equal(result.code, 0, result.stderr)
  const status = result.events.at(-1)
  assert.equal(status.health, 'healthy')
  assert.equal(status.ai, 'local')
  assert.ok(status.version.app)
  assert.match(status.lastBackup, /^slatebox-.*\.gz$|pre-upgrade/)
})

test('uninstall keeps the data; delete-data removes it', { skip, timeout: 300_000 }, async () => {
  const kept = await slatebox(['uninstall', '--name', name, '--yes', '--json'], { env })
  assert.equal(kept.code, 0, kept.stderr)
  assert.notEqual(docker(['inspect', name]).code, 0, 'the container is gone')
  assert.equal(docker(['volume', 'inspect', `${name}-data`]).code, 0, 'the volume is kept')
  assert.ok(existsSync(secretsFile()), 'the key is kept with it')
  const deleted = await slatebox(['uninstall', '--name', name, '--delete-data', '--confirm', name, '--yes', '--json'], { env })
  assert.equal(deleted.code, 0, deleted.stderr)
  assert.notEqual(docker(['volume', 'inspect', `${name}-data`]).code, 0)
})
