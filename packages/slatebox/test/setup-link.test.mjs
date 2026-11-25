// The first admin of a self-hosted Slatebox: nobody can sign up until the image's one-time setup
// link is used. The installer makes and prints the link only to a person at a terminal (it is as
// good as an admin password), says how to get one otherwise, and `slatebox setup-link` prints a new
// one that ends the last. Against FakeDocker, whose image knows `slatebox setup-link`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { Redactor } from '../src/secrets.mjs'
import { cli, FakeCloud, FakeDocker, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:0.2.0'
const LOCAL = ['--image', IMAGE, '--ai', 'none', '--backups', 'off', '--port', '17481', '--target', 'local', '--no-sso', '--size', 'small', '--admin-email', 'ops@example.com']

function box({ commands = ['tunnel', 'setup-link'] } = {}) {
  const docker = new FakeDocker({ settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands })
  docker.addImage(IMAGE)
  const home = sandbox()
  const run = (argv, options = {}) => cli(argv, { run: docker.run, home, io: { teamHealthDelay: 1, teamHealthAttempts: 3 }, ...options })
  return { docker, home, run }
}

const everything = result => result.stdout + result.stderr
const tokens = docker => docker.setupLinks

test('at a terminal the install makes one setup link and prints it to the terminal only, never to stdout', async () => {
  const { docker, run } = box()
  const result = await run(['install', ...LOCAL, '--yes'], { tty: true, input: '\n\n\n' })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(tokens(docker).length, 1)
  const [token] = tokens(docker)
  assert.match(result.stderr, new RegExp(` {2}https://box\\.example/setup/${token} {3}\\(printed to this terminal only\\)\\n`))
  assert.ok(!result.stdout.includes(token), 'not on stdout, which may be a pipe or a log')
  assert.match(result.stdout, /Create the first account \(the server administrator\) with this one-time setup link\./)
  assert.match(result.stdout, /It works once and expires in 24 hours; nobody can sign up before it is used:/)
  assert.match(result.stdout, /Lost it\? slatebox setup-link prints a new one and ends this one\./)
  assert.doesNotMatch(result.stdout, /Open http\S+ and create the first account/)
})

test('with --json no link is made and nothing carries one; the person is told to run slatebox setup-link at a terminal', async () => {
  const { docker, run } = box()
  const result = await run(['install', ...LOCAL, '--yes', '--json'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(tokens(docker), [])
  assert.doesNotMatch(everything(result), /\/setup\//)
  assert.match(result.stderr, /Nobody can sign up until the first admin exists\. Get the one-time setup link at a terminal:\n {2}slatebox setup-link\n/)
  const done = result.events.at(-1)
  assert.equal(done.event, 'done')
  assert.ok(!JSON.stringify(result.events).includes('setup'), 'no setup link or state in the JSON events')
})

test('a pipe without --json gets no link either, only how to get one', async () => {
  const { docker, run } = box()
  const result = await run(['install', ...LOCAL, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(tokens(docker), [])
  assert.doesNotMatch(everything(result), /\/setup\//)
  assert.match(result.stdout, /Get the one-time setup link at a terminal:\n {2}slatebox setup-link\n/)
})

test('a server already set up gets no link and no first-admin text', async () => {
  const docker = new FakeDocker({ settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'], setUp: true })
  docker.addImage(IMAGE)
  const result = await cli(['install', ...LOCAL, '--yes'], { run: docker.run, home: sandbox(), tty: true, input: '\n\n\n' })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(tokens(docker), [])
  assert.doesNotMatch(everything(result), /setup link|first admin|create the first account/i)
})

test('slatebox setup-link: a terminal only, a new link each time (ending the last), and a plain answer once set up', async () => {
  const { docker, run } = box()
  assert.equal((await run(['install', ...LOCAL, '--yes'])).code, 0)

  const piped = await run(['setup-link'])
  assert.equal(piped.code, 2)
  assert.match(piped.stderr, /printed only to a terminal/)
  assert.deepEqual(tokens(docker), [], 'nothing made for a pipe')
  const json = await run(['setup-link', '--json', '--force-stdout'])
  assert.equal(json.code, 2)

  const first = await run(['setup-link'], { tty: true })
  assert.equal(first.code, 0, first.stderr)
  assert.equal(first.stdout, `https://box.example/setup/${tokens(docker)[0]}\n`)
  assert.match(first.stderr, /It works once, expires in 24 hours, and the link before it no longer works\./)
  const second = await run(['setup-link', '--force-stdout'])
  assert.equal(second.code, 0, second.stderr)
  assert.equal(tokens(docker).length, 2)
  assert.notEqual(tokens(docker)[0], tokens(docker)[1])
  assert.equal(second.stdout, `https://box.example/setup/${tokens(docker)[1]}\n`)

  docker.setUp()
  const done = await run(['setup-link'], { tty: true })
  assert.equal(done.code, 4)
  assert.match(done.stderr, /already set up: its administrator invites people from the Team page/)
})

test('status says the server waits for its first admin, and stops saying it once set up', async () => {
  const { docker, run } = box()
  assert.equal((await run(['install', ...LOCAL, '--yes'])).code, 0)
  const waiting = await run(['status', '--agent', 'no'])
  assert.match(waiting.stdout, /Setup {8}waiting for the first admin: slatebox setup-link prints a one-time link/)
  assert.equal((await run(['status', '--json'])).events.at(-1).setup, 'waiting for the first admin')
  assert.deepEqual(tokens(docker), [], 'status never makes a link (that would end the one the person holds)')
  docker.setUp()
  const set = await run(['status', '--agent', 'no'])
  assert.doesNotMatch(set.stdout, /Setup/)
  assert.equal((await run(['status', '--json'])).events.at(-1).setup, 'done')
})

test('an image without setup links (before 0.2.0) keeps the old first-account advice', async () => {
  const { docker, run } = box({ commands: [] })
  const result = await run(['install', ...LOCAL, '--yes'])
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(tokens(docker), [])
  assert.match(result.stdout, /Open http:\/\/localhost:17481 and create the first account with ops@example\.com\./)
  assert.doesNotMatch(result.stdout, /setup link/)
})

test('the team-address install at a terminal prints https://<name>.slatebox.team/setup/<token>', async () => {
  const docker = new FakeDocker({ settings: [...LEGACY_SETTINGS, 'SLATEBOX_TUNNEL_TOKEN'], commands: ['tunnel', 'setup-link'] })
  docker.addImage(IMAGE)
  // The image builds the link from its own address (SLATEBOX_URL): the team address.
  const original = docker.run
  const run = async (cmd, args, options) => {
    const result = await original(cmd, args, options)
    return args.includes('setup-link') && args.includes('--json') ? { ...result, stdout: result.stdout.replace('https://box.example', 'https://acme.slatebox.team') } : result
  }
  const cloud = new FakeCloud()
  const home = sandbox()
  const result = await cli(['install', '--team-address', 'acme', ...LOCAL, '--yes'], {
    run, home, fetch: cloud.fetch, tty: true, input: '\nn\n\n\n', env: { SLATEBOX_CLOUD_URL: cloud.base },
    io: { sleep: async () => {}, deviceLabel: 'test-box', openBrowser: () => {}, teamHealthDelay: 1, teamHealthAttempts: 3 },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stderr, new RegExp(`https://acme\\.slatebox\\.team/setup/${docker.setupLinks[0]} {3}\\(printed to this terminal only\\)`))
  assert.match(result.stdout, /Slatebox is running at {2}https:\/\/acme\.slatebox\.team/)
})

test('the redactor hides a setup link\'s token wherever it appears', () => {
  const token = 'Zk3aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789-_qr'
  assert.equal(token.length, 43)
  const redactor = new Redactor()
  assert.equal(redactor.redact(`open https://acme.slatebox.team/setup/${token} now`), 'open https://acme.slatebox.team/setup/*** now')
  assert.equal(redactor.redact(`"url":"http://localhost:7070/setup/${token}"`), '"url":"http://localhost:7070/setup/***"')
  assert.equal(redactor.redact('/setup/short'), '/setup/short', 'only a whole token')
})
