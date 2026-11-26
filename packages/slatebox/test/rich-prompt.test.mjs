// The wizard in the terminal (src/ui/rich-prompt.mjs) on a fake raw terminal: the same answers as
// the plain questions (parity), its frames at 100, 72 and 60 columns, without color and in ASCII,
// arrow keys, defaults, validation, Ctrl-C at every section (nothing runs), the review ("Change a
// section", Cancel by default on a server, d for the full plan), and the setup link on its own
// line. SLATEBOX_UPDATE_GOLDEN=1 rewrites the frame snapshots.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { interview } from '../src/interview.mjs'
import { Redactor } from '../src/secrets.mjs'
import { createRichPrompt } from '../src/ui/rich-prompt.mjs'
import { detectTerm } from '../src/ui/term.mjs'
import { cli, FakeCloud, FakeDocker, sandbox } from './fakes.mjs'
import { KEY, plainText, rawTerminal, richCli } from './rich-fakes.mjs'

const FRAMES = fileURLToPath(new URL('./golden/frames/', import.meta.url))
const UPDATE = process.env.SLATEBOX_UPDATE_GOLDEN === '1'
const IMAGE = 'slatebox-test:rich'

function snapshot(name, actual) {
  const file = join(FRAMES, name)
  if (UPDATE || !existsSync(file)) {
    mkdirSync(FRAMES, { recursive: true })
    writeFileSync(file, actual)
    if (!UPDATE) assert.fail(`${name} had no snapshot; one was written. Run again.`)
    return
  }
  assert.equal(actual, readFileSync(file, 'utf8'), `${name} differs (SLATEBOX_UPDATE_GOLDEN=1 rewrites it)`)
}

function machine(options = {}) {
  const docker = new FakeDocker({ provider: 'colima', serverArch: 'arm64', settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'], ...options })
  docker.addImage(IMAGE)
  const cloud = new FakeCloud({ taken: ['support'] })
  return { docker, cloud, home: sandbox() }
}
const io = { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {}, teamHealthDelay: 1, teamHealthAttempts: 3, healthPoll: 1 }
const installed = (docker, home) => ({ started: docker.starts().length, pulled: docker.count(call => call.args[0] === 'pull'), files: existsSync(join(home, 'installs', 'slatebox')) })

// ------------------------------------------------------------------ parity

/** The plain questions answered from a list, in order. */
function scripted(answers) {
  const queue = [...answers]
  const next = question => {
    if (!queue.length) throw new Error(`no answer left for: ${question}`)
    return queue.shift()
  }
  return { text: async q => next(q), choose: async q => next(q), confirm: async q => next(q), secret: async q => next(q), close() {} }
}

test('parity: the wizard and the plain questions give the same answers for the same choices', async () => {
  const cloud = new FakeCloud({ taken: ['support'] })
  const base = () => ({ fetch: cloud.fetch, env: { SLATEBOX_CLOUD_URL: cloud.base }, redactor: new Redactor(), freePort: 7070, currentContext: null, stderr: { write() {} } })
  const plain = await interview({ ...base(), prompt: scripted([
    'local', 'team', 'support', 'acme', 'ops@example.com', 'cloud', 'openai', 'gpt-5-mini', 'env', 'OPENAI_API_KEY', false,
    true, false, true, 'off', 'team', 'SMTP_URL', 'Slatebox <b@example.com>',
  ]) }, {})

  const t = rawTerminal({ columns: 100 })
  const term = detectTerm({ LANG: 'en_US.UTF-8', FORCE_COLOR: '3' }, t.stderr, 'linux')
  const prompt = createRichPrompt({ input: t.stdin, output: t.stderr, term, redactor: new Redactor(), version: '0.3.0' })
  const script = [
    ['Where should Slatebox run', KEY.enter], ['Where should your team open', KEY.enter],
    ['Team address', ['support', KEY.enter]], ['Pick a free address', ['3', KEY.enter]], ['Team address', ['acme', KEY.enter]],
    ['Admin email', ['ops@example.com', KEY.enter]], ['Agents for drafts', [KEY.down, KEY.enter]], ['Which provider', KEY.enter],
    ['openai model to use', ['gpt-5-mini', KEY.enter]], ['How will you give the openai key', KEY.enter],
    ['holds the openai key', ['OPENAI_API_KEY', KEY.enter]], ['Add another cloud provider', 'n'],
    ['Single sign-on with', 'y'], ['Single sign-on only', KEY.enter], ['admin console', 'y'],
    ['usual settings', 'n'], ['Backups', ['4', KEY.enter]], ['Size', [KEY.down, KEY.enter]],
    ['SMTP URL', ['SMTP_URL', KEY.enter]], ['Send mail from', ['Slatebox <b@example.com>', KEY.enter]],
  ]
  const typing = (async () => {
    for (const [pattern, keys] of script) {
      await t.waitFor(pattern)
      for (const key of Array.isArray(keys) ? keys : [keys]) { t.stdin.write(key); await new Promise(resolve => setTimeout(resolve, 2)) }
    }
  })()
  const rich = await interview({ ...base(), prompt }, {})
  await typing
  prompt.close()
  assert.deepEqual(rich, plain)
  assert.equal(rich.address.team, 'acme')
})

// ------------------------------------------------------------------ frames

/** The first full frame of a question, as the terminal shows it (no escape codes). */
function frame(writes, marker) {
  const write = writes.find(chunk => plainText(chunk).includes(marker))
  assert.ok(write, `no frame with ${marker}`)
  // (The port this computer would use depends on what else runs here.)
  return plainText(write).replace(/\s+$/gm, '').replace(/localhost:\d+/g, 'localhost:<port>')
}

async function framesAt(columns, env = {}) {
  const { docker, cloud, home } = machine()
  const result = await richCli(['install', '--image', IMAGE], {
    run: docker.run, fetch: cloud.fetch, home, columns, env: { SLATEBOX_CLOUD_URL: cloud.base, ...env }, io,
    script: [['Where should Slatebox run', KEY.enter], ['Where should your team open', KEY.ctrlC]],
  })
  assert.equal(result.code, 7, result.text)
  return result
}

for (const columns of [100, 72, 60]) {
  test(`frames at ${columns} columns: the machine check, "Where" and "Address"`, async () => {
    const result = await framesAt(columns)
    snapshot(`where-${columns}.txt`, frame(result.writes, 'Where should Slatebox run'))
    snapshot(`address-${columns}.txt`, frame(result.writes, 'Where should your team open'))
    // What stays on screen: each line after its last carriage return (spinner frames are redrawn).
    for (const line of result.text.split('\n').map(text => text.split('\r').at(-1))) assert.ok([...line].length <= columns, `wider than ${columns}: ${line}`)
    assert.match(result.text, /Docker engine +29\.4\.0 \(Colima\)/)
    assert.match(result.text, /Port +7070 is free|Port +7070 is taken; \d+ is free/)
  })
}

test('NO_COLOR: no color codes at all; layout, symbols and keys stay', async () => {
  const result = await framesAt(100, { NO_COLOR: '1' })
  assert.doesNotMatch(result.stderr, /\x1b\[[0-9;]*m/, 'no SGR codes')
  assert.ok(!result.stderr.includes('\x1b[38') && !result.stderr.includes('\x1b[48'))
  assert.match(result.text, /◆ {2}Where should Slatebox run\?/)
  snapshot('where-no-color.txt', frame(result.writes, 'Where should Slatebox run'))
})

test('ASCII: a C locale on Linux gets ASCII glyphs', async () => {
  const result = await framesAt(100, { LANG: 'C' })
  const where = frame(result.writes, 'Where should Slatebox run')
  assert.doesNotMatch(where, /[◆│›└]/)
  assert.match(where, /^ \* {2}Where should Slatebox run\? {3}1 of 6$/m)
  assert.match(where, /^ \| {2}> This computer/m)
  snapshot('where-ascii.txt', where)
})

// ------------------------------------------------------------------ a whole install

test('a whole install with the keys: arrows, defaults, a validation error, the review, progress rows and the setup link', async () => {
  const { docker, cloud, home } = machine()
  const result = await richCli(['install', '--image', IMAGE], {
    run: docker.run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base }, io,
    script: [
      ['Where should Slatebox run', [KEY.down, KEY.up, KEY.enter]],
      ['Where should your team open', [KEY.down, KEY.down, KEY.enter]],
      ['Admin email', ['tim@', KEY.left]], ['An email address, like you@example.com', [KEY.ctrlU, 'ops@example.com', KEY.enter]],
      ['Agents for drafts', KEY.enter], ['Single sign-on with', KEY.enter], ['usual settings', KEY.enter],
      [/Install +Change a section… +Cancel/, KEY.enter],
      // 0.3.1: the first admin. Keep the link (shown below), then Enter ends the wait.
      ['Create the admin account now', [KEY.down, KEY.enter]], ['Enter stops waiting', KEY.enter],
    ],
  })
  assert.equal(result.code, 0, result.text)
  const text = result.text
  for (const line of ['◇  Where  This computer', '◇  Address  Only this computer', '◇  Admin email  ops@example.com', '◇  Agents  None for now', '◇  Single sign-on  Off', '◇  Usual settings  Yes', '◇  Review  Install']) {
    assert.ok(text.includes(line), `folded: ${line}`)
  }
  assert.match(text, /╭─ Plan: install "slatebox" on this computer/)
  assert.match(text, /Installing/)
  assert.match(text, /✓ Slatebox is healthy at http:\/\/localhost:\d+/)
  assert.match(text, /✦ Slatebox is running at http:\/\/localhost:\d+/)
  assert.match(text, /https:\/\/box\.example\/setup\/SetupToken\S+/)
  assert.equal(docker.starts().length, 1)
  const record = readFileSync(join(home, 'installs', 'slatebox', 'install.yaml'), 'utf8')
  assert.match(record, /adminEmail: ops@example\.com/)
  // The terminal was given back each time.
  assert.equal(result.modes.at(-1), false)
  assert.ok(result.stderr.includes('\x1b[?25h'), 'the cursor was shown again')
})

test('Docker not running: "This computer" is not offered, SSH is recommended, and r checks again', async () => {
  const { docker, cloud, home } = machine()
  let running = false
  const run = async (cmd, args, options) => (cmd === 'docker' && args[0] === 'version' && !running ? { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' } : docker.run(cmd, args, options))
  const result = await richCli(['install', '--image', IMAGE], {
    run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base }, io,
    script: [
      [/✗ Docker engine +installed, not running/, []],
      [/This computer +needs Docker running/, []],
      [/A Linux server over SSH +installs Docker there if it is missing · recommended/, () => { running = true; return ['r'] }],
      [/✓ Docker engine +29\.4\.0 \(Colima\)/, []],
      [/This computer +Docker 29\.4\.0 \(Colima\) · recommended/, KEY.enter],
      ['Where should your team open', KEY.ctrlC],
    ],
  })
  assert.equal(result.code, 7, result.text)
  assert.match(result.text, /Start Docker Desktop, OrbStack or Colima \(colima start\), then press r to check again\./)
  assert.match(result.text, /◇  Where  This computer/)
})

// ------------------------------------------------------------------ Ctrl-C

const SECTIONS = [
  ['Where should Slatebox run', []],
  ['Where should your team open', [KEY.enter]],
  ['Team address', [KEY.enter]],
  ['Admin email', [KEY.enter]],
  ['Agents for drafts', [KEY.enter]],
  ['Single sign-on with', [KEY.enter]],
  ['usual settings', [KEY.enter]],
  [/Install +Change a section… +Cancel/, [KEY.enter]],
]

test('Ctrl-C at every section: exit 7, "Canceled. Nothing was changed.", nothing pulled, started or written', async () => {
  for (let stop = 0; stop < SECTIONS.length; stop++) {
    const { docker, cloud, home } = machine()
    docker.registry.set(IMAGE, 'never-pulled')
    // Up to the section, the answers that lead there (a team address, "acme", for the address section).
    const script = []
    const answers = [[KEY.enter], [KEY.enter], ['acme', KEY.enter], [KEY.enter], [KEY.enter], [KEY.enter], [KEY.enter], [KEY.enter]]
    for (let i = 0; i <= stop; i++) script.push([SECTIONS[i][0], i === stop ? [KEY.ctrlC] : answers[i]])
    const result = await richCli(['install', '--image', IMAGE], { run: docker.run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base }, io, script })
    assert.equal(result.code, 7, `section ${stop}: ${result.text.slice(-800)}`)
    assert.match(result.text, /■ Canceled\. Nothing was changed\./)
    assert.deepEqual(installed(docker, home), { started: 0, pulled: 0, files: false }, `section ${stop}`)
    assert.equal(cloud.claims.size, 0, 'nothing claimed')
    assert.equal(result.modes.at(-1), false, 'raw mode off at the end')
  }
})

test('Esc or q on the review cancels with exit 7', async () => {
  for (const key of [KEY.esc, 'q']) {
    const { docker, cloud, home } = machine()
    const result = await richCli(['install', '--image', IMAGE, '--local', '--port', '17601', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL'], {
      run: docker.run, fetch: cloud.fetch, home, io, env: { SMTP_URL: 'smtp://u:p@h:587' }, script: [['Where should Slatebox run', KEY.enter], ['Admin email', KEY.enter], [/Install +Change a section… +Cancel/, key]],
    })
    assert.equal(result.code, 7, result.text)
    assert.equal(docker.starts().length, 0)
  }
})

// ------------------------------------------------------------------ the review

test('review: "Change a section" asks that section again and nothing else, then shows the new plan', async () => {
  const { docker, cloud, home } = machine()
  const result = await richCli(['install', '--image', IMAGE, '--local', '--port', '17602'], {
    run: docker.run, fetch: cloud.fetch, home, io,
    script: [
      ['Where should Slatebox run', KEY.enter],
      ['Admin email', ['first@example.com', KEY.enter]], ['Agents for drafts', KEY.enter], ['Single sign-on with', KEY.enter], ['usual settings', KEY.enter],
      [/Install +Change a section… +Cancel/, [KEY.right, KEY.enter]], ['Which section?', ['3', KEY.enter]],
      ['Admin email', ['second@example.com', KEY.enter]],
      [/Install +Change a section… +Cancel/, KEY.enter],
      ['Create the admin account now', [KEY.down, KEY.enter]], ['Enter stops waiting', KEY.enter],
    ],
  })
  assert.equal(result.code, 0, result.text)
  const after = result.text.slice(result.text.indexOf('◇  Change  Admin'))
  assert.ok(after.length < result.text.length, result.text)
  assert.ok(!after.includes('Agents for drafts'), 'agents were not asked again')
  assert.ok(!after.includes('Single sign-on with'), 'sign-in was not asked again')
  assert.match(after, /Admin {5}second@example\.com/)
  assert.match(readFileSync(join(home, 'installs', 'slatebox', 'install.yaml'), 'utf8'), /adminEmail: second@example\.com/)
})

test('review: d shows every file and command, the same as slatebox plan', async () => {
  const { docker, cloud, home } = machine()
  const flags = ['--image', IMAGE, '--local', '--port', '17603', '--admin-email', 'o@example.com', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL']
  const env = { SMTP_URL: 'smtp://u:p@h:587' }
  const plan = await cli(['plan', ...flags, '--json'], { run: docker.run, home, env })
  const commands = plan.events.find(event => event.event === 'plan').commands
  const result = await richCli(['install', ...flags], { run: docker.run, fetch: cloud.fetch, home, io, env, script: [['Where should Slatebox run', KEY.enter], [/Install +Change a section… +Cancel/, 'd'], [/Install +Change a section… +Cancel/, KEY.ctrlC]] })
  assert.equal(result.code, 7)
  // The details are wrapped to the screen: each command is there whole once the wrapping (and the
  // gutter) is taken out, and no line is wider than the terminal.
  const details = result.text.slice(result.text.indexOf('◇  Review  every file and command'))
  const unwrapped = details.replace(/[│└]/g, '').replace(/\s+/g, '')
  for (const command of commands) assert.ok(unwrapped.includes(command.replace(/\s+/g, '')), `d lists: ${command}`)
  for (const line of details.split('\n')) assert.ok([...line].length <= 100, `wider than 100: ${line}`)
})

test('review: d again points up instead of printing every file and command a second time', async () => {
  const { docker, cloud, home } = machine()
  const flags = ['--image', IMAGE, '--local', '--port', '17604', '--admin-email', 'o@example.com', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL']
  const result = await richCli(['install', ...flags], { run: docker.run, fetch: cloud.fetch, home, io, env: { SMTP_URL: 'smtp://u:p@h:587' }, script: [['Where should Slatebox run', KEY.enter], [/Install +Change a section… +Cancel/, 'd'], [/Install +Change a section… +Cancel/, 'd'], ['listed above', []], [/Install +Change a section… +Cancel/, KEY.ctrlC]] })
  assert.equal(result.code, 7)
  assert.equal(result.text.split('Commands:').length - 1, 1, 'the commands were printed once')
  assert.match(result.text, /Every file and command is listed above\./)
})

test('review: on a server over SSH the highlighted action is Cancel, so Enter changes nothing', async () => {
  const calls = []
  const run = async (cmd, args, options = {}) => {
    calls.push({ cmd, args })
    if (cmd !== 'ssh') return { code: 127, stdout: '', stderr: 'missing' }
    if (args.at(-1) === 'sh -s') return { code: 0, stdout: 'uid=0\narch=x86_64\nos=ubuntu 24.04\ndocker_path=\nsystemd=yes\ndisk_kb=99999999\nlistening=22\n', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  const home = sandbox()
  const result = await richCli(['install', 'ssh', 'root@203.0.113.5', '--install-docker', '--admin-email', 'ops@example.com', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL'], {
    run, home, io, env: { SMTP_URL: 'smtp://u:p@h:587' }, script: [['Where should your team open', [KEY.down, KEY.down, KEY.enter]], [/› Cancel/, KEY.enter]],
  })
  assert.equal(result.code, 7, result.text)
  assert.ok(calls.filter(call => call.cmd === 'ssh').every(call => call.args.at(-1) === 'sh -s' || call.args[0] === '-O'), `only the read-only check ran on the server: ${JSON.stringify(calls.map(call => call.args.slice(-3)))}`)
})

// ------------------------------------------------------------------ the setup link

function outroAt(columns, env = {}) {
  const t = rawTerminal({ columns })
  const redactor = new Redactor()
  const token = 'SetupTokenAbCdEfGhIjKlMnOpQrStUvWxYz0123456'
  redactor.add(token)
  const term = detectTerm({ LANG: 'en_US.UTF-8', FORCE_COLOR: '3', ...env }, t.stderr, 'linux')
  const prompt = createRichPrompt({ input: t.stdin, output: t.stderr, term, redactor })
  const url = `https://roscoe.slatebox.team/setup/${token}`
  prompt.outro({ headline: 'Slatebox is running at https://roscoe.slatebox.team', link: { url }, lines: [`a line that names ${token}`], next: ['slatebox status'] })
  prompt.close()
  return { output: t.screen.err, url, token }
}

test('setup link: one unbroken line at 60, 80 and 200 columns; a box only when it fits', () => {
  for (const columns of [60, 80, 200]) {
    const { output, url } = outroAt(columns)
    const lines = plainText(output).split('\n')
    assert.ok(lines.some(line => line.includes(url)), `${columns}: the URL is whole on one line`)
    const boxed = lines.some(line => line.includes('╭─ Create the first account'))
    assert.equal(boxed, columns >= url.length + 8, `${columns}: boxed only when it fits`)
  }
})

test('setup link: OSC 8 only where the terminal opens links; the redactor covers everything else', () => {
  const plain = outroAt(100)
  assert.ok(!plain.output.includes('\x1b]8;;'), 'no OSC 8 in an unknown terminal')
  const linked = outroAt(100, { TERM_PROGRAM: 'iTerm.app' })
  assert.ok(linked.output.includes(`\x1b]8;;${linked.url}\x1b\\`), 'OSC 8 in iTerm2')
  // The token shows only in the link line, which goes past the redactor; elsewhere it is ***.
  const lines = plainText(plain.output).split('\n')
  assert.equal(lines.filter(line => line.includes(plain.token)).length, 1)
  assert.ok(lines.some(line => line.includes('a line that names ***')))
})

// ------------------------------------------------------------------ layout at any width

/** A wizard on a fake terminal, for screens drawn directly. */
function wizardAt(columns, env = {}) {
  const t = rawTerminal({ columns })
  const term = detectTerm({ LANG: 'en_US.UTF-8', FORCE_COLOR: '3', ...env }, t.stderr, 'linux')
  const prompt = createRichPrompt({ input: t.stdin, output: t.stderr, term, redactor: new Redactor(), version: '0.3.0', home: '/home/me' })
  const lines = () => plainText(t.screen.err).split('\n').map(text => text.split('\r').at(-1))
  return { t, prompt, lines }
}
const fits = (lines, columns) => { for (const line of lines) assert.ok([...line].length < columns, `wider than ${columns - 1}: "${line}"`) }

test('"recommended" stays whole on the address question at 60, 72, 100 and 200 columns', async () => {
  for (const columns of [60, 72, 100, 200]) {
    const { docker, cloud, home } = machine()
    const result = await richCli(['install', '--image', IMAGE], {
      run: docker.run, fetch: cloud.fetch, home, columns, env: { SLATEBOX_CLOUD_URL: cloud.base }, io,
      script: [['Where should Slatebox run', KEY.enter], ['Where should your team open', KEY.ctrlC]],
    })
    const address = frame(result.writes, 'Where should your team open')
    assert.match(address, /recommended$/m, `${columns}`)
    assert.doesNotMatch(address, /recommen…/, `${columns}`)
  }
})

test('the plan box wraps long values under their key at 60 and 72 columns, never cuts them', () => {
  for (const columns of [60, 72, 100]) {
    const { prompt, lines } = wizardAt(columns)
    const plan = { action: 'install', name: 'slatebox', where: 'this computer', address: 'https://acme-team.slatebox.team', image: { ref: 'ghcr.io/slatebox/slatebox@sha256:' + 'a'.repeat(64) }, secretsLocation: '/home/me/.slatebox/installs/slatebox/secrets.env on this computer (mode 0600)', warnings: [], changes: [] }
    prompt.planBox(plan, { target: 'local', address: { team: 'acme-team', port: 7070 }, adminEmail: 'ops@example.com', ai: { mode: 'none' }, sso: {}, backups: { to: 'default' }, size: 'small' })
    prompt.close()
    const shown = lines().filter(Boolean)
    fits(shown, columns)
    const text = shown.map(line => line.replace(/^ [│╭╰]─? ?|[│╮╯] *$/g, '').trim()).join(' ').replace(/\s+/g, ' ')
    assert.match(text, /also http:\/\/localhost:7070 on this computer/, `${columns}`)
    assert.match(text, /docker run/, `${columns}`)
    assert.match(text, /~\/\.slatebox\/installs\/slatebox\/secrets\.env on this computer \(mode 0600\)/, `${columns}`)
    assert.ok(!shown.some(line => line.includes('…') && !line.includes('@sha256')), `${columns}: nothing cut: ${shown.join('\n')}`)
    assert.match(shown.at(-1), /d shows every file and command/)
  }
})

test('a plan only run: no "d shows" hint, every file and command wrapped once, and no "..." placeholder', async () => {
  const { docker, cloud, home } = machine()
  const result = await richCli(['plan', '--image', IMAGE, '--local', '--port', '17605', '--admin-email', 'o@example.com', '--ai', 'none', '--no-sso', '--backups', 'off', '--size', 'small', '--mail-url-from', 'env:SMTP_URL'], {
    run: docker.run, fetch: cloud.fetch, home, io, env: { SMTP_URL: 'smtp://u:p@h:587' }, script: [['Where should Slatebox run', KEY.enter]],
  })
  assert.equal(result.code, 0, result.text)
  assert.doesNotMatch(result.text, /d shows every file and command/)
  assert.equal(result.text.split('Commands:').length - 1, 1, 'the plan is printed once')
  assert.doesNotMatch(result.text, /\.\.\. \(the same answers\)/)
  assert.match(result.text, /Nothing was changed\. To install, run slatebox install and choose Install at the review\./)
  for (const line of result.text.split('\n').map(text => text.split('\r').at(-1))) assert.ok([...line].length <= 100, `wider than 100: ${line}`)
})

test('a confirm that does not fit puts its Yes/No on its own line, inside the gutter', async () => {
  for (const columns of [60, 100]) {
    const { prompt, t } = wizardAt(columns)
    const asked = prompt.confirm('Use the usual settings for backups, size and mail?', { default: true, label: 'Usual settings', help: 'Daily backups at 03:00, keep 14 · size small · no mail' })
    await t.waitFor('usual settings')
    const write = t.screen.writes.find(chunk => plainText(chunk).includes('usual settings'))
    t.stdin.write('y')
    await asked
    prompt.close()
    const lines = plainText(write).split('\n').map(text => text.replace(/\s+$/, ''))
    fits(lines, columns)
    const toggle = lines.find(line => line.includes('● Yes'))
    if (columns === 60) assert.match(toggle, /^ │ {2}● Yes {2}○ No$/, `own line: ${lines.join('\n')}`)
    else assert.match(toggle, /mail\? {3}● Yes {2}○ No/)
  }
})

test('a long validation message gets one ▲, its other lines under its text', async () => {
  const { prompt, t } = wizardAt(60)
  const asked = prompt.text('Team address', { label: 'Team address', suffix: '.slatebox.team', normalize: v => v.toLowerCase(), validate: v => (v.length < 3 ? '3–32 characters: a–z, 0–9 and hyphens, starting with a letter, not ending with a hyphen (no two hyphens in a row)' : null) })
  await t.waitFor('Team address')
  t.stdin.write('a')
  await t.waitFor('two hyphens')
  t.stdin.write('CME')
  await new Promise(resolve => setTimeout(resolve, 10))
  t.stdin.write('\r')
  const value = await asked
  prompt.close()
  const write = t.screen.writes.filter(chunk => plainText(chunk).includes('two hyphens')).at(0)
  assert.equal((plainText(write).match(/▲/g) || []).length, 1, plainText(write))
  // The folded answer is the name that is checked and planned: lowercase.
  assert.equal(value, 'acme')
  assert.match(plainText(t.screen.err), /◇ {2}Team address {2}acme\.slatebox\.team/)
  assert.doesNotMatch(plainText(t.screen.err), /◇ {2}Team address {2}aCME/)
})

test('Ctrl-C while a step runs closes its row with ■; no frozen spinner stays behind', () => {
  let clock = 0
  const t = rawTerminal({ columns: 100 })
  const term = detectTerm({ LANG: 'en_US.UTF-8', FORCE_COLOR: '3' }, t.stderr, 'linux')
  const prompt = createRichPrompt({ input: t.stdin, output: t.stderr, term, redactor: new Redactor(), now: () => clock })
  prompt.listener.step('image', 'start', 'Downloading ghcr.io/slatebox/slatebox:v0.3.0 (about 1 GB the first time; later only what changed)')
  clock = 3200
  prompt.fatal({ message: 'Stopped. Run slatebox install again to finish; it is safe to run again.', exitCode: 7 })
  prompt.close()
  const shown = plainText(t.screen.err).split('\n').map(text => text.split('\r').at(-1)).filter(Boolean)
  assert.match(shown.at(-2), /^ ■ Downloading ghcr\.io\/slatebox\/slatebox:v0\.3\.0 \(about 1 GB the first time\) +3\.2s$/)
  assert.match(shown.at(-1), /^ ■ Stopped\./)
  assert.ok(!shown.some(line => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(line)), `no spinner left: ${shown.join('\n')}`)
})

test('rows: one time each, and none under a second', () => {
  let clock = 0
  const t = rawTerminal({ columns: 100 })
  const term = detectTerm({ LANG: 'en_US.UTF-8', FORCE_COLOR: '3' }, t.stderr, 'linux')
  const prompt = createRichPrompt({ input: t.stdin, output: t.stderr, term, redactor: new Redactor(), now: () => clock })
  prompt.listener.step('image', 'start', 'Downloading x')
  clock = 1500
  prompt.listener.step('image', 'ok', 'Downloaded the image in 2s')
  prompt.listener.step('files', 'start', 'Writing')
  clock = 1520
  prompt.listener.step('files', 'ok', 'Wrote ~/x')
  prompt.close()
  const text = plainText(t.screen.err)
  assert.match(text, /✓ Downloaded the image +1\.5s/)
  assert.doesNotMatch(text, /in 2s/)
  assert.match(text, /✓ Wrote ~\/x\n/)
  assert.doesNotMatch(text, /0\.0s/)
})

test('the wizard: section headers are not repeated, the machine and address checks are not shown twice, and "canceled" is US spelling', async () => {
  const { docker, cloud, home } = machine()
  const result = await richCli(['install', '--image', IMAGE], {
    run: docker.run, fetch: cloud.fetch, home, env: { SLATEBOX_CLOUD_URL: cloud.base }, io,
    script: [
      ['Where should Slatebox run', KEY.enter], ['Where should your team open', KEY.enter], ['Team address', ['acme', KEY.enter]],
      ['Admin email', KEY.enter], ['Agents for drafts', KEY.enter], ['Single sign-on with', KEY.enter], ['usual settings', KEY.enter],
      [/Install +Change a section… +Cancel/, KEY.ctrlC],
    ],
  })
  assert.equal(result.code, 7, result.text)
  const text = result.text
  assert.doesNotMatch(text, /^ \d\/6 /m, 'no "1/6 Where" header lines')
  assert.match(text, /Where should Slatebox run\? {3}1 of 6/)
  assert.equal((text.match(/acme\.slatebox\.team is available/g) || []).length, 1, 'the address check once')
  assert.doesNotMatch(text, /this computer: Docker/, 'the machine check is not repeated at the review')
  assert.match(text, /■ Canceled\. Nothing was changed\./)
  assert.doesNotMatch(text, /Cancelled|cancelled/)
})

test('the outro: the key warning is one sentence, set apart, in plain words', () => {
  const { prompt, lines } = wizardAt(100)
  prompt.outro({ headline: 'Slatebox is running at http://localhost:7070', lines: [{ warn: 'Save /home/me/.slatebox/installs/slatebox/secrets.env in your password manager now. It holds the key that unlocks saved agent keys, and backups do not include it: without it, those keys cannot be read after a restore.' }, 'Install record: x'], next: ['slatebox status'] })
  prompt.close()
  const shown = lines()
  const at = shown.findIndex(line => line.includes('▲'))
  assert.ok(at > 0)
  assert.equal(shown[at - 1].trim(), '', 'a blank line before')
  assert.match(shown[at], /^ ▲ Save ~\/\.slatebox\/installs\/slatebox\/secrets\.env in your password manager now\./)
  for (const line of shown.slice(at + 1, shown.findIndex((line, i) => i > at && !line.trim()))) assert.match(line, /^ {3}\S/, 'its other lines are indented under it')
  assert.doesNotMatch(shown.join('\n'), /key encryption key/)
})

// ------------------------------------------------------------------ @clack/core internals

// rich-prompt.mjs relies on these @clack/core 1.6.0 internals (see its header). When an upgrade
// moves them, this fails, instead of the stray footer or a broken Ctrl-U coming back silently.
test('clack internals the wizard relies on are still there', async () => {
  const { ConfirmPrompt, TextPrompt } = await import('@clack/core')
  const t = rawTerminal({ columns: 100 })
  const confirm = new ConfirmPrompt({ input: t.stdin, output: t.stderr, active: 'Yes', inactive: 'No', render: () => '' })
  assert.ok(confirm._subscribers instanceof Map && confirm._subscribers.has('confirm'), 'ConfirmPrompt subscribes its y/n handler as "confirm"')
  const text = new TextPrompt({ input: t.stdin, output: t.stderr, render: () => '' })
  assert.equal(typeof text._setUserInput, 'function', 'TextPrompt._setUserInput')
  assert.ok('_cursor' in text, 'TextPrompt._cursor')
  const asked = text.prompt()
  assert.ok(text.rl, 'TextPrompt.rl once open')
  t.stdin.write('\x03')
  await asked
})
