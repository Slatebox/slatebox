// Stand-ins for docker, kubectl, ssh and crontab, so the CLI's orchestration
// can be tested in process. They record every call (arguments and standard
// input) so tests can check what was run and that no secret was in arguments.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { LEGACY_SETTINGS } from '../src/ai/settings-adapter.mjs'
import { main } from '../src/cli.mjs'

export const ID = tag => `sha256:${Buffer.from(tag).toString('hex').padEnd(64, '0').slice(0, 64)}`
const USAGE = 'Usage, from the Docker host:\n  docker exec slatebox slatebox backup > x\n  docker exec slatebox slatebox health\n'

export class FakeDocker {
  constructor({ settings = LEGACY_SETTINGS, broken = [], serverArch = 'amd64', commands = [] } = {}) {
    this.calls = []
    this.images = new Map()
    this.arch = new Map()
    this.containers = new Map()
    this.volumes = new Set()
    this.settings = settings
    this.broken = new Set(broken.map(ID))
    this.crontab = null
    this.serverArch = serverArch
    this.commands = commands
    // What `docker pull <ref>` gets: ref -> the tag of the image it resolves to.
    this.registry = new Map()
  }

  addImage(ref, { arch } = {}) {
    this.images.set(ref, ID(ref))
    this.images.set(ID(ref), ID(ref))
    if (arch) this.arch.set(ID(ref), arch)
  }

  run = async (cmd, args, options = {}) => {
    this.calls.push({ cmd, args, input: options.input })
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' })
    const fail = (stderr = 'failed', code = 1) => ({ code, stdout: '', stderr })
    if (cmd === 'crontab') {
      if (args[0] === '-l') return this.crontab === null ? fail('no crontab for you') : ok(this.crontab)
      this.crontab = options.input
      return ok()
    }
    if (cmd !== 'docker') return fail(`${cmd} is not installed`, 127)
    const [verb, ...rest] = args
    if (verb === 'version') return ok(rest.includes('{{.Server.Arch}}') ? `${this.serverArch}\n` : '29.4.0\n')
    if (verb === 'compose' && rest[0] === 'version') return ok('2.40.0\n')
    if (verb === 'image' && rest[0] === 'inspect') {
      const ref = rest.at(-1)
      if (!this.images.has(ref)) return fail(`No such image: ${ref}`)
      const id = this.images.get(ref)
      return ok(JSON.stringify({ Id: id, RepoDigests: [], Created: '2026-11-20T00:00:00Z', ...(this.arch.has(id) ? { Architecture: this.arch.get(id) } : {}), Config: { Labels: { 'org.opencontainers.image.version': ref.split(':').pop() } } }))
    }
    if (verb === 'pull') {
      const tag = this.registry.get(rest[0])
      if (!tag) return fail(`pull access denied for ${rest[0]}`)
      this.images.set(rest[0], ID(tag))
      this.images.set(ID(tag), ID(tag))
      return ok()
    }
    if (verb === 'load') return ok('Loaded image: archived:1\n')
    if (verb === 'volume' && rest[0] === 'inspect') return this.volumes.has(rest.at(-1)) ? ok('{}') : fail(`no such volume: ${rest.at(-1)}`)
    if (verb === 'run') {
      if (args.includes('settings')) return { code: 2, stdout: '', stderr: USAGE + this.commands.map(command => `  docker exec slatebox slatebox ${command}\n`).join('') }
      if (args.includes('/opt/slatebox/lib/configure.mjs')) return fail(`Unknown setting SLATEBOX_INSTALLER_PROBE. The settings are: ${this.settings.join(', ')} (in capitals).`)
      if (args.includes('mongod')) return ok('db version v8.0.17')
      return fail('unexpected run')
    }
    if (verb === 'inspect') {
      const container = this.containers.get(rest.at(-1))
      if (!container) return fail('No such object')
      if (rest.includes('{{json .State}}')) return ok(JSON.stringify({ Running: container.running, Status: 'running', Health: { Status: container.health } }))
      return ok(JSON.stringify({ State: { Running: container.running, Health: { Status: container.health } }, Image: container.image }))
    }
    if (verb === 'compose') {
      const dir = rest[rest.indexOf('--project-directory') + 1]
      const name = rest[rest.indexOf('-p') + 1]
      const action = rest.find(arg => ['up', 'down', 'stop'].includes(arg))
      if (action === 'up') {
        const { readFileSync } = await import('node:fs')
        const image = /image: (\S+)/.exec(readFileSync(join(dir, 'compose.yaml'), 'utf8'))[1]
        const broken = this.broken.has(image)
        this.containers.set(name, { running: true, health: broken ? 'unhealthy' : 'healthy', image })
        this.volumes.add(`${name}-data`)
        return broken ? fail('container slatebox is unhealthy') : ok()
      }
      if (action === 'down') { this.containers.delete(name); return ok() }
      if (action === 'stop') { const c = this.containers.get(name); if (c) c.running = false; return ok() }
    }
    if (verb === 'exec') {
      const name = rest.find(arg => !arg.startsWith('-'))
      const container = this.containers.get(name)
      if (!container) return fail('No such container')
      if (args.includes('health')) return container.health === 'healthy' ? ok() : fail('The app is not ready (HTTP 502 from /readyz).')
      if (args.includes('backup')) {
        if (options.outputFile) writeFileSync(options.outputFile, 'BACKUP')
        return ok()
      }
      if (args.includes('restore')) return ok()
      if (args.includes('version')) return ok('{"app":"abc","engine":"def"}')
      if (args.includes('node')) return ok('{"users":2,"slates":5,"files":1}\n')
    }
    if (verb === 'volume' && rest[0] === 'rm') { this.volumes.delete(rest[1]); return ok() }
    if (verb === 'rm') { this.containers.delete(rest.at(-1)); return ok() }
    return fail(`fake docker does not know: ${args.join(' ')}`)
  }

  count(predicate) {
    return this.calls.filter(predicate).length
  }
}

export function sandbox() {
  return mkdtempSync(join(tmpdir(), 'sbx-cli-'))
}

/** Run the CLI in process. Returns { code, stdout, stderr, events }. */
export async function cli(argv, { run, env = {}, home, fetch, tty = false, input = '', platform, cwd } = {}) {
  const stdout = new PassThrough(), stderr = new PassThrough()
  const stdin = new PassThrough()
  stdin.isTTY = tty
  stderr.isTTY = tty
  stdout.isTTY = tty
  stdin.end(input)
  let out = '', err = ''
  stdout.on('data', chunk => (out += chunk))
  stderr.on('data', chunk => (err += chunk))
  const code = await main(argv, {
    env: { HOME: home, PATH: process.env.PATH, ...env, SLATEBOX_INSTALL_HOME: home },
    stdin, stdout, stderr, run, platform, cwd,
    fetch: fetch || (async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })),
  })
  const events = out.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return { unparsed: line } }
  })
  return { code, stdout: out, stderr: err, events }
}
