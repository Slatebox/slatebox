import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { parseEnvFile } from '../src/secrets.mjs'
import { parse } from '../src/yaml.mjs'
import { cli, FakeDocker, ID, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:1'
const BASE = ['--image', IMAGE, '--ai', 'none', '--port', '17431', '--backups', 'off']

function setup(options) {
  const docker = new FakeDocker(options)
  docker.addImage(IMAGE)
  return { docker, home: sandbox() }
}

const ups = docker => docker.count(call => call.cmd === 'docker' && call.args[0] === 'compose' && call.args.includes('up'))
const everyLineIsJson = result => result.events.every(event => !event.unparsed)

test('agent mode never prompts: a missing answer is exit 3 with the question, its choices and its flag', async () => {
  const { docker, home } = setup()
  const result = await cli(['install', '--image', IMAGE], { run: docker.run, home, env: { AI_AGENT: '1' } })
  assert.equal(result.code, 3)
  assert.ok(everyLineIsJson(result))
  const error = result.events.at(-1)
  assert.equal(error.event, 'error')
  assert.deepEqual(error.missing.map(item => item.field), ['ai.mode'])
  assert.equal(error.missing[0].default, null)
  assert.match(error.missing[0].flag, /--ai-provider/)
  assert.equal(docker.calls.length, 0, 'nothing was run')
})

test('plan prints every file, command and port, and changes nothing', async () => {
  const { docker, home } = setup()
  const result = await cli(['plan', ...BASE, '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(everyLineIsJson(result))
  const plan = result.events.find(event => event.event === 'plan')
  assert.equal(plan.action, 'install')
  assert.equal(plan.address, 'http://localhost:17431')
  assert.deepEqual(plan.ports, ['127.0.0.1:17431:7070'], 'this computer only (review finding 3)')
  assert.ok(plan.files.some(file => file.path.endsWith('secrets.env')))
  assert.match(plan.secretsLocation, /secrets\.env on this computer \(mode 0600\)/)
  assert.equal(ups(docker), 0)
  assert.ok(!existsSync(join(home, 'installs', 'slatebox')), 'no files written')
})

test('without a person to ask, an install needs --yes (exit 3), and nothing is written', async () => {
  const { docker, home } = setup()
  const result = await cli(['install', ...BASE], { run: docker.run, home })
  assert.equal(result.code, 3)
  assert.match(result.stderr, /--yes/)
  assert.equal(ups(docker), 0)
  assert.ok(!existsSync(join(home, 'installs', 'slatebox', 'secrets.env')))
})

test('an exported SLATEBOX_INSTALL_YES does not count as --yes (review finding 4: consent is typed each time)', async () => {
  const { docker, home } = setup()
  const result = await cli(['install', ...BASE], { run: docker.run, home, env: { SLATEBOX_INSTALL_YES: '1' } })
  assert.equal(result.code, 3, result.stderr)
  assert.equal(ups(docker), 0)
})

test('install: secrets file 0600 with a generated key, a record without secrets, NDJSON with no secret in it', async () => {
  const { docker, home } = setup()
  const result = await cli(['install', ...BASE, '--yes', '--json', '--admin-email', 'ops@example.com'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(everyLineIsJson(result))
  const done = result.events.at(-1)
  assert.equal(done.event, 'done')
  assert.equal(done.address, 'http://localhost:17431')
  assert.equal(done.imageDigest, ID(IMAGE))
  assert.equal(done.keyGenerated, true)
  const dir = join(home, 'installs', 'slatebox')
  const secrets = parseEnvFile(readFileSync(join(dir, 'secrets.env'), 'utf8'))
  assert.equal(Buffer.from(secrets.SLATEBOX_KEY_ENCRYPTION_KEY, 'base64').length, 32)
  assert.equal(statSync(join(dir, 'secrets.env')).mode & 0o777, 0o600)
  const record = readFileSync(join(dir, 'install.yaml'), 'utf8')
  assert.ok(!record.includes(secrets.SLATEBOX_KEY_ENCRYPTION_KEY), 'the record holds no secret')
  assert.equal(parse(record).secretRefs.SLATEBOX_KEY_ENCRYPTION_KEY, 'generate')
  for (const text of [result.stdout, result.stderr, JSON.stringify(docker.calls.map(call => call.args))]) {
    assert.ok(!text.includes(secrets.SLATEBOX_KEY_ENCRYPTION_KEY), 'the key is never printed or passed as an argument')
  }
  assert.match(result.stderr, /Back it up with your password manager now/)
  assert.equal(ups(docker), 1)
  const compose = parse(readFileSync(join(dir, 'compose.yaml'), 'utf8'))
  assert.equal(compose.services.slatebox.image, ID(IMAGE))
})

test('a second install with the same answers changes nothing and keeps the key', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  const key = parseEnvFile(readFileSync(join(home, 'installs', 'slatebox', 'secrets.env'), 'utf8')).SLATEBOX_KEY_ENCRYPTION_KEY
  const again = await cli(['install', '--image', IMAGE, '--json'], { run: docker.run, home })
  assert.equal(again.code, 0, again.stderr)
  assert.equal(again.events.find(event => event.event === 'plan').action, 'nothing')
  assert.equal(again.events.at(-1).nothingToChange, true)
  assert.equal(ups(docker), 1, 'not started again')
  assert.equal(parseEnvFile(readFileSync(join(home, 'installs', 'slatebox', 'secrets.env'), 'utf8')).SLATEBOX_KEY_ENCRYPTION_KEY, key)
})

test('bad answers are exit 2 and name each field; unknown flags are exit 2', async () => {
  const { docker, home } = setup()
  const bad = await cli(['install', '--target', 'moon', '--ai', 'none', '--json'], { run: docker.run, home })
  assert.equal(bad.code, 2)
  assert.deepEqual(bad.events.at(-1).fields.map(field => field.field), ['target'])
  const unknown = await cli(['install', '--colour', 'blue', '--json'], { run: docker.run, home })
  assert.equal(unknown.code, 2)
  assert.equal(unknown.events.at(-1).exitCode, 2)
})

test('an answers file works like flags, and flags beat it', async () => {
  const { docker, home } = setup()
  const file = join(home, 'answers.yaml')
  writeFileSync(file, `version: 1\nimage: ${IMAGE}\nai: { mode: none }\naddress: { port: 17432 }\nbackups: { to: "off" }\n`)
  const result = await cli(['plan', '--answers', file, '--port', '17433', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.find(event => event.event === 'plan').address, 'http://localhost:17433')
})

test('ai add: the key comes from its reference into secrets.env only; the record keeps the reference', async () => {
  const { docker, home } = setup()
  await cli(['install', ...BASE, '--yes'], { run: docker.run, home })
  const key = 'di-key-0123456789'
  const result = await cli(['ai', 'add', 'kind=deepinfra,key=env:DEEPINFRA_API_KEY', '--yes', '--json'], { run: docker.run, home, env: { DEEPINFRA_API_KEY: key } })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(ups(docker), 2)
  const dir = join(home, 'installs', 'slatebox')
  assert.equal(parseEnvFile(readFileSync(join(dir, 'secrets.env'), 'utf8')).SLATEBOX_AI_KEY, key)
  const record = readFileSync(join(dir, 'install.yaml'), 'utf8')
  assert.ok(!record.includes(key))
  assert.match(record, /env:DEEPINFRA_API_KEY/)
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key))
  const two = await cli(['ai', 'add', 'id=local,kind=openai-compatible,url=http://ollama:11434/v1,model=qwen3:8b', '--ai-default', 'local', '--yes', '--json'], { run: docker.run, home })
  assert.equal(two.code, 2, 'this image takes one provider')
  assert.match(two.events.at(-1).message, /one AI provider/)
})

test('a multi-provider image gets one JSON list and a key variable per provider', async () => {
  const { docker, home } = setup({ settings: [...LEGACY_SETTINGS, 'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT'] })
  const result = await cli(['install', '--image', IMAGE, '--port', '17434', '--backups', 'off', '--yes',
    '--ai-provider', 'kind=openai,model=gpt-5-mini,key=env:OPENAI_API_KEY', '--ai-provider', 'id=local,kind=ollama,model=qwen3:8b', '--ai-default', 'local'],
  { run: docker.run, home, env: { OPENAI_API_KEY: 'sk-test-0123456789' } })
  assert.equal(result.code, 0, result.stderr)
  const dir = join(home, 'installs', 'slatebox')
  const settings = parseEnvFile(readFileSync(join(dir, 'slatebox.env'), 'utf8'))
  assert.deepEqual(JSON.parse(settings.SLATEBOX_AI_PROVIDERS).map(provider => provider.id), ['openai', 'local'])
  assert.equal(JSON.parse(settings.SLATEBOX_AI_PROVIDERS)[1].baseUrl, 'http://host.docker.internal:11434/v1')
  assert.equal(settings.SLATEBOX_AI_DEFAULT, 'local')
  assert.equal(parseEnvFile(readFileSync(join(dir, 'secrets.env'), 'utf8')).SLATEBOX_AI_KEY_OPENAI, 'sk-test-0123456789')
  assert.deepEqual(parse(readFileSync(join(dir, 'compose.yaml'), 'utf8')).services.slatebox.extra_hosts, ['host.docker.internal:host-gateway'])
})

test('upgrade to an image that never gets healthy: backup first, previous version back, its backup restored, exit 5', async () => {
  const { docker, home } = setup({ broken: ['slatebox-test:broken'] })
  docker.addImage('slatebox-test:broken')
  await cli(['install', ...BASE, '--yes'], { run: docker.run, home })
  const result = await cli(['upgrade', '--to', 'slatebox-test:broken', '--yes', '--json'], { run: docker.run, home })
  assert.equal(result.code, 5, result.stderr)
  const dir = join(home, 'installs', 'slatebox')
  assert.equal(parse(readFileSync(join(dir, 'compose.yaml'), 'utf8')).services.slatebox.image, ID(IMAGE), 'the previous image is back')
  const backup = docker.calls.findIndex(call => call.args.includes('backup'))
  const restore = docker.calls.findIndex(call => call.args.includes('restore'))
  assert.ok(backup > 0 && restore > backup, 'backed up before, restored after')
  assert.ok(existsSync(join(dir, 'backups', `pre-upgrade-${ID(IMAGE).slice(7, 19)}-${ID('slatebox-test:broken').slice(7, 19)}.gz`)))
  assert.equal(docker.containers.get('slatebox').health, 'healthy')
  assert.equal(result.events.at(-1).exitCode, 5)
})

test('upgrade without a newer image is nothing to change; an unavailable image is exit 4', async () => {
  const { docker, home } = setup()
  await cli(['install', ...BASE, '--yes'], { run: docker.run, home })
  const same = await cli(['upgrade', '--to', IMAGE, '--json'], { run: docker.run, home })
  assert.equal(same.code, 0, same.stderr)
  assert.equal(same.events.at(-1).nothingToChange, true)
  // The public image cannot be fetched (unreachable here, and not on this host): exit 4 with what to do.
  const missing = await cli(['upgrade', '--to', 'ghcr.io/slatebox/slatebox:latest', '--yes', '--json'], { run: docker.run, home })
  assert.equal(missing.code, 4)
  assert.match(missing.events.at(-1).message, /needs no login: check that this machine can reach ghcr\.io/)
  assert.doesNotMatch(missing.events.at(-1).message, /not published/)
})

test('uninstall keeps the data volume and the key; deleting data needs the name typed back', async () => {
  const { docker, home } = setup()
  await cli(['install', ...BASE, '--yes'], { run: docker.run, home })
  const refused = await cli(['uninstall', '--delete-data', '--yes', '--json'], { run: docker.run, home })
  assert.equal(refused.code, 3)
  assert.ok(docker.volumes.has('slatebox-data'))
  const kept = await cli(['uninstall', '--yes', '--json'], { run: docker.run, home })
  assert.equal(kept.code, 0, kept.stderr)
  assert.ok(docker.volumes.has('slatebox-data'))
  assert.ok(existsSync(join(home, 'installs', 'slatebox', 'secrets.env')))
  assert.equal(docker.count(call => call.args[0] === 'volume' && call.args[1] === 'rm'), 0)
  const deleted = await cli(['uninstall', '--delete-data', '--confirm', 'slatebox', '--yes', '--json'], { run: docker.run, home })
  assert.equal(deleted.code, 0, deleted.stderr)
  assert.ok(!docker.volumes.has('slatebox-data'))
  assert.ok(!existsSync(join(home, 'installs', 'slatebox')))
})

test('secrets are never revealed into JSON or a pipe', async () => {
  const { docker, home } = setup()
  await cli(['install', ...BASE, '--yes'], { run: docker.run, home })
  const json = await cli(['secrets', 'reveal', 'SLATEBOX_KEY_ENCRYPTION_KEY', '--json'], { run: docker.run, home })
  assert.equal(json.code, 2)
  const pipe = await cli(['secrets', 'reveal', 'SLATEBOX_KEY_ENCRYPTION_KEY'], { run: docker.run, home })
  assert.equal(pipe.code, 2)
  const path = await cli(['secrets', 'path'], { run: docker.run, home })
  assert.match(path.stdout, /secrets\.env/)
})

test('the crontab keeps every line that is not the installer\'s own', async () => {
  const { docker, home } = setup()
  docker.crontab = '# mine\n\n5 4 * * * /usr/bin/true\n'
  await cli(['install', '--image', IMAGE, '--ai', 'none', '--port', '17435', '--yes'], { run: docker.run, home })
  assert.match(docker.crontab, /^# mine\n\n5 4 \* \* \* \/usr\/bin\/true\n0 3 \* \* \* \/bin\/sh .*backup\.sh.*# slatebox-installer:slatebox\n$/)
  await cli(['uninstall', '--yes'], { run: docker.run, home })
  assert.equal(docker.crontab, '# mine\n\n5 4 * * * /usr/bin/true\n')
})

test('export writes compose files with placeholders and touches no host', async () => {
  const { docker, home } = setup()
  const dir = join(home, 'out')
  const result = await cli(['install', 'export', '--image', IMAGE, '--ai', 'none', '--out', dir, '--domain', 'boards.example.com', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(existsSync(join(dir, 'compose.yaml')))
  assert.match(readFileSync(join(dir, 'secrets.env.example'), 'utf8'), /SLATEBOX_KEY_ENCRYPTION_KEY='<32 random bytes/)
  assert.deepEqual(parse(readFileSync(join(dir, 'compose.yaml'), 'utf8')).services.slatebox.ports, ['80:80', '443:443'])
  assert.equal(ups(docker), 0)
})

test('agent-prompt prints the brief an agent follows', async () => {
  const result = await cli(['agent-prompt'], { home: sandbox() })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /slatebox@latest plan --answers slatebox\.yaml --json/)
  assert.match(result.stdout, /get an explicit yes/)
})
