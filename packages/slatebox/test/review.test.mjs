// Findings from the hostile review of the installer (2026-11-21), one test (or
// more) per finding, numbered as in the review. Kubernetes findings are in
// targets.test.mjs next to the fake kubectl.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { collect, flagsFromEnv, resolveAnswers } from '../src/answers.mjs'
import { interview } from '../src/interview.mjs'
import { parseEnvFile } from '../src/secrets.mjs'
import { portFree, sshHost } from '../src/targets/hosts.mjs'
import { uninstallDocker } from '../src/targets/docker.mjs'
import { Output } from '../src/output.mjs'
import { Redactor } from '../src/secrets.mjs'
import { parse } from '../src/yaml.mjs'
import { cli, FakeDocker, ID, sandbox } from './fakes.mjs'

const IMAGE = 'slatebox-test:1'
const BASE = ['--image', IMAGE, '--ai', 'none', '--port', '17431', '--backups', 'off']
// Each time the install's container was made (docker run --detach); Compose is never run.
const ups = docker => docker.starts().length

function setup(options) {
  const docker = new FakeDocker(options)
  docker.addImage(IMAGE)
  return { docker, home: sandbox() }
}

const resolve = (partial, ctx = {}) => resolveAnswers(collect({ file: { ai: { mode: 'none' }, ...partial } }), { freePort: 7070, ...ctx })
const fields = result => result.errors.map(error => error.field)

// ------------------------------------------------------------------ 1

test('1: a second install from another home onto the same container and volume refuses to make a new key (exit 4)', async () => {
  const { docker } = setup()
  const first = sandbox(), second = sandbox()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home: first })).code, 0)
  const result = await cli(['install', ...BASE, '--yes', '--json'], { run: docker.run, home: second })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /SLATEBOX_KEY_ENCRYPTION_KEY/)
  assert.match(result.events.at(-1).message, /--new-encryption-key/)
  assert.equal(ups(docker), 1, 'the container was not recreated')
  assert.ok(!existsSync(join(second, 'installs', 'slatebox', 'secrets.env')), 'no new key was written')
})

test('1: uninstall (data kept), the install folder deleted, install again: refused until --new-encryption-key is given', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  assert.equal((await cli(['uninstall', '--yes'], { run: docker.run, home })).code, 0)
  assert.ok(docker.volumes.has('slatebox-data'))
  rmSync(join(home, 'installs'), { recursive: true, force: true })
  const refused = await cli(['install', ...BASE, '--yes', '--json'], { run: docker.run, home })
  assert.equal(refused.code, 4, refused.stderr)
  assert.match(refused.events.at(-1).message, /slatebox-data/)
  assert.equal(ups(docker), 1)
  const forced = await cli(['install', ...BASE, '--yes', '--new-encryption-key', '--json'], { run: docker.run, home })
  assert.equal(forced.code, 0, forced.stderr)
  assert.equal(forced.events.at(-1).keyGenerated, true)
})

test('1: --new-encryption-key is a command-line flag only, never from the environment', () => {
  assert.equal(flagsFromEnv({ SLATEBOX_INSTALL_NEW_ENCRYPTION_KEY: '1' })['new-encryption-key'], undefined)
})

test('1: over SSH a file that exists but cannot be read is an error, not "no file"', async () => {
  const run = async (cmd, args) => {
    const command = args.at(-1)
    if (command.includes('missing.env')) return { code: 3, stdout: '', stderr: '' }
    return { code: 1, stdout: '', stderr: 'cat: /opt/slatebox/secrets.env: Permission denied' }
  }
  const host = sshHost({ run, env: {} }, { host: 'h', user: 'root', port: 22, options: [], dir: '/opt/slatebox' }, { name: 'slatebox', home: sandbox() })
  assert.equal(await host.readFile('/opt/slatebox/missing.env'), null)
  await assert.rejects(host.readFile('/opt/slatebox/secrets.env'), error => error.exitCode === 4 && /Permission denied/.test(error.message))
})

// ------------------------------------------------------------------ 2

test('2: the backup script names docker by its absolute path (cron\'s PATH on macOS has no /usr/local/bin)', async () => {
  // docker is found first in a directory cron's PATH does not have (bin first: a Linux runner
  // has its own /usr/bin/docker, which must not be the one found).
  const { docker, home } = setup()
  const bin = join(home, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'docker'), '#!/bin/sh\n')
  chmodSync(join(bin, 'docker'), 0o755)
  const result = await cli(['install', '--image', IMAGE, '--ai', 'none', '--port', '17436', '--yes'], { run: docker.run, home, env: { PATH: `${bin}:/usr/bin` } })
  assert.equal(result.code, 0, result.stderr)
  const script = readFileSync(join(home, 'installs', 'slatebox', 'backup.sh'), 'utf8')
  assert.match(script, new RegExp(`^docker=${join(bin, 'docker').replace(/[/.]/g, '\\$&')}$`, 'm'))
})

test('2: status warns when the last scheduled backup is older than the schedule allows', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', '--image', IMAGE, '--ai', 'none', '--port', '17437', '--yes'], { run: docker.run, home })).code, 0)
  const backups = join(home, 'installs', 'slatebox', 'backups')
  mkdirSync(backups, { recursive: true })
  writeFileSync(join(backups, 'slatebox-20200101-030000.gz'), 'x')
  const status = await cli(['status', '--json'], { run: docker.run, home })
  const done = status.events.at(-1)
  assert.equal(done.lastBackup, 'slatebox-20200101-030000.gz')
  assert.equal(done.backupLate, true)
  assert.match(status.stderr, /last backup is .*old/i)
})

// ------------------------------------------------------------------ 3

test('3: this computer publishes on 127.0.0.1 only, unless --listen 0.0.0.0 is given (with a warning)', async () => {
  const { docker, home } = setup()
  const local = await cli(['plan', ...BASE, '--json'], { run: docker.run, home })
  assert.equal(local.code, 0, local.stderr)
  assert.deepEqual(local.events.find(event => event.event === 'plan').ports, ['127.0.0.1:17431:7070'])
  const open = await cli(['plan', ...BASE, '--listen', '0.0.0.0', '--json'], { run: docker.run, home })
  assert.equal(open.code, 0, open.stderr)
  const plan = open.events.find(event => event.event === 'plan')
  assert.deepEqual(plan.ports, ['17431:7070'])
  assert.match(plan.warnings.join('\n'), /every network interface/)
  const bad = resolve({ address: { port: 7070, listen: '10.0.0.5;x' } })
  assert.deepEqual(fields(bad), ['address.listen'])
})

test('3: a server over SSH still publishes on every interface (that is what it is for)', () => {
  const { answers, errors } = resolve({ target: 'ssh', ssh: { host: '203.0.113.5' }, adminEmail: 'o@example.com' })
  assert.deepEqual(errors, [])
  assert.equal(answers.address.listen, '0.0.0.0')
})

// ------------------------------------------------------------------ 4

test('4: consent never comes from the environment: SLATEBOX_INSTALL_YES and SLATEBOX_INSTALL_INSTALL_DOCKER are ignored', async () => {
  assert.deepEqual(flagsFromEnv({ SLATEBOX_INSTALL_YES: '1', SLATEBOX_INSTALL_INSTALL_DOCKER: 'true' }), {})
  const { docker, home } = setup()
  const result = await cli(['install', ...BASE], { run: docker.run, home, env: { SLATEBOX_INSTALL_YES: '1' } })
  assert.equal(result.code, 3, 'still needs --yes on the command line')
  assert.equal(ups(docker), 0)
})

// ------------------------------------------------------------------ 5

test('5: a key typed where a variable name belongs is refused and never echoed', async () => {
  const key = 'gsk_AbCdEf0123456789SECRETKEYVALUE'
  const { docker, home } = setup()
  const result = await cli(['plan', ...BASE.filter(arg => arg !== '--ai' && arg !== 'none'), '--ai-provider', `kind=groq,model=llama,key=env:${key}`], { run: docker.run, home, env: { AI_AGENT: '1' } })
  assert.equal(result.code, 2, result.stderr)
  assert.ok(!result.stdout.includes(key) && !result.stderr.includes(key), 'the key is not in the output')
  assert.ok(!result.stdout.includes('gsk_AbCd') && !result.stderr.includes('gsk_AbCd'), 'not even its start')
  assert.match(result.events.at(-1).fields[0].message, /looks like a key/)
  for (const name of ['sk_live_51HxAbCdEf0123456789', 'AKIAIOSFODNN7EXAMPLE', 'ghp_0123456789abcdefABCDEF0123456789abcd', 'xAbCdEfGh0123456789KlMnOpQr']) {
    assert.deepEqual(fields(resolve({ ai: { mode: 'providers', providers: [{ kind: 'openai', model: 'm', keyFrom: `env:${name}` }] } })), ['ai.providers[0].keyFrom'], name)
  }
  for (const name of ['OPENAI_API_KEY', 'GROQ_API_KEY', 'MY_COMPANY_LLM_TOKEN_2']) {
    assert.deepEqual(fields(resolve({ ai: { mode: 'providers', providers: [{ kind: 'openai', model: 'm', keyFrom: `env:${name}` }] } })), [], name)
  }
  assert.deepEqual(fields(resolve({ mail: { urlFrom: `env:${key}` } })), ['mail.urlFrom'])
})

function scriptedPrompt(answers) {
  const asked = []
  const next = (kind, question, options) => {
    asked.push({ kind, question })
    const script = answers.shift()
    if (typeof script === 'function') return script(question, options)
    return script
  }
  return {
    asked,
    text: async (question, options = {}) => {
      // Like the real prompt: offer each scripted answer to validate, and fail the test on a loop.
      for (;;) {
        const answer = next('text', question, options)
        if (answer === '' && options.optional) return ''
        const problem = options.validate?.(answer)
        if (!problem) return answer
        asked.push({ kind: 'rejected', question, problem })
        if (!answers.length) throw new Error(`no more answers after "${question}" rejected ${answer}`)
      }
    },
    choose: async (question, choices) => next('choose', question, choices),
    confirm: async question => next('confirm', question),
    secret: async question => next('secret', question),
  }
}

test('5: the interview asks how the key is given, and refuses a pasted key as a variable name', async () => {
  const key = 'gsk_AbCdEf0123456789SECRETKEYVALUE'
  const prompt = scriptedPrompt(['local', 'cloud', 'groq', 'llama-3.3-70b', 'env', key, 'GROQ_API_KEY', false, false, 'off', 'small', ''])
  const out = []
  const ctx = { prompt, stderr: { write: text => out.push(text) }, freePort: 7070, fetch: async () => ({ ok: false }) }
  const result = await interview(ctx, { address: { port: 7070 }, adminEmail: 'o@example.com' })
  assert.equal(result.ai.providers[0].keyFrom, 'env:GROQ_API_KEY')
  const rejected = prompt.asked.find(item => item.kind === 'rejected')
  assert.match(rejected.problem, /looks like a key/)
  assert.ok(!rejected.problem.includes(key))
})

test('5: the endpoint token question checks its answer too', async () => {
  const token = 'tok_0123456789AbCdEfGhIjKlMnOp'
  const prompt = scriptedPrompt(['local', 'endpoint', 'http://localhost:11434/v1', 'qwen3:8b', token, 'OLLAMA_TOKEN', false, 'off', 'small', ''])
  const ctx = { prompt, stderr: { write: () => {} }, freePort: 7070, fetch: async () => ({ ok: false }) }
  const result = await interview(ctx, { address: { port: 7070 }, adminEmail: 'o@example.com' })
  assert.equal(result.ai.providers[0].keyFrom, 'env:OLLAMA_TOKEN')
  assert.ok(prompt.asked.some(item => item.kind === 'rejected'))
})

// ------------------------------------------------------------------ 6

function fakeServer({ images = new Set(), facts = 'uid=0\narch=x86_64\nos=ubuntu 24.04\ndocker_path=/usr/bin/docker\ndocker_server=29.0.0\ncompose=2.40.0\nsystemd=yes\ncron=yes\ndisk_kb=99999999\nlistening=22\n', hostKey = false } = {}) {
  const commands = []
  const run = async (cmd, args, options = {}) => {
    if (cmd === 'ssh-keyscan') return { code: 0, stdout: 'h ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFake\n', stderr: '' }
    if (cmd === 'ssh-keygen') return { code: 0, stdout: '256 SHA256:Zm9vYmFyZmFrZWZpbmdlcnByaW50 h (ED25519)\n', stderr: '' }
    if (cmd !== 'ssh') return { code: 127, stdout: '', stderr: `${cmd} missing` }
    if (args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    const command = args.at(-1)
    commands.push({ command, input: options.input, inputFile: options.inputFile })
    if (hostKey) return { code: 255, stdout: '', stderr: 'Host key verification failed.\r\n' }
    if (command === 'sh -s' && String(options.input).includes('uid=$(id -u)')) return { code: 0, stdout: facts, stderr: '' }
    if (/\[ -e /.test(command)) return { code: 3, stdout: '', stderr: '' }
    const image = /docker image inspect --format '\{\{json \.\}\}' (\S+)$/.exec(command)
    if (image) return images.has(image[1]) ? { code: 0, stdout: JSON.stringify({ Id: ID(image[1]), RepoDigests: [], Architecture: 'amd64' }), stderr: '' } : { code: 1, stdout: '', stderr: 'No such image' }
    if (/docker (inspect|volume inspect)/.test(command)) return { code: 1, stdout: '', stderr: 'No such object' }
    if (/docker run .*settings/.test(command)) return { code: 2, stdout: '', stderr: 'Usage, from the Docker host:\n  docker exec slatebox slatebox backup > x\n' }
    if (/docker run .*configure\.mjs/.test(command)) return { code: 1, stdout: '', stderr: 'Unknown setting SLATEBOX_INSTALLER_PROBE. The settings are: SLATEBOX_URL, SLATEBOX_KEY_ENCRYPTION_KEY (in capitals).' }
    if (/docker run .*mongod/.test(command)) return { code: 0, stdout: 'db version v8.0.17', stderr: '' }
    return { code: 0, stdout: '', stderr: '' }
  }
  return { run, commands }
}

const SSH = ['ssh', 'root@203.0.113.5', '--admin-email', 'ops@example.com', '--ai', 'none', '--image', 'registry.example.com/sb/slatebox:1', '--json']

test('6: plan over SSH with the image not on the server: no pull, no load, no container run', async () => {
  const server = fakeServer()
  const archive = join(sandbox(), 'image.tar')
  writeFileSync(archive, 'tar')
  for (const extra of [[], ['--image-archive', archive]]) {
    const result = await cli(['plan', ...SSH, ...extra], { run: server.run, home: sandbox() })
    assert.equal(result.code, 0, result.stderr)
    const plan = result.events.find(event => event.event === 'plan')
    assert.match(plan.notes.join('\n') + plan.commands.join('\n'), /after you (confirm|say yes)/i)
  }
  const changing = server.commands.filter(item => /docker (pull|load|run)\b/.test(item.command) || item.inputFile)
  assert.deepEqual(changing, [], 'plan only inspects')
})

test('6: install over SSH without a yes stops before pulling or loading anything', async () => {
  const server = fakeServer()
  const result = await cli(['install', ...SSH], { run: server.run, home: sandbox() })
  assert.equal(result.code, 3, result.stderr)
  assert.deepEqual(server.commands.filter(item => /docker (pull|load|run)\b/.test(item.command)), [])
})

test('6: plan on this computer with the image missing does not pull it', async () => {
  const docker = new FakeDocker()
  docker.registry.set('registry.example.com/sb/slatebox:1', 'v1')
  const result = await cli(['plan', '--image', 'registry.example.com/sb/slatebox:1', '--ai', 'none', '--port', '17438', '--json'], { run: docker.run, home: sandbox() })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(docker.count(call => call.args[0] === 'pull'), 0)
})

test('6: install on this computer with the image missing pulls after the yes, then probes it', async () => {
  const docker = new FakeDocker()
  docker.registry.set('registry.example.com/sb/slatebox:1', 'v1')
  const result = await cli(['install', '--image', 'registry.example.com/sb/slatebox:1', '--ai', 'none', '--port', '17439', '--backups', 'off', '--yes', '--json'], { run: docker.run, home: sandbox() })
  assert.equal(result.code, 0, result.stderr)
  const pull = docker.calls.findIndex(call => call.args[0] === 'pull')
  const probe = docker.calls.findIndex(call => call.args[0] === 'run')
  assert.ok(pull >= 0 && probe > pull)
  assert.equal(result.events.at(-1).imageDigest, ID('v1'))
})

// ------------------------------------------------------------------ 8

test('8: upgrade pulls the install\'s own tag again (a cached tag is not "up to date"), and stays on its repository', async () => {
  const ref = 'registry.example.com/sb/slatebox:stable'
  const docker = new FakeDocker()
  docker.addImage(ref)
  const home = sandbox()
  assert.equal((await cli(['install', '--image', ref, '--ai', 'none', '--port', '17440', '--backups', 'off', '--yes'], { run: docker.run, home })).code, 0)
  docker.registry.set(ref, 'stable-2')
  const result = await cli(['upgrade', '--yes', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(docker.calls.filter(call => call.args[0] === 'pull').map(call => call.args[1]), [ref])
  assert.equal(result.events.at(-1).imageDigest, ID('stable-2'))
  assert.equal(docker.containers.get('slatebox').image, ID('stable-2'))
})

test('8: when the tag cannot be pulled, upgrade says so and keeps the local copy', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  const result = await cli(['upgrade', '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.events.at(-1).nothingToChange, true)
  assert.match(result.stderr, /could not be pulled/)
})

// ------------------------------------------------------------------ 9

test('9: an answers file cannot smuggle commands: ssh options, host, user, dir, S3 URL, schedule and image are checked', () => {
  const ssh = extra => resolve({ target: 'ssh', adminEmail: 'o@example.com', ssh: { host: 'h', ...extra } })
  assert.deepEqual(fields(ssh({ options: ['ProxyCommand=touch /tmp/pwned'] })), ['ssh.options'])
  assert.deepEqual(fields(ssh({ options: ['LocalCommand=id', 'PermitLocalCommand=yes'] })), ['ssh.options'])
  assert.deepEqual(fields(ssh({ options: ['StrictHostKeyChecking=no'] })), ['ssh.options'])
  assert.deepEqual(fields(ssh({ options: ['ConnectTimeout=10', 'StrictHostKeyChecking=accept-new', 'UserKnownHostsFile=/home/me/.ssh/kh', 'ProxyJump=bastion.example.com'] })), [])
  assert.deepEqual(fields(ssh({ options: ['ProxyJump=-oProxyCommand=id'] })), ['ssh.options'])
  assert.deepEqual(fields(ssh({ host: '-oProxyCommand=touch /tmp/x', user: '' })), ['ssh.host'])
  assert.deepEqual(fields(ssh({ user: '-oProxyCommand=x' })), ['ssh.user'])
  assert.deepEqual(fields(ssh({ dir: '/opt/x;touch /tmp/pwned;#' })), ['ssh.dir'])
  assert.deepEqual(fields(ssh({ dir: '/opt/../etc' })), ['ssh.dir'])
  assert.deepEqual(fields(resolve({ backups: { to: 's3://bkt/$(touch /tmp/pwn2)' } })), ['backups.to'])
  assert.deepEqual(fields(resolve({ backups: { to: 's3://my-bucket/slatebox/prod' } })), [])
  assert.deepEqual(fields(resolve({ backups: { schedule: '0 3 * * *;id' } })), ['backups.schedule'])
  assert.deepEqual(fields(resolve({ backups: { schedule: '*/30 2-4 * * 1-5' } })), [])
  assert.deepEqual(fields(resolve({ image: '--privileged' })), ['image'])
  assert.deepEqual(fields(resolve({ backups: { to: '/srv/b\nx' } })), ['backups.to'])
})

// ------------------------------------------------------------------ 10

function sshRecord(dir) {
  const { answers } = resolve({ target: 'ssh', adminEmail: 'o@example.com', ssh: { host: 'h', dir } })
  return answers
}

test('10: uninstall --delete-data over SSH removes only the installer\'s own files, and refuses a folder without its marker', async () => {
  const commands = []
  let marker = false
  const run = async (cmd, args, options = {}) => {
    if (args[0] === '-O') return { code: 0, stdout: '', stderr: '' }
    const command = args.at(-1)
    commands.push(command)
    if (command.includes('[ "$(id -u)" = 0 ]')) return { code: 0, stdout: 'root\n', stderr: '' }
    if (command.includes('.slatebox-install')) {
      if (/\bcat\b/.test(command) && !/rm -f/.test(command)) return marker ? { code: 0, stdout: 'slatebox\n', stderr: '' } : { code: 1, stdout: '', stderr: 'No such file' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  const ctx = { run, env: {}, home: sandbox(), out: new Output({ stdout: { write() {} }, stderr: { write() {} }, json: true, redactor: new Redactor() }) }
  await assert.rejects(uninstallDocker(ctx, sshRecord('/opt'), { deleteData: true }), error => error.exitCode === 4 && /\/opt/.test(error.message))
  assert.ok(!commands.some(command => /volume.*rm|rm -rf/.test(command)), `nothing removed: ${commands.join('\n')}`)
  marker = true
  commands.length = 0
  const done = await uninstallDocker(ctx, sshRecord('/opt/slatebox'), { deleteData: true })
  assert.equal(done.dataDeleted, true)
  assert.ok(!commands.some(command => /rm -rf '?\/opt\/slatebox'?(\s|$)/.test(command)), 'never rm -rf of the whole folder')
  assert.ok(commands.some(command => /secrets\.env/.test(command) && /rm -f/.test(command)))
})

// ------------------------------------------------------------------ 11

test('11: a port held on 127.0.0.1 or ::1 only is not free', async () => {
  for (const address of ['127.0.0.1', '::1']) {
    const server = createServer()
    const listening = await new Promise(done => { server.once('error', () => done(false)); server.listen(0, address, () => done(true)) })
    if (!listening) continue // no IPv6 here
    const { port } = server.address()
    assert.equal(await portFree(port), false, `${address}:${port}`)
    await new Promise(done => server.close(done))
  }
})

// ------------------------------------------------------------------ 12

test('12: an exported compose file lets Docker pull the image', async () => {
  const { docker, home } = setup()
  const dir = join(home, 'out')
  const result = await cli(['install', 'export', '--image', IMAGE, '--ai', 'none', '--out', dir, '--json'], { run: docker.run, home })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(parse(readFileSync(join(dir, 'compose.yaml'), 'utf8')).services.slatebox.pull_policy, undefined)
})

// ------------------------------------------------------------------ 13

test('13: an image for another processor architecture is refused before anything starts', async () => {
  const docker = new FakeDocker({ serverArch: 'amd64' })
  docker.addImage('slatebox-test:arm', { arch: 'arm64' })
  const result = await cli(['install', '--image', 'slatebox-test:arm', '--ai', 'none', '--port', '17441', '--backups', 'off', '--yes', '--json'], { run: docker.run, home: sandbox() })
  assert.equal(result.code, 4, result.stderr)
  assert.match(result.events.at(-1).message, /arm64.*amd64|amd64.*arm64/)
  assert.equal(ups(docker), 0)
})

// ------------------------------------------------------------------ 14

test('14: an unknown SSH host key: exit 4 with its fingerprint and "ssh user@host once", never StrictHostKeyChecking=no', async () => {
  const server = fakeServer({ hostKey: true })
  const result = await cli(['install', ...SSH, '--yes'], { run: server.run, home: sandbox() })
  assert.equal(result.code, 4, result.stderr)
  const message = result.events.at(-1).message
  assert.match(message, /SHA256:Zm9vYmFyZmFrZWZpbmdlcnByaW50/)
  assert.match(message, /ssh root@203\.0\.113\.5/)
  assert.doesNotMatch(result.stdout + result.stderr, /StrictHostKeyChecking=no/)
})

// ------------------------------------------------------------------ 15

test('15: a relative or ~ backup folder is made absolute once and stored that way', () => {
  const home = resolve({ backups: { to: '~/slatebox-backups' } }, { cwd: '/work', home: '/Users/me' })
  assert.equal(home.answers.backups.to, '/Users/me/slatebox-backups')
  const relative = resolve({ backups: { to: 'bk' } }, { cwd: '/work', home: '/Users/me' })
  assert.equal(relative.answers.backups.to, '/work/bk')
  const remote = resolve({ target: 'ssh', adminEmail: 'o@example.com', ssh: { host: 'h' }, backups: { to: 'bk' } }, { cwd: '/work', home: '/Users/me' })
  assert.deepEqual(fields(remote), ['backups.to'])
})

test('15: the stored folder does not move when the installer runs from another directory', async () => {
  const { docker, home } = setup()
  const first = join(home, 'a'), second = join(home, 'b')
  mkdirSync(first); mkdirSync(second)
  assert.equal((await cli(['install', '--image', IMAGE, '--ai', 'none', '--port', '17442', '--backups', 'bk', '--yes'], { run: docker.run, home, cwd: first })).code, 0)
  const record = parse(readFileSync(join(home, 'installs', 'slatebox', 'install.yaml'), 'utf8'))
  assert.equal(record.backups.to, join(first, 'bk'))
  const again = await cli(['install', '--image', IMAGE, '--json'], { run: docker.run, home, cwd: second })
  assert.equal(again.code, 0, again.stderr)
  assert.equal(again.events.find(event => event.event === 'plan').action, 'nothing')
})

// ------------------------------------------------------------------ 16

test('16: the domain must be a host name', () => {
  for (const domain of ['a.com{', 'a$(id).com', 'a.com;id', 'a`id`.com', '-a.com', 'a..com']) {
    assert.ok(fields(resolve({ target: 'ssh', adminEmail: 'o@example.com', ssh: { host: 'h' }, address: { domain } })).includes('address.url'), domain)
  }
  assert.deepEqual(fields(resolve({ target: 'ssh', adminEmail: 'o@example.com', ssh: { host: 'h' }, address: { domain: 'boards.example.com' } })), [])
})

// ------------------------------------------------------------------ 17

test('17: an upgrade of a stopped install says, in the plan, that there is no backup to roll back to', async () => {
  const { docker, home } = setup()
  docker.addImage('slatebox-test:2')
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  docker.containers.get('slatebox').running = false
  const result = await cli(['upgrade', '--to', 'slatebox-test:2', '--json'], { run: docker.run, home })
  assert.equal(result.code, 3)
  assert.match(result.events.find(event => event.event === 'plan').warnings.join('\n'), /no backup/i)
})

// ------------------------------------------------------------------ 18

test('18: native Windows is refused at preflight with a pointer to WSL', async () => {
  const { docker, home } = setup()
  const result = await cli(['install', ...BASE, '--yes', '--json'], { run: docker.run, home, platform: 'win32' })
  assert.equal(result.code, 4)
  assert.match(result.events.at(-1).message, /WSL/)
  assert.equal(docker.calls.length, 0)
})

// ------------------------------------------------------------------ 19

test('19: in JSON mode the admin step does not claim a link is printed below; it says how to get one', async () => {
  const docker = new FakeDocker({ commands: ['admin'] })
  docker.addImage(IMAGE)
  const run = async (cmd, args, options) => (cmd === 'docker' && args.includes('admin') ? { code: 0, stdout: 'https://x/set-password/abcdef123456\n', stderr: '' } : docker.run(cmd, args, options))
  const result = await cli(['install', ...BASE, '--admin-email', 'ops@example.com', '--yes', '--json'], { run, home: sandbox() })
  assert.equal(result.code, 0, result.stderr)
  const admin = result.events.find(event => event.id === 'admin')
  assert.doesNotMatch(admin.detail, /printed below/)
  assert.match(admin.detail, /password-link/)
  assert.ok(!result.stdout.includes('abcdef123456'))
})

test('19: restore shows a plan saying the data will be replaced before it asks for a yes', async () => {
  const { docker, home } = setup()
  assert.equal((await cli(['install', ...BASE, '--yes'], { run: docker.run, home })).code, 0)
  const archive = join(home, 'b.gz')
  writeFileSync(archive, 'x')
  const result = await cli(['restore', archive, '--json'], { run: docker.run, home })
  assert.equal(result.code, 3)
  const plan = result.events.find(event => event.event === 'plan')
  assert.equal(plan.action, 'restore')
  assert.match(plan.warnings.join('\n'), /replace/i)
})
