// `slatebox updates`: the host updater set up after an install (unless --no-auto-updates), on an
// image that has it; enable / disable; uninstall takes it away; help lists it; Kubernetes is
// notify-only for now.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse } from '../src/yaml.mjs'
import { cli, FakeDocker, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:1'
const BASE = ['--image', IMAGE, '--ai', 'none', '--port', '17431', '--backups', 'off']

function world({ updates = true, platform = 'linux', endpoint = null, platformName = null, auto = true } = {}) {
  const docker = new FakeDocker()
  if (endpoint) docker.endpoint = endpoint
  if (platformName) docker.platformName = platformName
  docker.addImage(IMAGE)
  const inContainer = []
  const run = async (cmd, args, options) => {
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('settings') && args.includes('--json')) {
      return updates ? { code: 0, stdout: `${JSON.stringify({ settings: [], commands: ['backup', 'health', 'version', 'settings', 'updates'] })}\n`, stderr: '' } : { code: 2, stdout: '', stderr: 'Usage' }
    }
    if (cmd === 'docker' && args[0] === 'exec' && args.includes('updates')) {
      inContainer.push(args.slice(args.indexOf('updates') + 1))
      if (args.includes('status')) return { code: 0, stdout: `${JSON.stringify({ current: '2.1.0', mode: 'auto', policy: { auto, channel: 'stable', window: { start: '04:00', hours: 2 }, timeZone: 'UTC' }, available: '2.2.0', words: 'Updating to 2.2.0 in the next window.', updater: null })}\n`, stderr: '' }
      return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
    }
    return docker.run(cmd, args, options)
  }
  return { docker, run, inContainer, home: sandbox(), platform }
}

test('help lists slatebox updates; "update" is the same word', async () => {
  const w = world()
  const help = await cli(['help'], { run: w.run, home: w.home })
  assert.match(help.stdout, /slatebox updates \[enable \| disable/)
  await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: w.run, home: w.home, platform: 'linux' })
  const alias = await cli(['update', 'status', '--json'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(alias.code, 0, alias.stderr)
  assert.equal(alias.events.at(-1).available, '2.2.0')
})

test('an install on an image with updates sets up the host updater (cron on Linux) and says so', async () => {
  const w = world()
  const result = await cli(['install', ...BASE, '--yes'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(result.code, 0, result.stderr)
  const dir = join(w.home, 'installs', 'slatebox')
  assert.ok(existsSync(join(dir, 'updater.sh')))
  assert.match(w.docker.crontab, /\*\/5 \* \* \* \* \/bin\/sh .*updater\.sh.* # slatebox-installer-updater:slatebox/)
  assert.deepEqual(w.inContainer[0].slice(0, 5), ['heartbeat', '--updater', '1', '--scheduler', 'cron'])
  assert.equal(parse(readFileSync(join(dir, 'install.yaml'), 'utf8')).updates.enabled, true)
  assert.match(result.stdout, /Automatic updates: the host updater runs by cron/)
})

test('--no-auto-updates: nothing scheduled; an image without updates: nothing scheduled, no error', async () => {
  const w = world()
  await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: w.run, home: w.home, platform: 'linux' })
  assert.ok(!existsSync(join(w.home, 'installs', 'slatebox', 'updater.sh')))
  const old = world({ updates: false })
  const result = await cli(['install', ...BASE, '--yes'], { run: old.run, home: old.home, platform: 'linux' })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(!existsSync(join(old.home, 'installs', 'slatebox', 'updater.sh')))
  assert.match(result.stdout + result.stderr, /no automatic updates yet .*npx slatebox@latest upgrade/, 'says what to do next')
  const enable = await cli(['updates', 'enable', '--json'], { run: old.run, home: old.home, platform: 'linux' })
  assert.equal(enable.code, 4)
  assert.match(enable.events.at(-1).message, /Run slatebox upgrade first/)
})

test('on a Mac: a launchd agent every five minutes, and the updater reaches the port through host.docker.internal', async () => {
  const w = world()
  const result = await cli(['install', ...BASE, '--yes'], { run: w.run, home: w.home, platform: 'darwin', io: { uid: 501 } })
  assert.equal(result.code, 0, result.stderr)
  const plist = join(w.home, 'Library', 'LaunchAgents', 'com.slatebox.slatebox.updater.plist')
  assert.match(readFileSync(plist, 'utf8'), /<key>StartInterval<\/key><integer>300<\/integer>/)
  assert.ok(w.docker.agents.has('com.slatebox.slatebox.updater'))
  assert.match(readFileSync(join(w.home, 'installs', 'slatebox', 'updater.sh'), 'utf8'), /--outside-url '?http:\/\/host\.docker\.internal:17431/)
})

test('disable takes the schedule and script away and remembers it; enable puts them back', async () => {
  const w = world()
  await cli(['install', ...BASE, '--yes'], { run: w.run, home: w.home, platform: 'linux' })
  const off = await cli(['updates', 'disable'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(off.code, 0, off.stderr)
  assert.doesNotMatch(w.docker.crontab || '', /slatebox-installer-updater/)
  const dir = join(w.home, 'installs', 'slatebox')
  assert.ok(!existsSync(join(dir, 'updater.sh')))
  assert.equal(parse(readFileSync(join(dir, 'install.yaml'), 'utf8')).updates.enabled, false)
  // An upgrade does not turn it back on by itself.
  const on = await cli(['updates', 'enable'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(on.code, 0, on.stderr)
  assert.match(w.docker.crontab, /slatebox-installer-updater:slatebox/)
})

test('auto on|off and check go to the container; apply asks for the update and runs the updater', async () => {
  const w = world()
  await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal((await cli(['updates', 'auto', 'off'], { run: w.run, home: w.home, platform: 'linux' })).code, 0)
  assert.equal((await cli(['updates', 'check'], { run: w.run, home: w.home, platform: 'linux' })).code, 0)
  const asked = await cli(['updates', 'apply', '--to', '2.2.0'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(asked.code, 0, asked.stderr)
  assert.match(asked.stdout, /host updater is not set up/)
  assert.deepEqual(w.inContainer.map(args => args[0]), ['auto', 'check', 'request'])
  assert.deepEqual(w.inContainer[2], ['request', 'apply', '--version', '2.2.0'])
  assert.equal((await cli(['updates', 'auto', 'maybe'], { run: w.run, home: w.home, platform: 'linux' })).code, 2)
})

test('uninstall removes the updater\'s cron line and leaves everyone else\'s', async () => {
  const w = world()
  w.docker.crontab = '0 1 * * * /usr/bin/mine\n'
  await cli(['install', ...BASE, '--yes'], { run: w.run, home: w.home, platform: 'linux' })
  assert.match(w.docker.crontab, /slatebox-installer-updater/)
  const gone = await cli(['uninstall', '--yes'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(gone.code, 0, gone.stderr)
  assert.equal(w.docker.crontab, '0 1 * * * /usr/bin/mine\n')
})

test('rootless Docker: the updater gets its socket; Podman: refused with what to do instead', async () => {
  const rootless = world({ endpoint: 'unix:///run/user/1000/docker.sock' })
  const result = await cli(['install', ...BASE, '--yes'], { run: rootless.run, home: rootless.home, platform: 'linux' })
  assert.equal(result.code, 0, result.stderr)
  const script = readFileSync(join(rootless.home, 'installs', 'slatebox', 'updater.sh'), 'utf8')
  assert.match(script, /^socket=\/run\/user\/1000\/docker\.sock$/m)
  assert.match(script, /^user=0:0$/m)
  const podman = world({ platformName: 'Podman Engine' })
  await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: podman.run, home: podman.home, platform: 'linux' })
  const enable = await cli(['updates', 'enable', '--json'], { run: podman.run, home: podman.home, platform: 'linux' })
  assert.equal(enable.code, 4)
  assert.match(enable.events.at(-1).message, /need Docker Engine.*Podman/)
  assert.ok(!existsSync(join(podman.home, 'installs', 'slatebox', 'updater.sh')))
})

test('an SSH install: the laptop takes the image the host updater put on the server; the server takes the laptop\'s updater setting', async () => {
  const { syncServerRecord } = await import('../src/targets/docker.mjs')
  const { recordText, readRecord, writeRecord } = await import('../src/record.mjs')
  const home = sandbox()
  const ssh = { host: 'box', port: 22, user: 'root', dir: '/opt/slatebox/slatebox', options: [], identity: null }
  const laptop = { name: 'slatebox', target: 'ssh', ssh, imageDigest: 'ghcr.io/slatebox/slatebox@sha256:old', previousImageDigest: null, lastHealthy: '2026-11-01T00:00:00.000Z', updates: { enabled: true, scheduler: 'systemd' } }
  writeRecord(home, laptop)
  let serverText = recordText({ ...laptop, imageDigest: 'ghcr.io/slatebox/slatebox@sha256:new', previousImageDigest: 'sha256:old', lastHealthy: '2026-11-25T04:10:00.000Z', updatedBy: 'auto-updater', version: '2.1.0', updates: undefined })
  const run = async (cmd, args, options = {}) => {
    if (cmd !== 'ssh') return { code: 127, stdout: '', stderr: '' }
    const command = args.at(-1)
    if (args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    if (command.includes('id -u')) return { code: 0, stdout: 'root\n', stderr: '' }
    if (command.includes('cat > ')) { serverText = options.input; return { code: 0, stdout: '', stderr: '' } }
    if (command.includes('install.yaml')) return { code: 0, stdout: serverText, stderr: '' }
    return { code: 1, stdout: '', stderr: 'unexpected' }
  }
  const steps = []
  const ctx = { home, env: {}, run, platform: 'linux', out: { step: (...a) => steps.push(a), say() {}, warn() {}, event() {}, debug() {} } }
  const next = await syncServerRecord(ctx, laptop)
  assert.equal(next.imageDigest, 'ghcr.io/slatebox/slatebox@sha256:new')
  assert.equal(next.previousImageDigest, 'sha256:old')
  assert.equal(readRecord(home, 'slatebox').imageDigest, 'ghcr.io/slatebox/slatebox@sha256:new', 'the laptop copy is written')
  assert.deepEqual(parse(serverText).updates, { enabled: true, scheduler: 'systemd' }, 'the server copy carries the updater setting')
  assert.equal(parse(serverText).imageDigest, 'ghcr.io/slatebox/slatebox@sha256:new', 'and keeps what runs')
  // Unreachable: the record as it was, no error.
  const offline = await syncServerRecord({ ...ctx, run: async () => ({ code: 255, stdout: '', stderr: 'Connection refused' }) }, laptop)
  assert.equal(offline, laptop)
})

test('a server with data from before: enable says applying is off and how to turn it on', async () => {
  const w = world({ auto: false })
  await cli(['install', ...BASE, '--yes', '--no-auto-updates'], { run: w.run, home: w.home, platform: 'linux' })
  const on = await cli(['updates', 'enable'], { run: w.run, home: w.home, platform: 'linux' })
  assert.equal(on.code, 0, on.stderr)
  assert.match(on.stdout, /not applied by themselves yet .* npx slatebox updates auto on/)
})
