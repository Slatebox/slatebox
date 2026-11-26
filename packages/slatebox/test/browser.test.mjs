// Opening a link for the person (0.3.1): where no browser can open (SSH, no display, a container,
// CI, or an opener that is missing or fails), nobody is asked "Open it in your browser now?"; the
// link is shown to open on any device, with a QR code in the wizard (plain: only with --qr).
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { browserHere, inContainer, offerToOpen, openBrowser, opener } from '../src/browser.mjs'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { Redactor } from '../src/secrets.mjs'
import { qrLines } from '../src/ui/qr.mjs'
import { encode } from '../src/vendor/qrcode.mjs'
import { cli, FakeCloud, FakeDocker, sandbox } from './fakes.mjs'
import { KEY, richCli } from './rich-fakes.mjs'

const GOLDEN = fileURLToPath(new URL('./golden/qr/', import.meta.url))
const UPDATE = process.env.SLATEBOX_UPDATE_GOLDEN === '1'
const SSH = { SSH_CONNECTION: '10.0.0.2 51234 10.0.0.9 22' }

// ------------------------------------------------------------------ detection

test('browser here: the environment matrix', () => {
  const none = () => false
  const rows = [
    // [env, platform, container, expected reason or 'ok']
    [{}, 'darwin', false, 'ok'],
    [{}, 'win32', false, 'ok'],
    [{ DISPLAY: ':0' }, 'linux', false, 'ok'],
    [{ WAYLAND_DISPLAY: 'wayland-0' }, 'linux', false, 'ok'],
    [{ WSL_DISTRO_NAME: 'Ubuntu' }, 'linux', false, 'ok'],
    [{}, 'linux', false, 'display'],
    [{ DISPLAY: '' }, 'freebsd', false, 'display'],
    [{ SSH_CONNECTION: '1 2 3 4' }, 'darwin', false, 'ssh'],
    [{ SSH_TTY: '/dev/ttys004' }, 'darwin', false, 'ssh'],
    [{ SSH_CLIENT: '1 2 3' }, 'linux', false, 'ssh'],
    [{ SSH_CONNECTION: '1 2 3 4', DISPLAY: 'localhost:10.0' }, 'linux', false, 'ssh'],
    [{ CI: 'true' }, 'darwin', false, 'ci'],
    [{ DISPLAY: ':0' }, 'linux', true, 'container'],
    // macOS and Windows open the host's browser even from a shell that looks containerized.
    [{}, 'darwin', true, 'ok'],
  ]
  for (const [env, platform, container, expected] of rows) {
    const said = browserHere(env, platform, { container: container ? () => true : none })
    assert.equal(said.ok ? 'ok' : said.reason, expected, `${JSON.stringify(env)} on ${platform}${container ? ' in a container' : ''}`)
  }
  assert.equal(browserHere(SSH, 'linux').why, 'this is an SSH session')
  assert.equal(browserHere({}, 'linux', { container: none }).why, 'there is no display: DISPLAY and WAYLAND_DISPLAY are not set')
})

test('a container: /.dockerenv, /run/.containerenv or the container variable', () => {
  assert.equal(inContainer({}, path => path === '/.dockerenv'), true)
  assert.equal(inContainer({}, path => path === '/run/.containerenv'), true)
  assert.equal(inContainer({ container: 'podman' }, () => false), true)
  assert.equal(inContainer({}, () => false), false)
  assert.equal(inContainer({}, () => { throw new Error('EACCES') }), false)
})

// ------------------------------------------------------------------ the opener

/** A spawn that behaves as told: 'enoent', 'throw', an exit code, or 'hang'. */
function fakeSpawn(how, calls = []) {
  return (cmd, args) => {
    calls.push([cmd, ...args])
    if (how === 'throw') throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' })
    const child = new EventEmitter()
    child.unref = () => {}
    setTimeout(() => {
      if (how === 'enoent') child.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }))
      else if (typeof how === 'number') child.emit('exit', how, null)
    }, 1)
    return child
  }
}

test('the opener: per platform, and missing, failing, throwing or still running', async () => {
  assert.deepEqual(opener('https://x.test', 'darwin'), ['open', ['https://x.test']])
  assert.deepEqual(opener('https://x.test', 'win32'), ['cmd', ['/c', 'start', '""', 'https://x.test']])
  assert.deepEqual(opener('https://x.test', 'linux'), ['xdg-open', ['https://x.test']])
  const calls = []
  assert.deepEqual(await openBrowser('https://x.test', 'linux', { spawn: fakeSpawn(0, calls) }), { ok: true })
  assert.deepEqual(calls, [['xdg-open', 'https://x.test']])
  assert.deepEqual(await openBrowser('https://x.test', 'linux', { spawn: fakeSpawn('enoent') }), { ok: false, why: 'xdg-open is not installed' })
  assert.deepEqual(await openBrowser('https://x.test', 'linux', { spawn: fakeSpawn(3) }), { ok: false, why: 'xdg-open exited with 3' })
  assert.deepEqual(await openBrowser('https://x.test', 'darwin', { spawn: fakeSpawn('throw') }), { ok: false, why: 'open failed: spawn EPERM' })
  assert.deepEqual(await openBrowser('https://x.test', 'linux', { spawn: fakeSpawn('hang'), wait: 20 }), { ok: true })
})

/** A plain run's ctx, enough for offerToOpen. */
function plainCtx({ env = {}, platform = 'linux', answers = [], opener: open = () => {}, flags = {}, yes = false } = {}) {
  let err = ''
  const asked = []
  return {
    ctx: {
      env, platform, flags, yes, rich: false, redactor: new Redactor(), inContainer: () => false, openBrowser: open,
      stderr: { write: text => { err += text } },
      prompt: { confirm: async question => { asked.push(question); return answers.shift() ?? true } },
    },
    err: () => err,
    asked,
  }
}

test('offerToOpen: no browser here asks nothing and shows the link; --qr adds a QR code', async () => {
  const opened = []
  const run = plainCtx({ env: SSH, opener: url => opened.push(url) })
  assert.equal(await offerToOpen(run.ctx, 'https://app.example/device?code=AB'), 'shown')
  assert.deepEqual(run.asked, [])
  assert.deepEqual(opened, [])
  assert.equal(run.err(), '  No browser here (this is an SSH session). Open this on any device:\n    https://app.example/device?code=AB\n')
  const qr = plainCtx({ env: { ...SSH, LANG: 'en_US.UTF-8' }, flags: { qr: true } })
  await offerToOpen(qr.ctx, 'https://app.example/device?code=AB')
  assert.match(qr.err(), /Open this on any device:\n {4}https:\/\/app\.example\/device\?code=AB\n( {4}[█▀▄ ]+\n){10,}$/)
})

test('offerToOpen: an opener that fails, throws or returns false says so and shows the same fallback', async () => {
  for (const [open, why] of [
    [async () => ({ ok: false, why: 'xdg-open exited with 3' }), 'xdg-open exited with 3'],
    [() => { throw new Error('spawn xdg-open ENOENT') }, 'spawn xdg-open ENOENT'],
    [() => false, 'the browser did not open'],
  ]) {
    const run = plainCtx({ env: { DISPLAY: ':0' }, opener: open })
    assert.equal(await offerToOpen(run.ctx, 'https://app.example/device'), 'failed')
    assert.deepEqual(run.asked, ['Open it in your browser now?'])
    assert.equal(run.err(), `  Couldn't open a browser here (${why}). Open this on any device:\n    https://app.example/device\n`)
  }
  // Declined: nothing opened, nothing more said. --yes: no question, "Opening it" as before.
  const declined = plainCtx({ env: { DISPLAY: ':0' }, answers: [false], opener: () => { throw new Error('not opened') } })
  assert.equal(await offerToOpen(declined.ctx, 'https://app.example/device'), 'declined')
  assert.equal(declined.err(), '')
  const yes = plainCtx({ env: { DISPLAY: ':0' }, yes: true })
  assert.equal(await offerToOpen(yes.ctx, 'https://app.example/device'), 'opened')
  assert.deepEqual(yes.asked, [])
  assert.equal(yes.err(), '  Opening it in your browser.\n')
})

test('a setup link shown elsewhere is written past the redactor (the terminal only), like the link itself', async () => {
  const token = 'Zk3aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_qr'
  const run = plainCtx({ env: SSH })
  run.ctx.redactor.add(token)
  await offerToOpen(run.ctx, `https://acme.slatebox.team/setup/${token}`, { secret: true })
  assert.ok(run.err().includes(token))
  const device = plainCtx({ env: SSH })
  device.ctx.redactor.add('SECRET-DEVICE-CODE')
  await offerToOpen(device.ctx, 'https://app.example/device?x=SECRET-DEVICE-CODE')
  assert.ok(!device.err().includes('SECRET-DEVICE-CODE'))
})

// ------------------------------------------------------------------ the device sign-in

function teamInstall() {
  const docker = new FakeDocker({ provider: 'colima', serverArch: 'arm64', settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel'] })
  docker.addImage('slatebox-test:browser')
  const cloud = new FakeCloud()
  return { docker, cloud, home: sandbox() }
}
const TEAM = ['install', '--image', 'slatebox-test:browser', '--target', 'local', '--team-address', 'acme', '--port', '17495', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--admin-email', 'ops@example.com', '--mail-url-from', 'env:SMTP_URL']

test('sign-in, plain over SSH: no browser question; the page to open on any device', async () => {
  const { docker, cloud, home } = teamInstall()
  const opened = []
  const result = await cli([...TEAM, '--yes'], {
    run: docker.run, home, fetch: cloud.fetch, tty: true, input: '', platform: 'linux', env: { SLATEBOX_CLOUD_URL: cloud.base, SMTP_URL: 'smtp://u:p@h:587', ...SSH, DISPLAY: ':0' },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: url => opened.push(url), teamHealthDelay: 1, teamHealthAttempts: 3 },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(opened, [])
  assert.doesNotMatch(result.stderr, /Open it in your browser now\?|Opening it in your browser/)
  assert.match(result.stderr, new RegExp(`  No browser here \\(this is an SSH session\\)\\. Open this on any device:\\n {4}${cloud.base.replace(/[.]/g, '\\.')}/device\\?code=WDJB-MJHT\\n`))
})

test('sign-in, plain on a desktop whose opener fails: says so and shows the page', async () => {
  const { docker, cloud, home } = teamInstall()
  const result = await cli([...TEAM, '--yes'], {
    run: docker.run, home, fetch: cloud.fetch, tty: true, input: '', platform: 'linux', env: { SLATEBOX_CLOUD_URL: cloud.base, SMTP_URL: 'smtp://u:p@h:587', DISPLAY: ':0' },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: async () => ({ ok: false, why: 'xdg-open exited with 3' }), teamHealthDelay: 1, teamHealthAttempts: 3 },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /  Opening it in your browser\.\n  Couldn't open a browser here \(xdg-open exited with 3\)\. Open this on any device:\n {4}http\S+\/device\?code=WDJB-MJHT\n/)
})

test('sign-in, wizard over SSH: the code box, why no browser opens, the page and a QR code; no question', async () => {
  const { docker, cloud, home } = teamInstall()
  const opened = []
  const result = await richCli(TEAM, {
    run: docker.run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base, SMTP_URL: 'smtp://u:p@h:587', ...SSH },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: url => opened.push(url), teamHealthDelay: 1, teamHealthAttempts: 3, healthPoll: 1 },
    script: [[/Install +Change a section… +Cancel/, KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  assert.deepEqual(opened, [])
  assert.doesNotMatch(result.text, /Open it in your browser now\?/)
  assert.match(result.text, /╭─ Sign in to Slatebox to claim a team address/)
  assert.match(result.text, /› No browser here \(this is an SSH session\)\. Open this on any device:\n {3}http\S+\/device\?code=WDJB-MJHT\n\n {3}Scan it with a phone\n( {3}[█▀▄ ]+\n){10,}/)
  // Black on white, whatever the terminal's own colors.
  assert.ok(result.stderr.includes('\x1b[30;47m'))
  assert.match(result.text, /✓ Signed in/)
})

test('sign-in, wizard on a desktop: the question as before; a failed open shows the fallback', async () => {
  const { docker, cloud, home } = teamInstall()
  const result = await richCli(TEAM, {
    run: docker.run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base, SMTP_URL: 'smtp://u:p@h:587', DISPLAY: ':0' },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: async () => ({ ok: false, why: 'xdg-open is not installed' }), teamHealthDelay: 1, teamHealthAttempts: 3, healthPoll: 1 },
    script: [[/Install +Change a section… +Cancel/, KEY.enter], ['Open it in your browser now?', KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /› Couldn't open a browser here \(xdg-open is not installed\)\. Open this on any device:/)
  assert.match(result.text, /Scan it with a phone/)
})

// ------------------------------------------------------------------ the QR code

function golden(name, actual) {
  const file = join(GOLDEN, name)
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, actual)
    if (!UPDATE) assert.fail(`${name} had no golden file; one was written. Run again.`)
    return
  }
  assert.equal(actual, readFileSync(file, 'utf8'), `${name} differs (SLATEBOX_UPDATE_GOLDEN=1 rewrites it)`)
}

const SAMPLE = 'https://acme.slatebox.team/setup/SetupToken0123456789abcdefghijklmnopqrst000'

test('QR code: snapshots of the half-block, colored and ASCII looks', () => {
  golden('setup-link.unicode.txt', `${qrLines(SAMPLE, { unicode: true }).join('\n')}\n`)
  golden('setup-link.color.txt', `${qrLines(SAMPLE, { unicode: true, color: true }).join('\n')}\n`)
  golden('setup-link.ascii.txt', `${qrLines(SAMPLE, { unicode: false }).join('\n')}\n`)
})

test('QR code: the modules drawn are the encoder\'s, with a two-module quiet zone, in every look', () => {
  const { data, size } = encode(SAMPLE, { ecc: 'L', border: 2 })
  // ASCII: one row a module, "##" dark.
  const ascii = qrLines(SAMPLE, { unicode: false })
  assert.equal(ascii.length, size)
  ascii.forEach((row, y) => assert.equal(row, data[y].map(dark => (dark ? '##' : '  ')).join('')))
  // Colored half blocks: top and bottom module of each cell, black on white.
  const color = qrLines(SAMPLE, { unicode: true, color: true })
  assert.equal(color.length, Math.ceil(size / 2))
  color.forEach((raw, i) => {
    const row = raw.replace(/\x1b\[[\d;]*m/g, '')
    assert.equal(row.length, size)
    ;[...row].forEach((cell, x) => {
      const top = data[2 * i][x], bottom = data[2 * i + 1]?.[x] ?? false
      assert.equal(cell, top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ')
    })
  })
  // The quiet zone: the first row and column are light.
  assert.equal(ascii[0].trim(), '')
  assert.ok(ascii.every(row => row.startsWith('    ')))
  // A setup link fits a 60-column terminal.
  assert.ok(qrLines(SAMPLE, { unicode: true })[0].length + 3 <= 60)
})
