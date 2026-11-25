// `npx slatebox` with no command: the guided install, and its failure paths
// with stand-ins for Docker (missing, port taken, never healthy) and --dry-run.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { HELP } from '../src/cli.mjs'
import { cli, FakeDocker, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:guided'
const BASE = ['--image', IMAGE, '--ai', 'none', '--backups', 'off']
const ups = docker => docker.count(call => call.cmd === 'docker' && call.args[0] === 'compose' && call.args.includes('up'))

function setup(options) {
  const docker = new FakeDocker(options)
  docker.addImage(IMAGE)
  return { docker, home: sandbox() }
}

async function heldPort() {
  const server = createServer()
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { server, port: server.address().port }
}

const noDocker = (cmd) => (cmd === 'docker' ? { code: 127, stdout: '', stderr: 'docker is not installed' } : { code: 1, stdout: '', stderr: `${cmd} is not installed` })

function pathWith(...programs) {
  const dir = mkdtempSync(join(tmpdir(), 'sbx-path-'))
  for (const name of programs) {
    writeFileSync(join(dir, name), '#!/bin/sh\nexit 0\n')
    chmodSync(join(dir, name), 0o755)
  }
  return dir
}

test('flags with no command are the install: an agent gets the same questions as `slatebox install`', async () => {
  const { docker, home } = setup()
  const bare = await cli(['--image', IMAGE], { run: docker.run, home, env: { AI_AGENT: '1' } })
  const install = await cli(['install', '--image', IMAGE], { run: docker.run, home, env: { AI_AGENT: '1' } })
  assert.equal(bare.code, 3)
  assert.deepEqual(bare.events.at(-1).missing, install.events.at(-1).missing)
  assert.equal(docker.calls.length, 0, 'nothing was run')
})

// Restated (one command, 0.2.0): help leads with `npx slatebox install`; plain `npx slatebox`
// lists the commands instead of installing (see cli.test.mjs).
test('help leads with npx slatebox install and --dry-run', async () => {
  assert.match(HELP, /^ {2}npx slatebox install {2,}/m)
  assert.doesNotMatch(HELP, /^ {2}npx slatebox {2,}/m, 'bare npx slatebox is not described as the install')
  assert.match(HELP, /--team-address <name>/)
  assert.match(HELP, /--dry-run/)
  const { docker, home } = setup()
  const result = await cli(['--help'], { run: docker.run, home })
  assert.equal(result.code, 0)
  assert.equal(result.stdout, HELP)
})

test('--dry-run with no command prints the plan and changes nothing, even with --yes', async () => {
  const { docker, home } = setup()
  const result = await cli([...BASE, '--port', '17451', '--dry-run', '--yes', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  const plan = result.events.find(event => event.event === 'plan')
  assert.equal(plan.action, 'install')
  assert.equal(plan.address, 'http://localhost:17451')
  assert.equal(ups(docker), 0)
  assert.equal(docker.count(call => call.args[0] === 'pull'), 0, 'nothing pulled')
  assert.ok(!existsSync(join(home, 'installs', 'slatebox')), 'no files written')
})

test('Docker missing on a Mac: exit 4, Docker Desktop or OrbStack named, nothing written', async () => {
  const home = sandbox()
  const result = await cli([...BASE, '--port', '17452', '--yes', '--json'], { run: noDocker, home, platform: 'darwin', env: { PATH: pathWith() } })
  assert.equal(result.code, 4)
  const error = result.events.at(-1)
  assert.equal(error.docker, 'missing')
  assert.match(error.message, /Docker is not installed on this computer/)
  assert.match(error.message, /Docker Desktop .*OrbStack/)
  assert.match(error.message, /Nothing was changed/)
  assert.ok(!existsSync(join(home, 'installs', 'slatebox')))
})

test('Docker missing on Linux: exit 4 with the Docker Engine install command; the installer never installs it here', async () => {
  const home = sandbox()
  const calls = []
  const run = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return noDocker(cmd) }
  const result = await cli([...BASE, '--port', '17453', '--yes', '--json'], { run, home, platform: 'linux', env: { PATH: pathWith() } })
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /get\.docker\.com/)
  assert.ok(!calls.some(call => /get\.docker\.com|sh -c/.test(call)), 'nothing was installed')
})

test('Podman without Docker compatibility: exit 4 says how to turn it on', async () => {
  const home = sandbox()
  const result = await cli([...BASE, '--port', '17454', '--yes', '--json'], { run: noDocker, home, platform: 'linux', env: { PATH: pathWith('podman') } })
  assert.equal(result.code, 4)
  const error = result.events.at(-1)
  assert.equal(error.podman, true)
  assert.match(error.message, /Podman is installed: turn on its Docker compatibility/)
})

test('Docker installed but stopped: exit 4 asks to start it', async () => {
  const home = sandbox()
  const run = async cmd => (cmd === 'docker' ? { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.' } : { code: 1, stdout: '', stderr: '' })
  const result = await cli([...BASE, '--port', '17455', '--yes', '--json'], { run, home })
  assert.equal(result.code, 4)
  assert.equal(result.events.at(-1).docker, 'stopped')
  assert.match(result.events.at(-1).message, /Cannot connect to the Docker daemon/)
})

test('the chosen port is taken: exit 4 names the port and --port, nothing started', async () => {
  const { docker, home } = setup()
  const { server, port } = await heldPort()
  try {
    const result = await cli([...BASE, '--port', String(port), '--yes', '--json'], { run: docker.run, home })
    assert.equal(result.code, 4)
    assert.match(result.events.at(-1).message, new RegExp(`Port ${port} on this computer is taken.*--port`))
    assert.equal(ups(docker), 0)
  } finally {
    await new Promise(done => server.close(done))
  }
})

test('a first install that never gets healthy: exit 5, the container stopped with its logs kept, the next commands given, no secret printed', async () => {
  const docker = new FakeDocker({ broken: [IMAGE] })
  docker.addImage(IMAGE)
  const home = sandbox()
  const result = await cli([...BASE, '--port', '17456', '--yes', '--json', '--health-timeout', '5'], { run: docker.run, home })
  assert.equal(result.code, 5, result.stderr)
  const error = result.events.at(-1)
  assert.equal(error.event, 'error')
  assert.match(error.message, /did not become healthy/)
  assert.deepEqual(error.commands, ['docker logs slatebox', 'npx slatebox uninstall --name slatebox'])
  assert.equal(docker.containers.get('slatebox').running, false, 'stopped, not left running')
  assert.ok(docker.volumes.has('slatebox-data'), 'the data volume is kept')
  assert.ok(!/SLATEBOX_KEY_ENCRYPTION_KEY=/.test(result.stdout + result.stderr))
})
