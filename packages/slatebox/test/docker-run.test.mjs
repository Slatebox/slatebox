// 0.2.3: Slatebox is one container, so the installer runs it with plain `docker run`
// (Compose is only an export format), and it checks what the chosen target needs
// right after the target is chosen, before the rest of the questions.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { QUESTIONS } from '../src/answers.mjs'
import { EXIT } from '../src/errors.mjs'
import { parseEnvFile } from '../src/secrets.mjs'
import { dockerProvider } from '../src/targets/docker.mjs'
import { parse } from '../src/yaml.mjs'
import { cli, FakeDocker, ID, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:run'
const BASE = ['--image', IMAGE, '--ai', 'none', '--backups', 'off', '--port', '17491']

function setup(options) {
  const docker = new FakeDocker(options)
  docker.addImage(IMAGE)
  return { docker, home: sandbox() }
}

const composeCalls = calls => calls.filter(call => call.cmd === 'docker' && call.args[0] === 'compose' && call.args[1] !== 'version')
const lots = { bavail: 1e9, bsize: 4096 }

// ------------------------------------------------------------------ preflight first

// The owner's run on roscoe, answered in full: target, team address, email, AI, SSO (yes, no, no), backups, size, mail.
const ROSCOE = ['', '1', 'roscoe', 'o@example.com', '4', 'y', 'n', 'n', '', '', ''].join('\n') + '\n'

test('preflight first: Docker not running stops right after the target question, before any other question', async () => {
  const home = sandbox()
  const run = async cmd => (cmd === 'docker' ? { code: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon at unix:///Users/me/.colima/default/docker.sock.' } : { code: 1, stdout: '', stderr: '' })
  const result = await cli(['install'], { run, home, tty: true, input: ROSCOE })
  assert.equal(result.code, 4, result.stderr)
  assert.ok(result.stderr.includes(QUESTIONS.target.question), 'the target was asked')
  assert.match(result.stderr, /Docker is not running on this computer.*Colima \(colima start\)/s)
  for (const later of ['Where should your team open Slatebox?', 'Team address', 'Single sign-on', 'Backups', 'Size', 'Mail:']) {
    assert.ok(!result.stderr.includes(later), `"${later}" was not asked`)
  }
  assert.ok(!existsSync(join(home, 'installs', 'slatebox', 'slatebox.env')), 'nothing written')
})

test('preflight first: with the target on the command line, Docker missing is said before the first question', async () => {
  const home = sandbox()
  const run = async cmd => ({ code: 127, stdout: '', stderr: `${cmd}: not found` })
  const result = await cli(['install', 'local'], { run, home, tty: true, input: ROSCOE, platform: 'darwin', env: { PATH: '/nonexistent' } })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /Docker is not installed on this computer/)
  assert.match(result.stderr, /Colima \(brew install colima docker && colima start\)/)
  assert.ok(!result.stderr.includes('? '), 'no question was asked')
})

test('preflight first: too little disk space stops before the questions', async () => {
  const { docker, home } = setup()
  const result = await cli(['install'], { run: docker.run, home, tty: true, input: ROSCOE, io: { statfs: () => ({ bavail: 1000, bsize: 4096 }) } })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /GB free where Slatebox keeps its files .*needs at least 5 GB/)
  assert.ok(!result.stderr.includes('Where should your team open Slatebox?'))
  assert.equal(docker.starts().length, 0)
})

test('preflight first: a processor Slatebox has no image for stops before the questions', async () => {
  const { docker, home } = setup({ serverArch: 's390x' })
  const result = await cli(['install'], { run: docker.run, home, tty: true, input: ROSCOE, io: { statfs: () => lots } })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /runs s390x containers; Slatebox runs on 64-bit Intel\/AMD \(amd64\) or ARM \(arm64\)/)
  assert.ok(!result.stderr.includes('Where should your team open Slatebox?'))
})

test('preflight first: a server that cannot be reached over SSH stops after the host question', async () => {
  const home = sandbox()
  const calls = []
  const run = async (cmd, args) => {
    calls.push(cmd)
    if (cmd === 'ssh' && args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    return cmd === 'ssh' ? { code: 255, stdout: '', stderr: 'ssh: connect to host box port 22: Connection refused\n' } : { code: 1, stdout: '', stderr: '' }
  }
  const result = await cli(['install'], { run, home, tty: true, input: ['2', 'root@box', 'o@example.com', '', '', '', '', '', ''].join('\n') + '\n' })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /Cannot reach root@box over SSH: ssh: connect to host box port 22: Connection refused/)
  assert.ok(!result.stderr.includes('Where should your team open Slatebox?'))
  assert.ok(!result.stderr.includes('Admin email'), 'the email was not asked')
})

test('preflight first: a server without Docker (and no --install-docker) stops after the host question', async () => {
  const home = sandbox()
  const run = async (cmd, args, options = {}) => {
    if (cmd === 'ssh' && args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    if (cmd === 'ssh' && String(options.input).includes('uid=$(id -u)')) return { code: 0, stdout: 'uid=0\narch=x86_64\ndocker_path=\nsystemd=yes\ndisk_kb=99999999\n', stderr: '' }
    return { code: 1, stdout: '', stderr: '' }
  }
  const result = await cli(['install', 'ssh', 'root@box'], { run, home, tty: true, input: '\n\n\n\n' })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /Docker is not installed on root@box.*--install-docker/s)
  assert.ok(!result.stderr.includes('Where should your team open Slatebox?'))
})

test('preflight first: Kubernetes without kubectl stops after the target question', async () => {
  const home = sandbox()
  const run = async cmd => ({ code: 127, stdout: '', stderr: `${cmd}: not found` })
  const result = await cli(['install'], { run, home, tty: true, input: '3\nops@example.com\n\n\n\n' })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.stderr, /kubectl is not installed/)
  assert.ok(!result.stderr.includes('How does traffic reach it?'))
  assert.ok(!result.stderr.includes('Admin email'))
})

test('preflight first: Colima without the Compose plugin is fine; the check names Colima and the questions go on', async () => {
  const { docker, home } = setup({ provider: 'colima', serverArch: 'arm64' })
  // Target, then (the port is given): no email, no AI, no SSO, backups off, small, no mail; then no to the plan.
  const input = ['1', '', '1', 'n', '4', '', '', 'n'].join('\n') + '\n'
  const result = await cli(['install', '--image', IMAGE, '--port', '17492'], { run: docker.run, home, tty: true, input, io: { statfs: () => lots } })
  assert.equal(result.code, EXIT.CANCELLED, result.stderr) // no to the plan
  const check = result.stdout.indexOf('This computer: Docker 29.4.0 (Colima), arm64')
  assert.ok(check >= 0, result.stdout)
  assert.ok(result.stderr.includes('Single sign-on'), 'the questions went on after the check')
  assert.equal(composeCalls(docker.calls).length, 0, 'Compose is never asked for')
  assert.ok(!/docker compose|compose (v2|plugin)/i.test(result.stdout + result.stderr), 'Compose is never asked for or required (only offered as an export format)')
})

test('which Docker: Colima, OrbStack, Docker Desktop, Rancher Desktop, Podman, or nothing claimed', () => {
  assert.equal(dockerProvider({ os: 'Ubuntu 24.04.1 LTS', name: 'colima' }), 'Colima')
  assert.equal(dockerProvider({ name: 'colima-work' }), 'Colima')
  assert.equal(dockerProvider({ endpoint: 'unix:///Users/me/.colima/default/docker.sock' }), 'Colima')
  assert.equal(dockerProvider({ os: 'OrbStack', name: 'orbstack' }), 'OrbStack')
  assert.equal(dockerProvider({ os: 'Docker Desktop', name: 'docker-desktop' }), 'Docker Desktop')
  assert.equal(dockerProvider({ endpoint: 'unix:///Users/me/.rd/docker.sock' }), 'Rancher Desktop')
  assert.equal(dockerProvider({ endpoint: 'unix:///run/user/1000/podman/podman.sock' }), 'Podman')
  assert.equal(dockerProvider({ os: 'Ubuntu 24.04', name: 'buildbox', endpoint: 'unix:///var/run/docker.sock' }), null)
})

// ------------------------------------------------------------------ docker run

test('install runs one container with plain docker run: name, restart, loopback port, volume, env files, labels; no Compose', async () => {
  const { docker, home } = setup({ provider: 'colima' })
  const result = await cli(['install', ...BASE, '--yes', '--json'], { run: docker.run, home, io: { statfs: () => lots } })
  assert.equal(result.code, 0, result.stderr)
  const dir = join(home, 'installs', 'slatebox')
  const [start] = docker.starts()
  assert.ok(start, 'docker run --detach')
  const args = start.args
  const flag = name => args.flatMap((arg, i) => (arg === name ? [args[i + 1]] : []))
  assert.deepEqual(flag('--name'), ['slatebox'])
  assert.deepEqual(flag('--restart'), ['unless-stopped'])
  assert.deepEqual(flag('--pull'), ['never'])
  assert.deepEqual(flag('--publish'), ['127.0.0.1:17491:7070'])
  assert.deepEqual(flag('--volume'), ['slatebox-data:/data'])
  assert.deepEqual(flag('--env-file'), [join(dir, 'slatebox.env'), join(dir, 'secrets.env')])
  assert.ok(flag('--label').includes('com.slatebox.install=slatebox'))
  assert.ok(flag('--label').some(label => /^com\.slatebox\.spec=[a-f0-9]{32}$/.test(label)))
  assert.equal(args.at(-1), ID(IMAGE), 'the pinned image')
  const key = parseEnvFile(readFileSync(join(dir, 'secrets.env'), 'utf8')).SLATEBOX_KEY_ENCRYPTION_KEY
  assert.ok(!JSON.stringify(docker.calls.map(call => call.args)).includes(key), 'secrets only in the env file, never in arguments')
  assert.match(readFileSync(join(dir, 'secrets.env'), 'utf8'), new RegExp(`^SLATEBOX_KEY_ENCRYPTION_KEY=${key.replace(/[+/]/g, '\\$&')}$`, 'm'), 'docker --env-file format: no quotes')
  assert.equal(composeCalls(docker.calls).length, 0)
  assert.ok(!existsSync(join(dir, 'compose.yaml')))
  const plan = result.events.find(event => event.event === 'plan')
  assert.ok(plan.commands.some(command => command.startsWith('docker run --detach --name slatebox')), plan.commands.join('\n'))
  assert.ok(!plan.commands.some(command => /compose/.test(command)))
})

test('the install record says how it runs: docker run, the Docker version and Colima; status shows it', async () => {
  const { docker, home } = setup({ provider: 'colima' })
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home, io: { statfs: () => lots } })).code, 0)
  const record = parse(readFileSync(join(home, 'installs', 'slatebox', 'install.yaml'), 'utf8'))
  assert.deepEqual(record.dockerRuntime, { runs: 'docker run', docker: '29.4.0', provider: 'Colima' })
  const status = await cli(['status', '--json'], { run: docker.run, home })
  assert.equal(status.code, 0, status.stderr)
  assert.equal(status.events.at(-1).docker, '29.4.0 (Colima)')
  const table = await cli(['status', '--agent', 'no'], { run: docker.run, home })
  assert.match(table.stdout, /^Docker\s+29\.4\.0 \(Colima\)$/m)
  // An install again with the same answers is still "nothing to change": the record field is not an answer.
  const again = await cli(['install', '--image', IMAGE, '--json'], { run: docker.run, home, io: { statfs: () => lots } })
  assert.equal(again.events.at(-1).nothingToChange, true, again.stderr)
})

test('a change makes the container again: the old one waits as slatebox-previous and is removed once the new one is healthy', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  const result = await cli(['install', '--image', IMAGE, '--port', '17493', '--url', 'http://localhost:17493', '--yes', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  const verbs = docker.calls.slice(docker.calls.findIndex(call => call.args[0] === 'stop')).map(call => call.args.slice(0, 2).join(' '))
  assert.deepEqual(verbs.filter(verb => /^(stop|rename|run --detach|rm --force)/.test(verb)), ['stop --time', 'rename slatebox', 'rm --force', 'run --detach', 'rm --force'])
  assert.deepEqual(docker.runFlag('--publish'), ['127.0.0.1:17493:7070'])
  assert.ok(!docker.containers.has('slatebox-previous'))
  assert.equal(docker.starts().length, 2)
  assert.ok(docker.volumes.has('slatebox-data'), 'the same data volume')
})

test('a change that only the container sees (host-gateway) is still a change, and the same answers are not', async () => {
  const { docker, home } = setup({ settings: ['SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_KEY_ENCRYPTION_KEY', 'MONGO_URL', 'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT'] })
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  // The container is changed behind the installer's back (made without its spec label).
  docker.containers.get('slatebox').labels = {}
  const result = await cli(['install', '--image', IMAGE, '--json'], { run: docker.run, home })
  const plan = result.events.find(event => event.event === 'plan')
  assert.equal(plan.action, 'change', result.stderr)
  assert.ok(plan.changes.some(change => /made again/.test(change)), plan.changes.join('\n'))
})

test('a change cut off while its container was set aside: the next run puts that container back first', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  docker.containers.set('slatebox-previous', docker.containers.get('slatebox'))
  docker.containers.delete('slatebox')
  const result = await cli(['install', '--image', IMAGE, '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.ok(docker.containers.has('slatebox') && !docker.containers.has('slatebox-previous'))
})

test('a new container that keeps restarting fails at once and the previous one comes back', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  const run = async (cmd, args, options) => {
    const result = await docker.run(cmd, args, options)
    // The new container crash-loops (only the one made by this second run).
    if (cmd === 'docker' && args[0] === 'inspect' && args.includes('{{json .State}}') && docker.starts().length === 2 && !docker.calls.some(call => call.args[0] === 'start')) {
      return { code: 0, stdout: JSON.stringify({ Running: false, Restarting: true, Status: 'restarting', ExitCode: 3 }), stderr: '' }
    }
    return result
  }
  const result = await cli(['install', '--image', IMAGE, '--port', '17494', '--url', 'http://localhost:17494', '--yes', '--json'], { run, home })
  assert.equal(result.code, 5, result.stderr)
  assert.match(result.events.at(-1).message, /keeps restarting \(exit code 3\).*previous version was put back/s)
  assert.deepEqual(docker.runFlag('--publish'), ['127.0.0.1:17491:7070'], 'the previous container, on its old port')
  assert.equal(docker.containers.get('slatebox').running, true)
})

test('day two with docker run: status, logs, backup, restore, setup-link, ai change, upgrade, uninstall; never Compose', async () => {
  const { docker, home } = setup({ commands: ['setup-link'] })
  docker.addImage('slatebox-test:run2')
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)

  assert.equal((await cli(['status', '--json'], { run: docker.run, home })).code, 0)
  const logs = await cli(['logs'], { run: async (cmd, args, options) => (args[0] === 'logs' ? { code: 0, stdout: '[app] up\n', stderr: '' } : docker.run(cmd, args, options)), home })
  assert.equal(logs.code, 0, logs.stderr)
  assert.match(logs.stdout, /\[app\] up/)

  const to = sandbox()
  const backup = await cli(['backup', '--to', to, '--json'], { run: docker.run, home })
  assert.equal(backup.code, 0, backup.stderr)
  const file = backup.events.at(-1).file
  assert.equal(readFileSync(file, 'utf8'), 'BACKUP')
  const restore = await cli(['restore', file, '--yes', '--json'], { run: docker.run, home })
  assert.equal(restore.code, 0, restore.stderr)
  assert.ok(docker.calls.some(call => call.args[0] === 'exec' && call.args.includes('restore')))

  const link = await cli(['setup-link'], { run: docker.run, home, tty: true })
  assert.equal(link.code, 0, link.stderr)
  assert.match(link.stdout, /\/setup\//)

  const ai = await cli(['ai', 'add', 'kind=deepinfra,key=env:DI', '--yes', '--json'], { run: docker.run, home, env: { DI: 'di-key-0123456789' } })
  assert.equal(ai.code, 0, ai.stderr)
  assert.equal(docker.starts().length, 2, 'the container was made again with the new secrets file')

  const upgrade = await cli(['upgrade', '--to', 'slatebox-test:run2', '--yes', '--json'], { run: docker.run, home })
  assert.equal(upgrade.code, 0, upgrade.stderr)
  assert.equal(docker.containers.get('slatebox').image, ID('slatebox-test:run2'))
  assert.equal(docker.starts().length, 3)

  const kept = await cli(['uninstall', '--yes', '--json'], { run: docker.run, home })
  assert.equal(kept.code, 0, kept.stderr)
  assert.ok(!docker.containers.has('slatebox'))
  assert.ok(docker.volumes.has('slatebox-data'), 'the data is kept')
  assert.ok(docker.calls.some(call => call.args.join(' ') === 'rm --force slatebox'))
  assert.equal(composeCalls(docker.calls).length, 0, 'no day-two command runs Compose')
})

test('the SSH target runs the same docker run on the server (under sudo when needed) and never asks for Compose', async () => {
  const home = sandbox()
  const commands = []
  const containers = new Map()
  const run = async (cmd, args, options = {}) => {
    if (cmd !== 'ssh') return { code: 127, stdout: '', stderr: `${cmd} missing` }
    if (args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    const command = args.at(-1)
    commands.push(command)
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    if (command === 'sh -s' && String(options.input).includes('uid=$(id -u)')) return ok('uid=1000\nsudo=yes\narch=x86_64\nos=ubuntu 24.04\ndocker_path=/usr/bin/docker\ndocker_server=29.0.0\nsystemd=yes\ncron=yes\ndisk_kb=99999999\nlistening=22\n')
    if (command.includes('id -u')) return ok('sudo\n')
    if (/\[ -e /.test(command)) return { code: 3, stdout: '', stderr: '' }
    const image = /docker image inspect --format '\{\{json \.\}\}' (\S+)$/.exec(command)
    if (image) return ok(JSON.stringify({ Id: ID(image[1]), RepoDigests: [], Architecture: 'amd64' }))
    if (/docker run .*--detach/.test(command)) { containers.set('slatebox', true); return ok('c\n') }
    if (/docker inspect --format '\{\{json \.State\}\}'/.test(command)) return containers.has('slatebox') ? ok('{"Running":true,"Status":"running","Health":{"Status":"healthy"}}') : { code: 1, stdout: '', stderr: 'No such object' }
    if (/docker (inspect|volume inspect)/.test(command)) return { code: 1, stdout: '', stderr: 'No such object' }
    if (/docker run .*settings/.test(command)) return { code: 2, stdout: '', stderr: 'Usage, from the Docker host:\n  docker exec slatebox slatebox backup > x\n' }
    if (/docker run .*configure\.mjs/.test(command)) return { code: 1, stdout: '', stderr: 'Unknown setting SLATEBOX_INSTALLER_PROBE. The settings are: SLATEBOX_URL, SLATEBOX_KEY_ENCRYPTION_KEY (in capitals).' }
    if (/docker run .*mongod/.test(command)) return ok('db version v8.0.17')
    return ok()
  }
  const result = await cli(['install', 'ssh', 'ops@203.0.113.5', '--admin-email', 'ops@example.com', '--ai', 'none', '--image', 'registry.example.com/sb/slatebox:1', '--backups', 'off', '--yes', '--json'], { run, home })
  assert.equal(result.code, 0, result.stderr)
  const start = commands.find(command => /docker run .*--detach/.test(command))
  assert.ok(start.startsWith('sudo -n docker run '), start)
  assert.match(start, /--env-file \/opt\/slatebox\/slatebox\.env --env-file \/opt\/slatebox\/secrets\.env/)
  assert.match(start, /--publish 7070:7070/)
  assert.ok(!commands.some(command => /docker compose/.test(command)), 'Compose is never run or asked about on the server')
  const record = parse(readFileSync(join(home, 'installs', 'slatebox', 'install.yaml'), 'utf8'))
  assert.equal(record.dockerRuntime.runs, 'docker run')
})

test('the files-only target still writes a Compose file (export only), in Compose env-file format', async () => {
  const home = sandbox()
  const out = join(sandbox(), 'deploy')
  const result = await cli(['install', 'export', '--format', 'compose', '--out', out, '--ai', 'none', '--domain', 'boards.example.com', '--yes', '--json'], { run: async () => ({ code: 127, stdout: '', stderr: '' }), home })
  assert.equal(result.code, 0, result.stderr)
  const compose = parse(readFileSync(join(out, 'compose.yaml'), 'utf8'))
  assert.equal(compose.services.slatebox.pull_policy, undefined)
  assert.match(readFileSync(join(out, 'slatebox.env'), 'utf8'), /^SLATEBOX_URL='https:\/\/boards\.example\.com'$/m)
})

test('env files: the docker format is literal NAME=value and reads back the same; quotes, line breaks and edge spaces are refused', async () => {
  const { envFileText } = await import('../src/secrets.mjs')
  const values = { A: 'dollar$sign', B: 'has "inner" quotes', C: 'x=y#z', D: 'smtp://u:p%27@h:587' }
  const text = envFileText(values, 'header', { format: 'docker' })
  assert.match(text, /^A=dollar\$sign$/m)
  assert.deepEqual(parseEnvFile(text), values)
  for (const bad of ["it's", 'two\nlines', ' lead', 'trail ', '"wrapped"']) {
    assert.throws(() => envFileText({ X: bad }, '', { format: 'docker' }), /cannot hold/)
  }
})
