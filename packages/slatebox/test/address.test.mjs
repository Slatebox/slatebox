// Team addresses (https://<name>.slatebox.team) end to end through the CLI, against stand-ins for
// Docker and Slatebox Cloud: the claim, the files and their modes, re-runs, a lost token or
// credential, rotation, rename, release on uninstall, and every way it can fail before anything
// is changed. No network: the Cloud is a fetch function (fakes.mjs FakeCloud).
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { teamAddressProblem } from '../src/cloud.mjs'
import { Redactor } from '../src/secrets.mjs'
import { ACCESS, CREDENTIAL, cli, DEVICE, FakeCloud, FakeDocker, ROTATED, sandbox, TUNNEL } from './fakes.mjs'

const IMAGE = 'slatebox-test:0.2.0'
const SETTINGS = [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN']
const BASE = ['--image', IMAGE, '--ai', 'none', '--backups', 'off', '--port', '17480']
const SECRETS = [TUNNEL, ROTATED, CREDENTIAL, ACCESS, DEVICE, 'fake-install-credential-0123456789']

function setup({ cloud: cloudOptions, docker: dockerOptions } = {}) {
  const docker = new FakeDocker({ settings: SETTINGS, commands: ['tunnel'], ...dockerOptions })
  docker.addImage(IMAGE)
  const cloud = new FakeCloud(cloudOptions)
  const home = sandbox()
  const run = (argv, extra = {}) => cli(argv, {
    run: docker.run, home, fetch: cloud.fetch, env: { SLATEBOX_CLOUD_URL: cloud.base, ...extra.env },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => { throw new Error('no browser in tests') }, teamHealthDelay: 1, teamHealthAttempts: 3 },
    ...extra,
  })
  const dir = join(home, 'installs', 'slatebox')
  return { docker, cloud, home, run, dir }
}

const mode = path => statSync(path).mode & 0o777
const ups = docker => docker.count(call => call.cmd === 'docker' && call.args[0] === 'compose' && call.args.includes('up'))

function noSecretIn(result, label = '') {
  const text = result.stdout + result.stderr
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${label}: a secret was printed`)
}

test('happy path: sign in, claim, 0600 credential and token, URL and HTTPS off, loopback port only, nothing secret printed', async () => {
  const { docker, cloud, run, dir } = setup()
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  noSecretIn(result, 'install')

  // The sign-in: a code for the person, polled until approved, for the team-addresses scope only.
  const signIn = result.events.find(event => event.event === 'sign-in' && event.status === 'waiting')
  assert.equal(signIn.userCode, 'WDJB-MJHT')
  assert.equal(signIn.verificationUri, `${cloud.base}/device`)
  assert.match(result.stderr, /Open: {2}http:\/\/127\.0\.0\.1:3999\/device\n {2}Code: {2}WDJB-MJHT/)
  const [authorize] = cloud.cloudRequests('/oauth/device_authorization')
  assert.deepEqual(authorize.body, { client_id: 'slatebox-cli', scope: 'team-addresses', device_label: 'test-box' })
  assert.equal(cloud.cloudRequests('/oauth/token').length, 2, 'polled until approved')

  // The claim: the person's token, an idempotency key, never the install's own credential.
  const [claim] = cloud.cloudRequests('/api/v1/team-addresses').filter(request => request.method === 'POST' && request.path === '/api/v1/team-addresses')
  assert.equal(claim.headers.authorization, `Bearer ${ACCESS}`)
  assert.match(claim.headers['idempotency-key'], /^[a-f0-9]{64}$/)
  assert.equal(claim.body.name, 'acme')

  // Files: the credential stays here, 0600 in a 0700 folder; the token is in secrets.env only.
  const credentials = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8'))
  assert.deepEqual({ ...credentials, claimedAt: undefined }, { claimId: 'ta_1', name: 'acme', host: 'acme.slatebox.team', cloudUrl: cloud.base, installCredential: CREDENTIAL, claimedAt: undefined })
  assert.equal(mode(join(dir, 'credentials.json')), 0o600)
  assert.equal(mode(dir), 0o700)
  assert.equal(mode(join(dir, 'secrets.env')), 0o600)
  assert.match(readFileSync(join(dir, 'secrets.env'), 'utf8'), new RegExp(`^SLATEBOX_TUNNEL_TOKEN='${TUNNEL}'$`, 'm'))
  const settings = readFileSync(join(dir, 'slatebox.env'), 'utf8')
  assert.match(settings, /^SLATEBOX_URL='https:\/\/acme\.slatebox\.team'$/m)
  assert.match(settings, /^SLATEBOX_HTTPS='off'$/m)
  assert.ok(!settings.includes(TUNNEL), 'no token in the settings file')
  const compose = readFileSync(join(dir, 'compose.yaml'), 'utf8')
  assert.match(compose, /ports:\n {4}- 127\.0\.0\.1:17480:7070\n/)
  assert.ok(!/443|:80:/.test(compose), 'no public port')
  const record = readFileSync(join(dir, 'install.yaml'), 'utf8')
  assert.match(record, /team: acme/)
  for (const secret of SECRETS) assert.ok(!record.includes(secret), 'the record holds no secret')
  assert.ok(!existsSync(join(dir, 'claim.json')), 'the pending claim key is removed once claimed')

  // No secret in any docker argument either.
  for (const call of docker.calls) for (const secret of SECRETS) assert.ok(!call.args.join(' ').includes(secret))
  const done = result.events.at(-1)
  assert.equal(done.event, 'done')
  assert.equal(done.address, 'https://acme.slatebox.team')
  assert.equal(done.teamAddress, 'https://acme.slatebox.team')
  assert.ok(result.events.some(event => event.event === 'step' && event.id === 'tunnel' && /4 connections/.test(event.detail)))
})

test('the closing text names the address and how the first admin gets in: the one-time setup link, nobody signs up before it', async () => {
  const { run, docker } = setup({ docker: { commands: ['tunnel', 'setup-link'] } })
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Slatebox is running at {2}https:\/\/acme\.slatebox\.team/)
  // Not at a terminal: no link is made or printed; the closing says how to get one at a terminal.
  assert.match(result.stdout, /Nobody can sign up until the first admin exists\. Get the one-time setup link at a terminal:\n {2}slatebox setup-link\n/)
  assert.deepEqual(docker.setupLinks, [])
  // The stopgap "sign up before anyone else does" advice is gone: nobody else can.
  assert.doesNotMatch(result.stdout, /Create the first account now|before you share it/)
  assert.match(result.stdout, /credentials\.json|team-address credential/)
  noSecretIn(result, 'closing')
})

test('a taken or reserved name: exit 3 with suggestions, the same answer for both, nothing claimed or written', async () => {
  const { docker, cloud, run, home } = setup({ cloud: { taken: ['support'] } })
  const result = await run(['install', '--team-address', 'support', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 3)
  const error = result.events.at(-1)
  assert.equal(error.id, 'address-unavailable')
  assert.deepEqual(error.suggestions, ['support-team', 'team-support'])
  assert.match(error.message, /support\.slatebox\.team isn't available/)
  assert.equal(cloud.cloudRequests('/oauth').length, 0, 'no sign-in')
  assert.equal(ups(docker), 0)
  assert.ok(!existsSync(join(home, 'installs', 'slatebox', 'secrets.env')))
})

test('an e2e- name skips the signed-out check (the Cloud allows it only after sign-in) and the claim decides', async () => {
  const { cloud, run } = setup({ cloud: { taken: ['e2e-1234abcd'] } })
  const result = await run(['install', '--team-address', 'e2e-1234abcd', ...BASE, '--yes', '--json'])
  assert.equal(cloud.cloudRequests('/api/v1/team-addresses/availability').length, 0, 'no signed-out check')
  assert.equal(cloud.cloudRequests('/oauth/device_authorization').length, 1, 'signed in')
  assert.equal(result.code, 3)
  assert.equal(result.events.at(-1).id, 'address-unavailable')
})

test('a name that breaks the rule is exit 2 with the rule, before any network call', async () => {
  const { cloud, run } = setup()
  for (const name of ['Acme_1', 'ab', 'xn--acme', 'acme-', '1acme', 'a'.repeat(33)]) {
    const result = await run(['install', '--team-address', name, ...BASE, '--yes', '--json'])
    assert.equal(result.code, 2, name)
    assert.match(result.events.at(-1).fields.map(f => f.message).join(' '), /3–32 characters/, name)
  }
  assert.equal(cloud.requests.length, 0)
  assert.equal(teamAddressProblem('acme-support'), null)
  assert.equal(teamAddressProblem('a--b'), teamAddressProblem('xn--x'))
})

test('offline: exit 4, says how to install without an address, nothing written', async () => {
  const { docker, run, home } = setup({ cloud: { offline: true } })
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 4)
  const error = result.events.at(-1)
  assert.match(error.message, /Slatebox Cloud \(127\.0\.0\.1:3999\) can't be reached: ENOTFOUND/)
  assert.match(error.message, /Nothing was changed/)
  assert.match(error.message, /npx slatebox install --local/)
  assert.equal(ups(docker), 0)
  assert.ok(!existsSync(join(home, 'installs', 'slatebox', 'compose.yaml')))
})

test('no Docker: exit 4 before any sign-in, so no name is claimed on a machine that cannot run it', async () => {
  const { cloud, run } = setup()
  const noDocker = cmd => ({ code: 127, stdout: '', stderr: `${cmd} is not installed` })
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { run: noDocker, platform: 'linux' })
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /Docker is not installed/)
  assert.equal(cloud.requests.length, 0)
})

test('a plan only checks the name; it signs in and claims nothing', async () => {
  const { cloud, run, docker } = setup()
  const result = await run(['plan', '--team-address', 'acme', ...BASE, '--json'])
  assert.equal(result.code, 0, result.stderr)
  const plan = result.events.find(event => event.event === 'plan')
  assert.match(plan.notes.join(' '), /sign in to Slatebox in your browser to claim acme\.slatebox\.team/)
  assert.ok(plan.files.some(file => file.path.endsWith('credentials.json')))
  assert.deepEqual(cloud.requests.map(request => request.path), ['/api/v1/team-addresses/availability?name=acme'])
  assert.equal(ups(docker), 0)
  noSecretIn(result, 'plan')
})

test('a person who denies the sign-in: exit 7, nothing claimed or written', async () => {
  const { cloud, run, dir, docker } = setup()
  cloud.deny = true
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 7)
  assert.equal(cloud.claims.size, 0)
  assert.ok(!existsSync(join(dir, 'credentials.json')))
  assert.equal(ups(docker), 0)
})

test('re-run: nothing to change, and no network at all (no sign-in, no token fetch)', async () => {
  const { cloud, run, docker } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const before = cloud.requests.length
  const upsBefore = ups(docker)
  const again = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(again.code, 0, again.stderr)
  assert.equal(again.events.at(-1).nothingToChange, true)
  assert.equal(cloud.requests.length, before)
  assert.equal(ups(docker), upsBefore)
  // Without the flag the record's address is kept.
  const plain = await run(['install', ...BASE, '--yes', '--json'])
  assert.equal(plain.code, 0, plain.stderr)
  assert.equal(plain.events.at(-1).address, 'https://acme.slatebox.team')
})

test('a lost token is fetched again with the install credential, without a sign-in', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  writeFileSync(join(dir, 'secrets.env'), readFileSync(join(dir, 'secrets.env'), 'utf8').replace(/^SLATEBOX_TUNNEL_TOKEN=.*\n/m, ''), { mode: 0o600 })
  const signIns = cloud.cloudRequests('/oauth').length
  const result = await run(['install', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  noSecretIn(result, 're-fetch')
  assert.equal(cloud.cloudRequests('/oauth').length, signIns, 'no new sign-in')
  const [fetch] = cloud.cloudRequests('/api/v1/team-addresses/self/connector-token')
  assert.equal(fetch.headers.authorization, `Bearer ${CREDENTIAL}`)
  assert.match(readFileSync(join(dir, 'secrets.env'), 'utf8'), new RegExp(`SLATEBOX_TUNNEL_TOKEN='${TUNNEL}'`))
})

test('a revoked credential with a lost token: sign in, mint a new credential, fetch the token', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  writeFileSync(join(dir, 'secrets.env'), readFileSync(join(dir, 'secrets.env'), 'utf8').replace(/^SLATEBOX_TUNNEL_TOKEN=.*\n/m, ''), { mode: 0o600 })
  cloud.revoked = true
  cloud.pendingPolls = 0
  const result = await run(['install', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(cloud.cloudRequests('/api/v1/team-addresses/ta_1/install-credential').length, 1)
  const credentials = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8'))
  assert.equal(credentials.installCredential, cloud.credential)
  assert.notEqual(credentials.installCredential, CREDENTIAL)
  assert.equal(mode(join(dir, 'credentials.json')), 0o600)
  assert.ok(!(result.stdout + result.stderr).includes(cloud.credential))
})

test('a credential file others can read is refused with the command that fixes it', async () => {
  const { run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  chmodSync(join(dir, 'credentials.json'), 0o644)
  const result = await run(['install', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /chmod 700 .* && chmod 600 .*credentials\.json/)
  noSecretIn(result, 'refused')
})

test('another name on an install that has one is a rename, not a second claim', async () => {
  const { cloud, run } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const result = await run(['install', '--team-address', 'other', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 2)
  assert.match(result.events.at(-1).message, /slatebox rename other/)
  assert.equal(cloud.claims.size, 1)
})

test('address rotate: a new secret, the new token written, the container recreated', async () => {
  const { cloud, run, dir, docker } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const upsBefore = ups(docker)
  const result = await run(['address', 'rotate', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  noSecretIn(result, 'rotate')
  const [rotate] = cloud.cloudRequests('/api/v1/team-addresses/self/connector-token')
  assert.deepEqual(rotate.body, { rotate: true })
  assert.match(readFileSync(join(dir, 'secrets.env'), 'utf8'), new RegExp(`SLATEBOX_TUNNEL_TOKEN='${ROTATED}'`))
  assert.equal(ups(docker), upsBefore + 1)
})

test('rename: sign in, move, recreate at the new URL, then tell Cloud the move is done', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  cloud.pendingPolls = 0
  const result = await run(['rename', 'acme-boards', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  noSecretIn(result, 'rename')
  assert.equal(cloud.cloudRequests('/api/v1/team-addresses/ta_1/rename').length, 1)
  assert.equal(cloud.cloudRequests('/api/v1/team-addresses/self/rename-complete').length, 1)
  assert.match(readFileSync(join(dir, 'slatebox.env'), 'utf8'), /^SLATEBOX_URL='https:\/\/acme-boards\.slatebox\.team'$/m)
  assert.equal(JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8')).name, 'acme-boards')
  assert.match(readFileSync(join(dir, 'install.yaml'), 'utf8'), /team: acme-boards/)
  assert.equal(result.events.at(-1).address, 'https://acme-boards.slatebox.team')
})

test('status shows the team address, its state and the tunnel connections', async () => {
  const { run } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const result = await run(['status'])
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Team address https:\/\/acme\.slatebox\.team \(active, 4 connections\)/)
  noSecretIn(result, 'status')
})

test('uninstall releases the address with the install credential, no sign-in', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const signIns = cloud.cloudRequests('/oauth').length
  const result = await run(['uninstall', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  const [release] = cloud.cloudRequests('/api/v1/team-addresses/self').filter(request => request.method === 'DELETE')
  assert.equal(release.headers.authorization, `Bearer ${CREDENTIAL}`)
  assert.equal(cloud.cloudRequests('/oauth').length, signIns)
  assert.equal(result.events.at(-1).addressReleased, true)
  assert.ok(!existsSync(join(dir, 'credentials.json')))
  assert.doesNotMatch(readFileSync(join(dir, 'install.yaml'), 'utf8'), /team: acme/)
  assert.match(result.events.find(event => event.event === 'plan').warnings.join(' '), /acme\.slatebox\.team is released/)
})

test('uninstall --keep-address keeps the claim and the credential', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const result = await run(['remove', '--keep-address', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(cloud.cloudRequests('/api/v1/team-addresses/self').filter(request => request.method === 'DELETE').length, 0)
  assert.ok(existsSync(join(dir, 'credentials.json')))
})

test('uninstall while offline finishes here, keeps the credential, and says how to release later', async () => {
  const { cloud, run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  cloud.offline = true
  const result = await run(['uninstall', '--delete-data', '--confirm', 'slatebox', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.at(-1).addressReleased, false)
  assert.match(result.stderr, /slatebox address release/)
  assert.ok(existsSync(join(dir, 'credentials.json')), 'kept for a later release')
  assert.ok(!existsSync(join(dir, 'secrets.env')), 'the rest is deleted as asked')
  // Later, online: the credential alone is enough.
  cloud.offline = false
  const later = await run(['address', 'release', '--json'])
  assert.equal(later.code, 0, later.stderr)
  assert.equal([...cloud.claims.values()][0].status, 'released')
  assert.ok(!existsSync(join(dir, 'credentials.json')))
})

test('address release keeps the install, which then answers on this computer only', async () => {
  const { run, dir } = setup()
  assert.equal((await run(['install', '--team-address', 'acme', ...BASE, '--yes'])).code, 0)
  const result = await run(['address', 'release', '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.at(-1).address, 'http://localhost:17480')
  assert.doesNotMatch(readFileSync(join(dir, 'secrets.env'), 'utf8'), /SLATEBOX_TUNNEL_TOKEN/)
  assert.doesNotMatch(readFileSync(join(dir, 'slatebox.env'), 'utf8'), /SLATEBOX_HTTPS/)
})

test('--local replaces a team address from an earlier answer; a domain and a team address together are refused', async () => {
  const { run } = setup()
  const both = await run(['plan', '--team-address', 'acme', '--domain', 'boards.example.com', ...BASE, '--json'])
  assert.equal(both.code, 2)
  const local = await run(['plan', '--local', ...BASE, '--json'])
  assert.equal(local.code, 0, local.stderr)
  assert.equal(local.events.find(event => event.event === 'plan').address, 'http://localhost:17480')
})

test('an image without tunnel support is refused with the reason, before any claim', async () => {
  const { cloud, run } = setup({ docker: { settings: LEGACY_SETTINGS } })
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'])
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /does not support a team address/)
  assert.equal(cloud.claims.size, 0)
})

test('the redactor removes install credentials and tunnel tokens by their shape, whoever printed them', () => {
  const redactor = new Redactor()
  const text = `cred ${CREDENTIAL} token ${TUNNEL} rotated ${ROTATED}`
  const out = redactor.redact(text)
  for (const secret of [CREDENTIAL, TUNNEL, ROTATED]) assert.ok(!out.includes(secret))
  assert.equal(out, 'cred *** token *** rotated ***')
  assert.equal(redactor.redact('eyJhbGciOi is a JWT header, sbxi alone is a word'), 'eyJhbGciOi is a JWT header, sbxi alone is a word')
})

test('a claim always goes through the browser sign-in: no personal-token shortcut (Cloud never gives one the scope)', async () => {
  const { cloud, run } = setup()
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { env: { SLATEBOX_CLOUD_URL: cloud.base, SLATEBOX_CLOUD_TOKEN: 'sbp_personal-token-that-cloud-refuses-for-claims' } })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(cloud.cloudRequests('/oauth/device_authorization').length, 1)
  const [claim] = cloud.cloudRequests('/api/v1/team-addresses').filter(request => request.method === 'POST')
  assert.equal(claim.headers.authorization, `Bearer ${ACCESS}`)
  noSecretIn(result, 'device')
})

test('a Cloud URL must be https, except on this computer', async () => {
  const { run } = setup()
  const result = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { env: { SLATEBOX_CLOUD_URL: 'http://evil.example.com' } })
  assert.equal(result.code, 2)
  assert.match(result.events.at(-1).message, /must be https/)
})

test('at a terminal the sign-in offers to open the browser on the Cloud\'s own page, and claims after approval', async () => {
  const { cloud, home, docker } = setup()
  const opened = []
  // Every other question is answered by a flag; the one left (mail) is skipped with Enter, the plan
  // is approved with Enter. (Without --yes: with it nothing is asked; see the test after this one.)
  const flags = ['--target', 'local', '--admin-email', 'ops@example.com', '--no-sso', '--size', 'small']
  const result = await cli(['install', '--team-address', 'acme', ...BASE, ...flags], {
    run: docker.run, home, fetch: cloud.fetch, tty: true, input: '\n\ny\n', env: { SLATEBOX_CLOUD_URL: cloud.base },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: url => opened.push(url), teamHealthDelay: 1, teamHealthAttempts: 3 },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /Open it in your browser now\? \[Y\/n\]/)
  assert.deepEqual(opened, [`${cloud.base}/device?code=WDJB-MJHT`])
  assert.equal(cloud.claims.size, 1)
})

test('the interview asks where the team opens Slatebox, and asks again for a name that is not free', async () => {
  const { cloud, home, docker } = setup({ cloud: { taken: ['support'] } })
  const flags = ['--target', 'local', '--admin-email', 'ops@example.com', '--no-sso', '--size', 'small', '--image', IMAGE, '--ai', 'none', '--backups', 'off']
  // Without --yes (with it nothing is asked): the last Enter approves the plan, n leaves the browser closed.
  const result = await cli(['install', ...flags], {
    run: docker.run, home, fetch: cloud.fetch, tty: true, input: '1\nsupport\nacme\n\n\nn\n', env: { SLATEBOX_CLOUD_URL: cloud.base },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {}, teamHealthDelay: 1, teamHealthAttempts: 3 },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, /Where should your team open Slatebox\?\n {2}1\) A free team address, https:\/\/<name>\.slatebox\.team {2}\(recommended: no DNS, ports or certificates\) {2}\[default\]\n {2}2\) My own domain/)
  assert.match(result.stderr, /\[!!\] support\.slatebox\.team isn't available\.\n {5}Free right now: support-team, team-support/)
  assert.match(result.stderr, /\[ok\] acme\.slatebox\.team is available/)
  assert.equal([...cloud.claims.values()][0].name, 'acme')
  assert.match(result.stdout, /Slatebox is running at {2}https:\/\/acme\.slatebox\.team/)
})

test('a tunnel Cloudflare refused: the install succeeds with a warning that says so, and status names it', async () => {
  const { run, docker } = setup({ cloud: { taken: [] } })
  const original = docker.run
  const refused = async (cmd, args, options) => args.includes('tunnel')
    ? { code: 1, stdout: '{"configured":true,"ready":false,"connections":0,"state":"failed","error":"refused"}\n', stderr: '' }
    : original(cmd, args, options)
  const install = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { run: refused, fetch: async () => { throw new TypeError('fetch failed') } })
  // The claim needs the Cloud; this run has none, so it stops before anything (exit 4) ...
  assert.equal(install.code, 4)
  // ... and with the Cloud, the refused tunnel is a warning, not a failure.
  const ok = await run(['install', '--team-address', 'acme', ...BASE, '--yes', '--json'], { run: refused })
  assert.equal(ok.code, 0, ok.stderr)
  const warning = ok.events.find(event => event.event === 'step' && event.id === 'health' && event.status === 'warn')
  assert.match(warning.detail, /Cloudflare refused its secure tunnel/)
  assert.doesNotMatch(warning.detail, /keeps trying/)
  const status = await run(['status', '--agent', 'no'], { run: refused })
  assert.match(status.stdout, /Team address https:\/\/acme\.slatebox\.team \(active, tunnel refused by Cloudflare\)/)
})
