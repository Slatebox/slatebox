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
      if (args.includes('tunnel')) return this.commands.includes('tunnel') ? ok('{"configured":true,"ready":true,"connections":4}\n') : fail('Usage, from the Docker host:', 2)
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
export async function cli(argv, { run, env = {}, home, fetch, tty = false, input = '', platform, cwd, io = {} } = {}) {
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
    ...io,
  })
  const events = out.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line) } catch { return { unparsed: line } }
  })
  return { code, stdout: out, stderr: err, events }
}

// ------------------------------------------------------------------ Slatebox Cloud

export const TUNNEL = 'eyJhIjoiYWNjdCIsInQiOiJ0dW5uZWwtaWQiLCJzIjoic2VjcmV0LXNlY3JldC1zZWNyZXQifQ=='
export const ROTATED = 'eyJhIjoiYWNjdCIsInQiOiJ0dW5uZWwtaWQiLCJzIjoibmV3LXNlY3JldC1uZXctc2VjcmV0In0='
export const CREDENTIAL = 'sbxi_ab12cd34_fake-install-credential-0123456789'
export const ACCESS = 'sbxo_access_token_for_team_addresses_0123456789'
export const DEVICE = 'device-code-0123456789abcdefghijklmnop'

/**
 * Slatebox Cloud's team-address API and device sign-in (spec sections 2 and 4.4), as a fetch
 * function. Addresses answer /readyz once claimed, as if the tunnel were up. Every request is
 * recorded; `offline` makes every Cloud request fail as if DNS did not resolve.
 */
export class FakeCloud {
  constructor({ base = 'http://127.0.0.1:3999', taken = [], pendingPolls = 1, offline = false } = {}) {
    this.base = base
    this.taken = new Set(taken)
    this.pendingPolls = pendingPolls
    this.offline = offline
    this.requests = []
    this.claims = new Map()
    this.credential = CREDENTIAL
    this.token = TUNNEL
    this.revoked = false
    this.deny = false
  }

  cloudRequests(path) { return this.requests.filter(request => !path || request.path.startsWith(path)) }

  fetch = async (url, init = {}) => {
    const u = new URL(url)
    const json = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: name => headers[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(body), json: async () => body })
    if (u.origin !== this.base) {
      // A claimed address answers through its "tunnel".
      const claimed = [...this.claims.values()].some(claim => `https://${claim.name}.slatebox.team` === u.origin && claim.status === 'active')
      if (claimed && u.pathname === '/readyz') return json(200, { ok: true })
      // This computer's own published port answers, as with the default fake fetch.
      if (u.hostname === 'localhost' && u.pathname === '/readyz') return json(200, { ok: true })
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    }
    if (this.offline) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init.body ? (headers['content-type']?.includes('json') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null
    this.requests.push({ method: init.method || 'GET', path: u.pathname + u.search, headers, body })
    const bearer = headers.authorization?.replace(/^Bearer /, '')
    const route = `${init.method || 'GET'} ${u.pathname}`
    if (route === 'POST /oauth/device_authorization') {
      return json(200, { device_code: DEVICE, user_code: 'WDJB-MJHT', verification_uri: `${this.base}/device`, verification_uri_complete: `${this.base}/device?code=WDJB-MJHT`, expires_in: 600, interval: 5 })
    }
    if (route === 'POST /oauth/token') {
      if (this.deny) return json(400, { error: 'access_denied' })
      if (this.pendingPolls-- > 0) return json(400, { error: 'authorization_pending' })
      return json(200, { access_token: ACCESS, token_type: 'Bearer', expires_in: 900, scope: 'team-addresses' })
    }
    const api = u.pathname.replace(/^\/api\/v1\/team-addresses/, '')
    if (route.startsWith('GET /api/v1/team-addresses/availability')) {
      const name = u.searchParams.get('name')
      const free = !this.taken.has(name) && ![...this.claims.values()].some(claim => claim.name === name && claim.status === 'active')
      return json(200, { name, available: free, ...(free ? {} : { suggestions: [`${name}-team`, `team-${name}`] }) })
    }
    if (route === 'POST /api/v1/team-addresses') {
      if (bearer !== ACCESS) return json(401, { error: { code: 'unauthorized', message: 'sign in' } })
      if (this.taken.has(body.name)) return json(409, { error: { code: 'unavailable', message: 'unavailable' } })
      const existing = [...this.claims.values()].find(claim => claim.idempotencyKey === headers['idempotency-key'])
      if (existing) return json(201, { claim: this.view(existing), installCredential: null, connectorToken: this.token })
      const claim = { id: `ta_${this.claims.size + 1}`, name: body.name, status: 'active', idempotencyKey: headers['idempotency-key'], label: body.label, clientKey: body.clientKey }
      this.claims.set(claim.id, claim)
      return json(201, { claim: this.view(claim), installCredential: this.credential, connectorToken: this.token, count: this.claims.size, limit: 3 })
    }
    const self = bearer === this.credential && !this.revoked ? [...this.claims.values()].find(claim => claim.status === 'active') : null
    if (api.startsWith('/self')) {
      if (!self) return json(401, { error: { code: 'unauthorized', message: 'unknown install credential' } })
      if (route === 'GET /api/v1/team-addresses/self') return json(200, { claim: this.view(self) })
      if (route === 'POST /api/v1/team-addresses/self/connector-token') {
        if (body?.rotate) this.token = ROTATED
        return json(200, { connectorToken: this.token }, { 'cache-control': 'no-store' })
      }
      if (route === 'POST /api/v1/team-addresses/self/rename-complete') { delete self.previousName; return json(200, { ok: true }) }
      if (route === 'DELETE /api/v1/team-addresses/self') { self.status = 'released'; return json(200, { ok: true }) }
    }
    const match = /^\/(ta_\d+)(\/rename|\/install-credential)?$/.exec(api)
    if (match) {
      if (bearer !== ACCESS) return json(401, { error: { code: 'unauthorized', message: 'sign in' } })
      const claim = this.claims.get(match[1])
      if (!claim) return json(404, { error: { code: 'not_found', message: 'no such claim' } })
      if (match[2] === '/rename') {
        if (this.taken.has(body.name)) return json(409, { error: { code: 'unavailable', message: 'unavailable' } })
        claim.previousName = claim.name
        claim.name = body.name
        return json(200, { claim: this.view(claim) })
      }
      if (match[2] === '/install-credential') {
        this.credential = 'sbxi_ef56gh78_fake-new-install-credential-0123456789'
        this.revoked = false
        return json(201, { claim: this.view(claim), installCredential: this.credential, connectorToken: this.token })
      }
    }
    return json(404, { error: { code: 'not_found', message: `fake cloud does not know ${route}` } })
  }

  view(claim) { return { id: claim.id, name: claim.name, host: `${claim.name}.slatebox.team`, status: claim.status } }
}
