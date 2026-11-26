// The first admin, right after the install (0.3.1): created in the terminal through the setup
// link's own endpoint, or the link kept and waited on. Against FakeDocker and a setup endpoint
// made from the server's own code (test/setup-server.mjs).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAdmin, passwordProblem, setupOrigins, setupStatus, splitName, suggestedTeam, waitForAdmin } from '../src/admin-setup.mjs'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { cli, FakeDocker, sandbox } from './fakes.mjs'
import { KEY, richCli } from './rich-fakes.mjs'
import { LOGIN_TOKEN, setupServer } from './setup-server.mjs'

const IMAGE = 'slatebox-test:0.3.1'
const PORT = '17491'
const LOCAL = ['--image', IMAGE, '--local', '--port', PORT, '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL', '--admin-email', 'ops@example.com']
const ENV = { SMTP_URL: 'smtp://u:p@h:587' }
const io = { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {}, teamHealthDelay: 1, teamHealthAttempts: 3, healthPoll: 1, adminPoll: 5 }
const LOCAL_ORIGIN = `http://localhost:${PORT}`

function machine(options, dockerOptions = {}) {
  const docker = new FakeDocker({ provider: 'colima', serverArch: 'arm64', settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'], ...dockerOptions })
  docker.addImage(IMAGE)
  const server = setupServer(docker, options)
  return { docker, server, home: sandbox() }
}

const toReview = [['Where should Slatebox run', KEY.enter], [/Install +Change a section… +Cancel/, KEY.enter]]
const strong = 'Correct-Horse-42'

// ------------------------------------------------------------------ the pieces

test('password strength: length, common passwords, repeats, the email in it, and a mix for short ones', () => {
  assert.equal(passwordProblem('short'), 'Use at least 8 characters.')
  assert.equal(passwordProblem('x'.repeat(257)), 'Use at most 256 characters.')
  assert.match(passwordProblem('Password123'), /too common/)
  assert.match(passwordProblem('aaaaaaaaaaaa'), /one character repeated/)
  assert.match(passwordProblem('opsteam-2026!', { email: 'opsteam@example.com' }), /name or email/)
  assert.match(passwordProblem('abcdefgh'), /Mix in a number/)
  assert.equal(passwordProblem('abcdefgh1'), null)
  assert.equal(passwordProblem('a long passphrase of words'), null)
  assert.equal(passwordProblem(strong), null)
})

test('names, team names and where the form goes', () => {
  assert.deepEqual(splitName('Ada  King Lovelace'), { firstName: 'Ada', lastName: 'King Lovelace' })
  assert.deepEqual(splitName('Ada'), { firstName: 'Ada', lastName: '' })
  assert.equal(suggestedTeam({ teamAddress: 'https://acme-labs.slatebox.team' }), 'Acme Labs')
  assert.equal(suggestedTeam({ address: 'http://localhost:7070' }), 'Our team')
  // This computer's own port first, then the link's own address; over SSH only the link's.
  assert.deepEqual(setupOrigins({ answers: { address: { port: 7070 } } }, { target: 'local', address: 'https://acme.slatebox.team', localAddress: 'http://localhost:7070' }, { url: 'https://acme.slatebox.team/setup/t' }), ['http://localhost:7070', 'https://acme.slatebox.team'])
  assert.deepEqual(setupOrigins({ answers: { address: { port: 7070 } } }, { target: 'ssh', address: 'https://acme.slatebox.team' }, { url: 'https://acme.slatebox.team/setup/t' }), ['https://acme.slatebox.team'])
})

async function linkFor(docker) {
  docker.containers.set('slatebox', { running: true, health: 'healthy' })
  const made = await docker.run('docker', ['exec', 'slatebox', 'slatebox', 'setup-link', '--json'])
  return JSON.parse(made.stdout.trim().split('\n').pop()).url.split('/setup/')[1]
}

test('createAdmin against the setup endpoint: success, a weak password, the token used, already set up, unreachable', async () => {
  const values = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: strong, team: 'Acme' }
  {
    const { docker, server } = machine()
    const token = await linkFor(docker)
    // The server's own rule (8 characters) answers with its own words.
    const weak = await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, values: { ...values, password: 'short' } })
    assert.deepEqual(weak, { error: 'form', problems: ['Choose a password of at least 8 characters.'], origin: LOCAL_ORIGIN })
    const made = await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, values })
    assert.deepEqual(made, { ok: true, origin: LOCAL_ORIGIN })
    assert.equal(server.state.admin.email, 'ada@example.com')
    assert.equal(server.state.admin.firstName, 'Ada')
    // Single use: the same link again finds the server set up.
    assert.equal((await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, values })).error, 'set-up')
  }
  {
    const { docker, server } = machine({ claimed: true })
    const token = await linkFor(docker)
    assert.equal((await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, values })).error, 'used')
  }
  {
    const { docker, server } = machine({ down: [LOCAL_ORIGIN, 'https://box.example'] })
    const token = await linkFor(docker)
    const result = await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN, 'https://box.example'], token, values })
    assert.deepEqual(result, { error: 'unreachable', why: `${LOCAL_ORIGIN} (ECONNREFUSED), https://box.example (ECONNREFUSED)` })
  }
  {
    // This computer's port does not answer: the link's own address does.
    const { docker, server } = machine({ down: [LOCAL_ORIGIN] })
    const token = await linkFor(docker)
    assert.deepEqual(await createAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN, 'https://box.example'], token, values }), { ok: true, origin: 'https://box.example' })
  }
})

test('setup status and the wait: set up after a few checks, stopped by Enter, a timeout, and a replaced link', async () => {
  {
    const { docker, server } = machine({ onGet: n => { if (n === 3) docker.setUp('slatebox') } })
    const token = await linkFor(docker)
    assert.equal(await setupStatus({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token }), 'waiting')
    const result = await waitForAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, interval: 1 })
    assert.equal(result, 'set-up')
    assert.equal(server.gets(), 3)
  }
  {
    const { docker, server } = machine()
    const token = await linkFor(docker)
    let press
    const stop = new Promise(resolve => { press = resolve })
    setTimeout(() => press('enter'), 30)
    assert.equal(await waitForAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, stop, interval: 5 }), 'stopped')
    assert.equal(await waitForAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, timeout: 20, interval: 5 }), 'timeout')
    // The setup page is asked first (a GET is cheaper than starting a process in the container);
    // the image's own check (docker exec, bounded by the check's timeout) only when no page answers.
    const execs = []
    const exec = (args, options) => { execs.push(options); return docker.run('docker', ['exec', 'slatebox', 'slatebox', ...args]) }
    assert.equal(await setupStatus({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, exec }), 'waiting')
    assert.deepEqual(execs, [])
    assert.equal(await setupStatus({ fetch: () => { throw new Error('no page') } }, { origins: [LOCAL_ORIGIN], token, exec, timeout: 1234 }), 'waiting')
    assert.deepEqual(execs, [{ timeout: 1234 }])
    docker.setUp('slatebox')
    assert.equal(await setupStatus({ fetch: () => { throw new Error('no page') } }, { origins: [LOCAL_ORIGIN], token, exec }), 'set-up')
    assert.deepEqual(execs.at(-1), { timeout: 10_000 })
  }
  {
    const { docker, server } = machine()
    const token = await linkFor(docker)
    await docker.run('docker', ['exec', 'slatebox', 'slatebox', 'setup-link', '--json'])
    assert.equal(await waitForAdmin({ fetch: server.fetch }, { origins: [LOCAL_ORIGIN], token, interval: 1 }), 'invalid')
  }
})

test('the wait is bounded by its deadline and by Enter even when a check hangs; a hanging page is given up on', async () => {
  const hang = () => new Promise(() => {})
  const never = { fetch: hang }
  let start = Date.now()
  assert.equal(await waitForAdmin(never, { origins: [LOCAL_ORIGIN], token: 't', exec: hang, timeout: 40, interval: 5 }), 'timeout')
  assert.ok(Date.now() - start < 1000, 'the deadline ended the wait')
  let press
  const stop = new Promise(resolve => { press = resolve })
  setTimeout(() => press('stop'), 20)
  start = Date.now()
  assert.equal(await waitForAdmin(never, { origins: [LOCAL_ORIGIN], token: 't', exec: hang, stop, interval: 5 }), 'stopped')
  assert.ok(Date.now() - start < 1000, 'Enter (or Ctrl-C) ended the wait')
  // A page that never answers is aborted after the check's timeout, then the next address is asked.
  const asked = []
  const slow = (url, init) => new Promise((resolve, reject) => {
    asked.push(new URL(url).origin)
    if (url.startsWith('https://box.example')) resolve({ status: 200, text: async () => '<h1>This Slatebox is already set up</h1>' })
    else init.signal.addEventListener('abort', () => reject(init.signal.reason))
  })
  assert.equal(await setupStatus({ fetch: slow }, { origins: [LOCAL_ORIGIN, 'https://box.example'], token: 't', timeout: 20 }), 'set-up')
  assert.deepEqual(asked, [LOCAL_ORIGIN, 'https://box.example'])
})

// ------------------------------------------------------------------ the wizard

test('wizard: "Create the admin account now" asks name, email (prefilled), team and the password twice, then makes the admin', async () => {
  const { docker, server, home } = machine()
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: ENV, io,
    script: [...toReview,
      ['Create the admin account now', KEY.enter],
      ['Your name', ['Ada Lovelace', KEY.enter]],
      ['Email', KEY.enter],
      ['Team name', KEY.enter],
      ['Password', ['short', KEY.enter]], ['Use at least 8 characters.', []],
      ['Password', [strong, KEY.enter]], ['Password again', ['Correct-Horse-43', KEY.enter]], ['The two passwords don\'t match', []],
      ['Password', [strong, KEY.enter]], ['Password again', [strong, KEY.enter]],
    ],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /◇ {2}First admin {2}Create the admin account now/)
  assert.match(result.text, /◇ {2}Email {2}ops@example\.com/)
  assert.match(result.text, /◇ {2}Team {2}Our team/)
  assert.match(result.text, new RegExp(`✓ Admin ops@example\\.com created\\. Sign in at http://localhost:${PORT}`))
  assert.match(result.text, /The one-time setup link no longer works/)
  assert.match(result.text, /Next {3}slatebox status/)
  assert.deepEqual(server.state.admin, { firstName: 'Ada', lastName: 'Lovelace', email: 'ops@example.com', password: strong, team: 'Our team' })
  // Sent once (the weak and mismatched passwords never left the terminal), to this computer's port.
  assert.deepEqual(server.calls.map(call => `${call.method} ${call.origin}`), [`POST ${LOCAL_ORIGIN}`])
  assert.equal(docker.containers.get('slatebox').setUp, true)
  // The link, the password and the browser sign-in the page answers with are never on screen.
  assert.ok(!result.stderr.includes(docker.setupLinks[0]), 'the setup token is not shown')
  assert.ok(!result.stderr.includes(strong), 'the password is not shown')
  assert.ok(!result.stderr.includes(LOGIN_TOKEN), 'the login token is dropped')
  assert.equal(result.modes.at(-1), false)
})

test('wizard: a setup link that was already used says so, with the command for a new one', async () => {
  const { docker, server, home } = machine({ claimed: true })
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: ENV, io,
    script: [...toReview, ['Create the admin account now', KEY.enter], ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.enter],
      ['Password', [strong, KEY.enter]], ['Password again', [strong, KEY.enter]]],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /▲ This setup link was already used, or a newer one replaced it\./)
  assert.match(result.text, /Get a new one with slatebox setup-link\./)
  assert.ok(!docker.containers.get('slatebox').setUp)
})

test('wizard: Slatebox unreachable from here falls back to the setup link, its QR code, and the wait', async () => {
  const { docker, server, home } = machine({ down: [LOCAL_ORIGIN, 'https://box.example'] })
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: ENV, io,
    script: [...toReview, ['Create the admin account now', KEY.enter], ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.enter],
      ['Password', [strong, KEY.enter]], ['Password again', [strong, KEY.enter]], ['Enter stops waiting', KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  // (A note wraps under its text: joined again here.)
  assert.match(result.text.replace(/\n {3}/g, ' '), new RegExp(`▲ Couldn't reach Slatebox at ${LOCAL_ORIGIN} \\(ECONNREFUSED\\), https://box\\.example \\(ECONNREFUSED\\)\\. Use the setup link instead\\.`))
  assert.match(result.text, /https:\/\/box\.example\/setup\/SetupToken\S+/)
  assert.match(result.text, /Or scan it with a phone/)
  assert.match(result.text, /Stopped waiting\. The setup link works for 24 hours\./)
})

test('wizard: "I\'ll use the setup link" over SSH shows why no browser opens, the link and a QR code, then confirms the admin once it exists', async () => {
  const { docker, server, home } = machine()
  const opened = []
  // Someone opens the link elsewhere and creates the admin while the installer waits (the image's
  // own check, docker exec slatebox setup-link --check, sees it).
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: { ...ENV, SSH_CONNECTION: '10.0.0.2 51234 10.0.0.9 22', DISPLAY: ':0' }, io: { ...io, openBrowser: url => opened.push(url) },
    script: [...toReview, ['Create the admin account now', [KEY.down, KEY.enter]], ['Enter stops waiting', () => { docker.setUp('slatebox'); return [] }]],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /No browser here \(this is an SSH session\)\. Open this on any device:/)
  assert.match(result.text, /https:\/\/box\.example\/setup\/SetupToken\S+/)
  assert.match(result.text, /Or scan it with a phone\n {3}[█▀▄ ]{20,}/)
  assert.doesNotMatch(result.text, /Open it in your browser now\?/)
  assert.deepEqual(opened, [])
  assert.match(result.text, /✓ Admin created/)
  assert.match(result.text, new RegExp(`Sign in at http://localhost:${PORT}`))
})

test('wizard: Esc or Ctrl-C at any first-admin question ends that step only: the link is kept, the closing lines follow, exit 0', async () => {
  const create = ['Create the admin account now', KEY.enter]
  const cases = [
    ['First admin, Esc', [['Create the admin account now', KEY.esc]]],
    ['First admin, Ctrl-C', [['Create the admin account now', KEY.ctrlC]]],
    ['Name, Esc', [create, ['Your name', KEY.esc]]],
    ['Email, Ctrl-C', [create, ['Your name', ['Ada', KEY.enter]], ['Email', KEY.ctrlC]]],
    ['Team, Esc', [create, ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.esc]]],
    ['Password, Ctrl-C', [create, ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.enter], ['Password', KEY.ctrlC]]],
    ['Password again, Esc', [create, ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.enter], ['Password', [strong, KEY.enter]], ['Password again', KEY.esc]]],
  ]
  for (const [name, steps] of cases) {
    const { docker, server, home } = machine()
    const result = await richCli(['install', ...LOCAL], { run: docker.run, fetch: server.fetch, home, env: ENV, io, script: [...toReview, ...steps] })
    assert.equal(result.code, 0, `${name}: ${result.text}`)
    assert.doesNotMatch(result.text, /Canceled\. Nothing was changed|Run slatebox install again/, name)
    assert.match(result.text, /Stopped\. Slatebox is installed; the admin account was not created\./, name)
    // The link (not shown yet: the person chose to create the admin here) is shown once, in its box.
    assert.equal(result.stderr.split(docker.setupLinks[0]).length - 1, 1, `${name}: the setup link is shown once`)
    assert.match(result.text, /Create the first account \(the server administrator\)/, name)
    // The closing lines: the secrets warning, the install record and what to do next.
    assert.match(result.text, /▲ Save \S+secrets\.env in your password manager now\./, name)
    assert.match(result.text, /Install record: /, name)
    assert.match(result.text, /Next {3}slatebox status/, name)
    assert.deepEqual(server.calls.filter(call => call.method === 'POST'), [], name)
    assert.equal(result.modes.at(-1), false, `${name}: the terminal is put back`)
  }
})

test('wizard: Esc at the browser question after "I\'ll use the setup link" keeps the link already shown and draws the closing lines', async () => {
  const { docker, server, home } = machine()
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: { ...ENV, DISPLAY: ':0' }, io,
    script: [...toReview, ['Create the admin account now', [KEY.down, KEY.enter]], ['Open it in your browser now?', KEY.esc]],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /The setup link above still works for 24 hours\./)
  assert.equal(result.stderr.split(docker.setupLinks[0]).length - 1, 1, 'shown once')
  assert.match(result.text, /Next {3}slatebox status/)
})

test('wizard: Ctrl-C between questions (while the account is being created) ends that step only: the link and the closing lines, exit 0', async () => {
  const { docker, server, home } = machine()
  let prompt, aborted = false
  // The form is sent and hangs (a server that does not answer); Ctrl-C arrives as SIGINT then.
  const fetch = (url, init = {}) => (init.method === 'POST'
    ? new Promise((resolve, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason) }))
    : server.fetch(url, init))
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch, home, env: ENV, io: { ...io, onRichPrompt: p => { prompt = p } },
    script: [...toReview, ['Create the admin account now', KEY.enter], ['Your name', ['Ada', KEY.enter]], ['Email', KEY.enter], ['Team name', KEY.enter],
      ['Password', [strong, KEY.enter]], ['Password again', [strong, KEY.enter]], ['Creating the admin account', () => { prompt.onInterrupt(); return [] }]],
  })
  assert.equal(result.code, 0, result.text)
  assert.match(result.text, /■ Creating the admin account/)
  assert.match(result.text, /Stopped\. Slatebox is installed and running\./)
  assert.doesNotMatch(result.text, /Run slatebox install again|Canceled\. Nothing was changed/)
  assert.equal(result.stderr.split(docker.setupLinks[0]).length - 1, 1, 'the setup link is shown')
  assert.match(result.text, /Install record: /)
  assert.match(result.text, /Next {3}slatebox status/)
  assert.ok(aborted, 'the request in flight is abandoned')
  // Nothing more is asked or drawn after the closing lines.
  assert.ok(result.text.trimEnd().split('\n').at(-1).includes('slatebox upgrade'), result.text.slice(-300))
})

test('wizard over SSH with a localhost setup link: opens only on this computer, the SSH tunnel to use, no QR code', async () => {
  const { docker, server, home } = machine({}, { setupOrigin: LOCAL_ORIGIN })
  const result = await richCli(['install', ...LOCAL], {
    run: docker.run, fetch: server.fetch, home, env: { ...ENV, SSH_CONNECTION: '10.0.0.2 51234 10.0.0.9 22', USER: 'ops' }, io,
    script: [...toReview, [/I'll use the setup link +opens only on this computer, or through an SSH tunnel/, [KEY.down, KEY.enter]], ['Enter stops waiting', KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  const text = result.text.replace(/\n {3}/g, ' ')
  assert.match(text, /No browser here \(this is an SSH session\)\. This link opens only on this computer:/)
  assert.match(text, new RegExp(`ssh -L ${PORT}:localhost:${PORT} ops@10\\.0\\.0\\.9, then open the link there\\.`))
  assert.doesNotMatch(result.text, /any device|scan it with a phone/i)
  assert.doesNotMatch(result.text, /[█▀▄]{8}/)
})

test('wizard: single sign-on only offers no password account; the link is kept', async () => {
  const { docker, server, home } = machine()
  const flags = LOCAL.filter(flag => flag !== '--no-sso')
  const result = await richCli(['install', ...flags, '--sso-only'], {
    run: docker.run, fetch: server.fetch, home, env: ENV, io,
    script: [['Where should Slatebox run', KEY.enter], [/Install +Change a section… +Cancel/, KEY.enter], ['Enter stops waiting', KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  assert.doesNotMatch(result.text, /Create the admin account now/)
  assert.match(result.text, /https:\/\/box\.example\/setup\/SetupToken\S+/)
})

// ------------------------------------------------------------------ plain, --yes and --json

test('plain: one optional question after the closing lines; Enter creates the admin here', async () => {
  const { docker, server, home } = machine()
  // Where (Enter: this computer), apply the plan, then the first admin: Enter, name, Enter for the
  // email and the team, and the password twice.
  const input = ['', 'y', '', 'Ada Lovelace', '', '', strong, strong].join('\n') + '\n'
  const result = await cli(['install', ...LOCAL], { run: docker.run, fetch: server.fetch, home, env: ENV, tty: true, input, platform: 'linux', io })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /\? Create the admin account here in the terminal now\? \[Y\/n\]: /)
  assert.match(result.stderr, /\? Email \(ops@example\.com\): /)
  assert.match(result.stdout, new RegExp(`✓ Admin ops@example\\.com created\\. Sign in at http://localhost:${PORT}`))
  assert.match(result.stdout, /The one-time setup link no longer works/)
  assert.equal(docker.containers.get('slatebox').setUp, true)
  assert.ok(!(result.stdout + result.stderr).includes(strong))
})

test('plain: no answer to the optional question leaves the printed link as it is', async () => {
  const { docker, server, home } = machine()
  const result = await cli(['install', ...LOCAL], { run: docker.run, fetch: server.fetch, home, env: ENV, tty: true, input: '\ny\n', platform: 'linux', io })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /https:\/\/box\.example\/setup\/SetupToken\S+ {3}\(printed to this terminal only\)/)
  assert.deepEqual(server.calls, [])
})

test('plain: the input ending (or a cancel) inside the first-admin questions leaves the link; the run ends well and --show-secrets still runs', async () => {
  for (const input of ['\ny\ny\n', '\ny\ny\nAda\n\n\n']) {
    const { docker, server, home } = machine()
    const result = await cli(['install', ...LOCAL, '--show-secrets'], { run: docker.run, fetch: server.fetch, home, env: ENV, tty: true, input, platform: 'linux', io })
    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /Cancelled/)
    assert.match(result.stdout, /Stopped\. The admin account was not created; the setup link printed above still works\./)
    assert.match(result.stderr, /https:\/\/box\.example\/setup\/SetupToken\S+ {3}\(printed to this terminal only\)/)
    // --show-secrets printed the key (the last line), after the first admin.
    const out = result.stdout.trimEnd().split('\n')
    assert.ok(out.at(-1).length >= 16 && !/Stopped/.test(out.at(-1)), result.stdout)
    assert.deepEqual(server.calls.filter(call => call.method === 'POST'), [])
  }
})

test('plain over SSH: the closing lines say no browser is here, with a QR code for the setup link under --qr', async () => {
  const { docker, server, home } = machine()
  const result = await cli(['install', ...LOCAL, '--yes', '--qr'], { run: docker.run, fetch: server.fetch, home, env: { ...ENV, SSH_CONNECTION: '10.0.0.2 51234 10.0.0.9 22', LANG: 'en_US.UTF-8' }, tty: true, input: '', platform: 'linux', io })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /No browser here \(this is an SSH session\)\. Open this on any device:\n {2}https:\/\/box\.example\/setup\/SetupToken\S+ {3}\(printed to this terminal only\)\n( {4}[█▀▄ ]+\n){10,}/)
})

test('--yes and --json are unchanged: no question, no form sent, no new event', async () => {
  for (const extra of [['--yes'], ['--yes', '--json']]) {
    const { docker, server, home } = machine()
    const result = await cli(['install', ...LOCAL, ...extra], { run: docker.run, fetch: server.fetch, home, env: ENV, tty: !extra.includes('--json'), input: '', platform: 'linux', io })
    assert.equal(result.code, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /Create the admin account/)
    assert.deepEqual(server.calls, [])
    if (extra.includes('--json')) {
      assert.deepEqual([...new Set(result.events.map(event => event.event))].sort(), ['done', 'plan', 'step'])
      assert.ok(!JSON.stringify(result.events).includes('first-admin'))
    }
  }
})
