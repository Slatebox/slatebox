// The published-installer end-to-end run (npx slatebox@0.2.0, image 0.2.1, against a real
// Slatebox Cloud) found these; each test failed on 0.2.0 and holds the fix:
//   1. a machine without the image could not install a team address (the plan refused it on the
//      oldest image's settings instead of pulling the pinned image and reading its own);
//   2. on macOS the backup schedule hung at `crontab -` (a permission prompt) before the setup link
//      was printed, then warned with an empty reason;
//   3. `--team-address acme --yes` asked questions at a terminal, and exited 3 for ai.mode in an
//      agent shell;
//   6. `remove --delete-data` left an empty ~/.slatebox/installs behind.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { HELP } from '../src/cli.mjs'
import * as image from '../src/image.mjs'
import { readRecord } from '../src/record.mjs'
import { cli, FakeCloud, FakeDocker, sandbox } from './fakes.mjs'

const { DEFAULT_IMAGE } = image
const TUNNEL_SETTINGS = [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN']

/** A machine that has never pulled the image: the registry has it, this Docker does not. */
function fresh({ settings = TUNNEL_SETTINGS, commands = ['tunnel', 'setup-link'], cloud: cloudOptions } = {}) {
  const docker = new FakeDocker({ settings, commands })
  docker.registry.set(DEFAULT_IMAGE, 'v0.2.1')
  const cloud = new FakeCloud(cloudOptions)
  const home = sandbox()
  // One timeline for Docker and the Cloud, to check what happens before what.
  const timeline = []
  const run = async (cmd, args, options) => {
    if (cmd === 'docker' && args[0] === 'pull') timeline.push('pull')
    return docker.run(cmd, args, options)
  }
  const fetch = async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST' && new URL(url).pathname === '/api/v1/team-addresses') timeline.push('claim')
    return cloud.fetch(url, init)
  }
  const go = (argv, extra = {}) => cli(argv, {
    run: extra.run || run, home, fetch, platform: 'linux', env: { SLATEBOX_CLOUD_URL: cloud.base, ...extra.env },
    tty: extra.tty, input: extra.input,
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: extra.openBrowser || (() => { throw new Error('no browser in tests') }), teamHealthDelay: 1, teamHealthAttempts: 3, ...extra.io },
  })
  return { docker, cloud, home, go, timeline, dir: join(home, 'installs', 'slatebox') }
}

const BASE = ['--ai', 'none', '--backups', 'off', '--port', '17490']

// ------------------------------------------------------------------ 1. the image is not here yet

test('1: a team-address plan on a machine without the image is the real plan: not refused, nothing pulled', async () => {
  const { docker, go } = fresh()
  const result = await go(['plan', '--team-address', 'acme', ...BASE, '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /does not support a team address/)
  const plan = result.events.find(event => event.event === 'plan')
  assert.equal(plan.image.pinned, DEFAULT_IMAGE)
  assert.match(plan.notes.join('\n'), /downloaded after you confirm, and checked before anything is claimed/)
  assert.equal(docker.count(call => call.args[0] === 'pull'), 0, 'a plan pulls nothing')
})

test('1: install with --yes downloads the pinned image (with progress) before the claim, then installs', async () => {
  const { go, timeline, cloud, docker } = fresh()
  const result = await go(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(timeline, ['pull', 'claim'], 'the image first: nobody claims a name for an image that cannot be had')
  const steps = result.events.filter(event => event.event === 'step' && event.id === 'image')
  assert.match(steps[0].detail, /^Downloading ghcr\.io\/slatebox\/slatebox@sha256:/)
  assert.equal(steps.at(-1).status, 'ok')
  assert.equal(cloud.claims.size, 1)
  assert.ok(docker.containers.get('slatebox')?.running)
})

test('1: offline, the download fails with a plain reason, and nothing is claimed or written', async () => {
  const { go, cloud, dir, docker } = fresh()
  const offline = async (cmd, args, options) => (cmd === 'docker' && args[0] === 'pull')
    ? { code: 1, stdout: '', stderr: 'Error response from daemon: Get "https://ghcr.io/v2/": dial tcp: lookup ghcr.io: no such host\n' }
    : docker.run(cmd, args, options)
  const result = await go(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { run: offline })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /cannot reach ghcr\.io .*no such host.*Check the internet connection/s)
  assert.equal(result.events.at(-1).offline, true)
  assert.equal(cloud.claims.size, 0)
  assert.equal(cloud.cloudRequests('/oauth/device_authorization').length, 0, 'no sign-in was started')
  assert.ok(!existsSync(join(dir, 'slatebox.env')))
})

test('1: an image that turns out not to support a team address is refused after the download, before any claim', async () => {
  const { go, cloud, docker } = fresh({ settings: LEGACY_SETTINGS, commands: [] })
  docker.registry.set('registry.example.com/sb/old:1', 'old')
  const result = await go(['install', '--team-address', 'acme', '--image', 'registry.example.com/sb/old:1', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /does not support a team address/)
  assert.equal(docker.count(call => call.args[0] === 'pull'), 1)
  assert.equal(cloud.claims.size, 0)
})

test('1: the pinned image\'s settings are a subset of what the image source accepts', () => {
  const source = new URL('../../../self-host/rootfs/opt/slatebox/lib/settings.mjs', import.meta.url)
  if (!existsSync(source)) return // the published package has no image source next to it
  const text = readFileSync(source, 'utf8')
  const PINNED_CAPABILITIES = image.PINNED_CAPABILITIES
  assert.ok(PINNED_CAPABILITIES, 'the installer knows what its pinned image accepts')
  for (const name of PINNED_CAPABILITIES.settings) assert.match(text, new RegExp(`'${name}'`), name)
  for (const name of PINNED_CAPABILITIES.commands) assert.match(text, new RegExp(`'${name}'`), name)
  assert.ok(PINNED_CAPABILITIES.settings.includes('SLATEBOX_TUNNEL_TOKEN'))
})

// ------------------------------------------------------------------ 2. backups never hang

const LOCAL = ['--image', 'slatebox-test:1', '--ai', 'none', '--port', '17491']
function local({ platform = 'linux' } = {}) {
  const docker = new FakeDocker({ commands: ['setup-link'] })
  docker.addImage('slatebox-test:1')
  const home = sandbox()
  const go = (argv, extra = {}) => cli(argv, { run: docker.run, home, platform, env: extra.env, io: { uid: 501, schedulerTimeout: 50, ...extra.io } })
  return { docker, home, go }
}

test('2: on macOS the daily backup is a launchd agent: no crontab, no permission prompt', async () => {
  const { docker, home, go } = local({ platform: 'darwin' })
  const plan = await go(['plan', ...LOCAL, '--json'])
  assert.match(plan.events.find(event => event.event === 'plan').notes.join('\n'), /launchd agent/)
  const result = await go(['install', ...LOCAL, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(docker.count(call => call.cmd === 'crontab' && call.args[0] === '-'), 0, 'the crontab is never written on a Mac')
  const plist = join(home, 'Library', 'LaunchAgents', 'com.slatebox.slatebox.backup.plist')
  const text = readFileSync(plist, 'utf8')
  assert.match(text, /<key>Hour<\/key><integer>3<\/integer>/)
  assert.match(text, /<key>Minute<\/key><integer>0<\/integer>/)
  assert.match(text, /<string>\/bin\/sh<\/string><string>[^<]*backup\.sh<\/string>/)
  assert.deepEqual(docker.launchctl.find(args => args[0] === 'bootstrap'), ['bootstrap', 'gui/501', plist])
  assert.match(result.stdout, /Daily backups by a launchd agent/)
  // Uninstall takes it out again.
  const removed = await go(['uninstall', '--yes'])
  assert.equal(removed.code, 0, removed.stderr)
  assert.ok(!existsSync(plist))
  assert.equal(docker.agents.size, 0)
})

test('2: a scheduler that hangs is stopped after its timeout; the address and setup link come first', { timeout: 10_000 }, async () => {
  const { docker, go } = local()
  docker.crontabFails = 'hang'
  const result = await go(['install', ...LOCAL, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  const running = result.stdout.indexOf('Slatebox is running at')
  const setup = result.stdout.indexOf('slatebox setup-link')
  const warned = result.stdout.indexOf('The backup schedule could not be set up')
  assert.ok(running >= 0 && setup > running, result.stdout)
  assert.ok(warned > setup, 'the setup link is printed before the backup schedule is tried')
  assert.match(result.stdout, /could not be set up \(crontab did not finish within 0.05s and was stopped\)/)
  assert.equal(result.stdout.split('Slatebox is running at').length, 2, 'the address is printed once')
})

test('2: a scheduler that fails without a message still gets a reason', async () => {
  const { docker, go } = local()
  docker.crontabFails = 'silent'
  const result = await go(['install', ...LOCAL, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /could not be set up \(crontab exited with code 1 without saying why\)/)
  assert.doesNotMatch(result.stdout, /\(crontab: \)/)
})

// ------------------------------------------------------------------ 3. --yes asks nothing

test('3: --team-address acme --yes at a terminal asks no question: defaults for the rest, AI off, the browser opened', async () => {
  const opened = []
  const { go, home, cloud } = fresh()
  // Nothing typed: any question would read end-of-input and cancel (exit 7).
  const result = await go(['install', '--team-address', 'acme', '--yes'], { tty: true, input: '', openBrowser: url => opened.push(url) })
  assert.equal(result.code, 0, result.stderr)
  assert.doesNotMatch(result.stderr, /^\? /m, 'no question was asked')
  assert.deepEqual(opened, [`${cloud.base}/device?code=WDJB-MJHT`])
  const record = readRecord(home, 'slatebox')
  assert.deepEqual(record.ai, { mode: 'none' })
  assert.equal(record.target, 'local')
  assert.equal(record.backups.to, 'default')
  assert.deepEqual(record.size, { memory: '1Gi', cpu: '1', storage: '10Gi' }, 'size small')
})

test('3: from an agent shell --yes with no AI answer is not exit 3: AI is off', async () => {
  const { go, home } = fresh()
  const result = await go(['install', '--team-address', 'acme', '--yes'], { env: { AI_AGENT: '1' } })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(!result.events.some(event => event.event === 'error'))
  assert.deepEqual(readRecord(home, 'slatebox').ai, { mode: 'none' })
  // Without --yes nothing changed: still a question for the person, exit 3 (a machine with no install yet).
  const asked = await fresh().go(['plan', '--team-address', 'acme'], { env: { AI_AGENT: '1' } })
  assert.equal(asked.code, 3)
  assert.deepEqual(asked.events.at(-1).missing.map(item => item.field), ['ai.mode'])
})

test('3: the help text says what --yes does', () => {
  assert.match(HELP, /--team-address acme --yes {6}the same without questions: anything not\n/)
  assert.match(HELP, /AI off: add a model later with slatebox ai add/)
  assert.match(HELP, /with --yes and\n\s+no AI answer, AI is off/)
})

// ------------------------------------------------------------------ 5. a reserved name says so

test('5: a reserved name is refused with the reason Slatebox Cloud gives, not a bare "isn\'t available"', async () => {
  const { go } = fresh({ cloud: { reserved: ['e2e-497dcc28'] } })
  const result = await go(['install', '--team-address', 'e2e-497dcc28', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 3, result.stderr)
  const error = result.events.at(-1)
  assert.equal(error.id, 'address-unavailable')
  assert.equal(error.reason, 'reserved')
  assert.match(error.message, /^e2e-497dcc28\.slatebox\.team is reserved: e2e-… names are kept for Slatebox's own end-to-end tests\.\n {2}Choose another: --team-address <name>$/)
})

test('5: a taken name still gets the one plain answer', async () => {
  const { go, cloud } = fresh()
  cloud.taken.add('e2e-taken1')
  const result = await go(['install', '--team-address', 'e2e-taken1', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 3)
  assert.match(result.events.at(-1).message, /^e2e-taken1\.slatebox\.team isn't available\./)
  assert.equal(result.events.at(-1).reason, undefined)
})

// ------------------------------------------------------------------ 6. nothing left behind

test('6: remove --delete-data removes the installs folder when nothing else is in it', async () => {
  const { go, home } = local()
  assert.equal((await go(['install', ...LOCAL, '--backups', 'off', '--yes'])).code, 0)
  const removed = await go(['remove', '--delete-data', '--confirm', 'slatebox', '--yes'])
  assert.equal(removed.code, 0, removed.stderr)
  assert.ok(!existsSync(join(home, 'installs')), 'no empty installs folder')
})

test('6: ... and keeps it when another install is in it', async () => {
  const { go, home } = local()
  mkdirSync(join(home, 'installs', 'other'), { recursive: true })
  assert.equal((await go(['install', ...LOCAL, '--backups', 'off', '--yes'])).code, 0)
  assert.equal((await go(['remove', '--delete-data', '--confirm', 'slatebox', '--yes'])).code, 0)
  assert.ok(existsSync(join(home, 'installs', 'other')))
  assert.ok(!existsSync(join(home, 'installs', 'slatebox')))
})
