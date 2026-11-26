// Golden transcripts of the installer's text, recorded before the 0.3.0 wizard in the terminal
// and held byte for byte after it: the plain interactive run (what --plain, TERM=dumb, CI and
// narrow terminals get), --yes, a run with nobody to ask (exit 3), and --json (stdout parses as
// JSON, the same events in the same order, and never an escape code). The fake terminal here has
// no setRawMode, so these runs stay plain whatever the wizard does.
// SLATEBOX_UPDATE_GOLDEN=1 rewrites the files.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { cli, FakeCloud, FakeDocker, sandbox } from './fakes.mjs'

const GOLDEN = fileURLToPath(new URL('./golden/transcripts/', import.meta.url))
const UPDATE = process.env.SLATEBOX_UPDATE_GOLDEN === '1'
const IMAGE = 'slatebox-test:transcript'
const lots = { bavail: 1e9, bsize: 4096 }

/** Paths and run-dependent values replaced, so a transcript is the same on every machine. */
export function normalize(text, home) {
  return text.split(home).join('<HOME>')
    .replace(/\/(private\/)?(var|tmp)\/[^\s'"]*sbx-[^\s/'"]*/g, '<TMP>')
    .replace(/\d+(\.\d+)?s so far/g, '<N>s so far')
}

function check(name, actual) {
  const file = join(GOLDEN, name)
  if (UPDATE || !existsSync(file)) {
    mkdirSync(GOLDEN, { recursive: true })
    writeFileSync(file, actual)
    if (!UPDATE) assert.fail(`${name} had no golden file; one was written. Run again.`)
    return
  }
  assert.equal(actual, readFileSync(file, 'utf8'), `${name} differs from the golden transcript (SLATEBOX_UPDATE_GOLDEN=1 rewrites it)`)
}

function local(options) {
  const docker = new FakeDocker({ provider: 'colima', serverArch: 'arm64', ...options })
  docker.addImage(IMAGE)
  return { docker, home: sandbox() }
}

export const SCENARIOS = {
  // A person at a terminal: this computer, port given, no email, no agents, no SSO, backups off, small, no mail, yes.
  'plain-local': async () => {
    const { docker, home } = local()
    const input = ['1', '', '1', 'n', '4', '', '', 'y'].join('\n') + '\n'
    const result = await cli(['install', '--image', IMAGE, '--port', '17561'], { run: docker.run, home, tty: true, input, platform: 'linux', io: { statfs: () => lots, localPort: async () => 7070, portFree: async () => true } })
    return { result, home }
  },
  // The free team address: "support" is taken, its suggestions are shown, then "acme".
  'plain-team-taken': async () => {
    const docker = new FakeDocker({ provider: 'orbstack', serverArch: 'arm64', settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'] })
    docker.addImage(IMAGE)
    const cloud = new FakeCloud({ taken: ['support'] })
    const home = sandbox()
    const flags = ['--target', 'local', '--admin-email', 'ops@example.com', '--no-sso', '--size', 'small', '--image', IMAGE, '--ai', 'none', '--backups', 'off']
    const result = await cli(['install', ...flags], {
      // A Linux desktop (DISPLAY set), so the browser question is asked; no answer is left for
      // the first-admin question (0.3.1), which leaves the printed link as it is.
      run: docker.run, home, fetch: cloud.fetch, tty: true, input: '1\nsupport\nacme\n\n\nn\n', platform: 'linux', env: { SLATEBOX_CLOUD_URL: cloud.base, DISPLAY: ':0' },
      io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {}, teamHealthDelay: 1, teamHealthAttempts: 3, statfs: () => lots, localPort: async () => 7070, portFree: async () => true },
    })
    return { result, home }
  },
  // A Linux server over SSH that has no Docker: the host is asked, checked, and the run stops (exit 4).
  'plain-ssh': async () => {
    const home = sandbox()
    const run = async (cmd, args, options = {}) => {
      if (cmd === 'ssh' && args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
      if (cmd === 'ssh' && String(options.input).includes('uid=$(id -u)')) return { code: 0, stdout: 'uid=0\narch=x86_64\ndocker_path=\nsystemd=yes\ndisk_kb=99999999\n', stderr: '' }
      return { code: 1, stdout: '', stderr: '' }
    }
    const result = await cli(['install'], { run, home, tty: true, input: '2\nroot@box\n', platform: 'linux' })
    return { result, home }
  },
  'yes': async () => {
    const { docker, home } = local()
    const result = await cli(['install', '--image', IMAGE, '--port', '17562', '--ai', 'none', '--backups', 'off', '--yes'], { run: docker.run, home, platform: 'linux', io: { statfs: () => lots, localPort: async () => 7070, portFree: async () => true } })
    return { result, home }
  },
  'non-tty': async () => {
    const { docker, home } = local()
    const result = await cli(['install', '--image', IMAGE], { run: docker.run, home, platform: 'linux', io: { statfs: () => lots, localPort: async () => 7070, portFree: async () => true } })
    return { result, home }
  },
  'json': async () => {
    const { docker, home } = local()
    const result = await cli(['install', '--image', IMAGE, '--port', '17563', '--ai', 'none', '--backups', 'off', '--yes', '--json'], { run: docker.run, home, platform: 'linux', io: { statfs: () => lots, localPort: async () => 7070, portFree: async () => true } })
    return { result, home }
  },
}

for (const name of ['plain-local', 'plain-team-taken', 'plain-ssh', 'yes', 'non-tty']) {
  test(`transcript: ${name} is byte for byte the golden one`, async () => {
    const { result, home } = await SCENARIOS[name]()
    check(`${name}.stdout.txt`, normalize(result.stdout, home))
    check(`${name}.stderr.txt`, normalize(result.stderr, home))
    check(`${name}.code.txt`, `${result.code}\n`)
  })
}

test('transcript: --json keeps stdout to JSON events, the same sequence, never an escape code', async () => {
  const { result, home } = await SCENARIOS.json()
  assert.equal(result.code, 0, result.stderr)
  const lines = result.stdout.split('\n').filter(Boolean)
  for (const line of lines) assert.doesNotThrow(() => JSON.parse(line), line)
  assert.ok(!result.stdout.includes('\x1b'), 'no escape codes on stdout')
  const sequence = lines.map(line => JSON.parse(line)).map(event => ({ event: event.event, ...(event.id ? { id: event.id } : {}), ...(event.status ? { status: event.status } : {}) }))
  check('json.events.json', `${JSON.stringify(sequence, null, 1)}\n`)
  check('json.stderr.txt', normalize(result.stderr, home))
})
