// `slatebox status` on an install with single sign-on shows the app's session check: each SSO
// account's session is refreshed at Keycloak every 60 seconds, at most 500 accounts per pass, and
// status warns when more were due than one pass checks. Against FakeDocker.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { cli, FakeDocker, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:0.2.2'
const INSTALL = ['--image', IMAGE, '--ai', 'none', '--backups', 'off', '--port', '17482', '--target', 'local', '--size', 'small', '--admin-email', 'ops@example.com', '--yes']

function box({ commands = ['setup-link', 'sso-sessions'] } = {}) {
  const docker = new FakeDocker({ settings: LEGACY_SETTINGS, commands, setUp: true })
  docker.addImage(IMAGE)
  const home = sandbox()
  const run = (argv, options = {}) => cli(argv, { run: docker.run, home, ...options })
  return { docker, run }
}

const sessionCalls = docker => docker.count(call => call.args.includes('sso') && call.args.includes('sessions'))

test('status shows the session check and its 500-accounts-per-pass cap; no warning while under it', async () => {
  const { docker, run } = box()
  assert.equal((await run(['install', ...INSTALL, '--sso'])).code, 0)
  docker.ssoSessions = {
    ran: true, at: '2026-11-25T12:00:00.000Z', ageSeconds: 12, checkSeconds: 60, cap: 500, due: 41, checked: 41, revoked: 0,
    overCap: false, overCapAt: null, stale: false, warning: null,
    line: 'every 60 s, last pass 12 s ago: 41 due, 41 checked, 0 signed out (at most 500 accounts per pass)',
  }
  const shown = await run(['status', '--agent', 'no'])
  assert.match(shown.stdout, /SSO check {4}every 60 s, last pass 12 s ago: 41 due, 41 checked, 0 signed out \(at most 500 accounts per pass\)/)
  assert.doesNotMatch(shown.stderr, /session check/i)
  const json = (await run(['status', '--json'])).events.at(-1)
  assert.equal(json.ssoSessions.cap, 500)
  assert.equal(json.ssoSessions.due, 41)
})

test('status warns when more accounts were due than one pass checks', async () => {
  const { docker, run } = box()
  assert.equal((await run(['install', ...INSTALL, '--sso'])).code, 0)
  const warning = 'More single sign-on accounts were due for the session check than one pass checks (500), last at 2026-11-25T12:00:00.000Z. Someone removed at the identity provider can keep access for longer than 60 s.'
  docker.ssoSessions = {
    ran: true, at: '2026-11-25T12:00:00.000Z', ageSeconds: 5, checkSeconds: 60, cap: 500, due: 730, checked: 500, revoked: 2,
    overCap: true, overCapAt: '2026-11-25T12:00:00.000Z', stale: false, warning,
    line: 'every 60 s, last pass 5 s ago: 730 due, 500 checked, 2 signed out (at most 500 accounts per pass)',
  }
  const shown = await run(['status', '--agent', 'no'])
  assert.ok(shown.stderr.includes(warning), shown.stderr)
  assert.match(shown.stdout, /730 due, 500 checked/)
  assert.equal((await run(['status', '--json'])).events.at(-1).ssoSessions.overCap, true)
})

test('without SSO, or with an image older than the session record, status asks nothing and shows nothing', async () => {
  const plain = box()
  assert.equal((await plain.run(['install', ...INSTALL, '--no-sso'])).code, 0)
  const off = await plain.run(['status', '--agent', 'no'])
  assert.doesNotMatch(off.stdout, /SSO check/)
  assert.equal(sessionCalls(plain.docker), 0, 'SSO off: the session check is not asked for')

  const older = box({ commands: ['setup-link'] })
  assert.equal((await older.run(['install', ...INSTALL, '--sso'])).code, 0)
  const status = await older.run(['status', '--json'])
  assert.equal(status.code, 0)
  assert.equal(status.events.at(-1).ssoSessions, undefined)
  assert.equal(status.events.at(-1).sso, 'on')
})
