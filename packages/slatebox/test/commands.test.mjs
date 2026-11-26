// One `slatebox` command: the table of words it takes, plain `slatebox` (a list, and at a
// terminal an offer to install that never installs unasked), unknown words, the remove alias,
// and exec, describe and mcp from slatebox-mcp run in this process (no npx, no second fetch).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { COMMANDS, HELP, suggest } from '../src/cli.mjs'
import { cli, FakeDocker, sandbox } from './fakes.mjs'

const words = COMMANDS.map(command => command.name)

test('the command table names every command the spec lists, once', () => {
  for (const word of ['install', 'status', 'setup-link', 'logs', 'upgrade', 'rename', 'address', 'uninstall', 'backup', 'restore', 'ai', 'secrets', 'installs', 'plan', 'agent-prompt', 'exec', 'describe', 'mcp', 'help']) {
    assert.ok(words.includes(word), word)
  }
  assert.equal(new Set(words).size, words.length)
  for (const word of words) assert.match(HELP, new RegExp(`slatebox ${word}\\b`), word)
})

test('plain `slatebox` without a terminal lists the commands, exit 0, and runs nothing', async () => {
  const docker = new FakeDocker()
  const result = await cli([], { run: docker.run, home: sandbox() })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /Commands:\n {2}slatebox install/)
  assert.match(result.stdout, /slatebox exec/)
  assert.equal(docker.calls.length, 0)
})

test('plain `slatebox` at a terminal offers to install; no is no, and nothing runs', async () => {
  const docker = new FakeDocker()
  const result = await cli([], { run: docker.run, home: sandbox(), tty: true, input: 'n\n' })
  assert.equal(result.code, 0)
  assert.match(result.stderr, /Install Slatebox on this computer\? \[Y\/n\]/)
  assert.match(result.stderr, /Nothing was changed/)
  assert.equal(docker.calls.length, 0)
})

test('an agent at a terminal gets the list, never the offer', async () => {
  const docker = new FakeDocker()
  const result = await cli([], { run: docker.run, home: sandbox(), tty: true, env: { CLAUDECODE: '1' } })
  assert.equal(result.code, 0)
  assert.doesNotMatch(result.stderr + result.stdout, /Install Slatebox on this computer\?/)
  assert.equal(docker.calls.length, 0)
})

test('an unknown word is exit 2 with a suggestion, and nothing is fetched or run', async () => {
  const docker = new FakeDocker()
  let fetched = 0
  const result = await cli(['instal', '--json'], { run: docker.run, home: sandbox(), fetch: async () => { fetched++; return { ok: true, json: async () => ({}) } } })
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Unknown command instal\. Did you mean slatebox install\?/)
  assert.equal(result.events.at(-1).suggestion, 'install')
  assert.equal(docker.calls.length, 0)
  assert.equal(fetched, 0)
  assert.equal(suggest('stauts'), 'status')
  assert.equal(suggest('zzzzzz'), null)
})

test('remove is uninstall', async () => {
  const result = await cli(['remove', '--json'], { run: new FakeDocker().run, home: sandbox() })
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /There is no install named "slatebox"/)
})

test('exec and describe run slatebox-mcp in this process: help, a listing, and its own exit codes', async () => {
  const help = await cli(['exec', '--help'], { home: sandbox() })
  assert.equal(help.code, 0)
  assert.match(help.stdout, /slatebox exec FILE \| - \| -e CODE/)
  const listing = await cli(['describe'], { home: sandbox() })
  assert.equal(listing.code, 0, listing.stderr)
  assert.match(listing.stdout, /^slates\.get\s+Read a slate$/m)
  const unsigned = await cli(['exec', '-e', 'return 1'], { home: sandbox(), env: { SLATEBOX_BASE_URL: 'http://127.0.0.1:1' } })
  assert.equal(unsigned.code, 2)
  assert.match(unsigned.stderr, /^slatebox: Set SLATEBOX_API_TOKEN/m)
  const mcp = await cli(['mcp', '--help'], { home: sandbox() })
  assert.equal(mcp.code, 0)
  assert.match(mcp.stdout, /slatebox mcp/)
})

test('the package names one command, slatebox, and depends on exactly one slatebox-mcp', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.bin, { slatebox: 'bin/slatebox.mjs' })
  // Restated (0.3.0, the wizard in the terminal): the 0.3 line.
  assert.match(manifest.version, /^0\.3\.\d+$/)
  const source = readFileSync(new URL('../src/cli.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /npx(\.cmd)?['"`, ]+\[?['"]--yes['"], ['"]--package/, 'slate commands are never fetched with npx')
})

test('logs: only the named service, every line through the redactor; an unknown service is exit 2', async () => {
  const docker = new FakeDocker({ commands: [] })
  docker.addImage('img:1')
  const home = sandbox()
  assert.equal((await cli(['install', '--image', 'img:1', '--ai', 'none', '--backups', 'off', '--port', '17490', '--yes'], { run: docker.run, home })).code, 0)
  const original = docker.run
  // A made-up tunnel token, built here so that no token-shaped literal sits in the repository.
  const token = Buffer.from(JSON.stringify({ a: 'account', t: 'tunnel', s: 'made-up-secret-value' })).toString('base64')
  const run = async (cmd, args, options) => args[0] === 'logs'
    ? { code: 0, stdout: `[app] started\n[tunnel] connected ${token}\n[relay] ready\n`, stderr: '[tunnel] Registered tunnel connection\n' }
    : original(cmd, args, options)
  const all = await cli(['logs'], { run, home })
  assert.equal(all.code, 0)
  assert.match(all.stdout, /\[app\] started/)
  assert.ok(!all.stdout.includes(token))
  const tunnel = await cli(['logs', '--service', 'tunnel'], { run, home })
  assert.equal(tunnel.stdout, '[tunnel] connected ***\n[tunnel] Registered tunnel connection\n')
  const bad = await cli(['logs', '--service', 'nope'], { run, home })
  assert.equal(bad.code, 2)
})
