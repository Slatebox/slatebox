// A fake Cloudflare API (tunnels, DNS records, zone settings) behind a fetch function, for the
// team-address tests (scripts/team-addresses.test.mjs). MIT, test support. Only the calls
// enterprise/team-addresses/cf.mjs makes are implemented, with Cloudflare's envelope
// ({ success, errors, result, result_info }) and its 404s. fail() injects failures by method and path.
import { randomUUID } from 'node:crypto'

export const FAKE = Object.freeze({ token: 'cf-test-token-0123456789abcdef', accountId: 'a'.repeat(32), zoneId: 'z'.repeat(32) })

export function createFakeCloudflare({ token = FAKE.token, accountId = FAKE.accountId, zoneId = FAKE.zoneId, now = () => Date.now() } = {}) {
  const tunnels = new Map()
  const records = new Map()
  const settings = { websockets: 'on', ssl: 'full', always_use_https: 'on', min_tls_version: '1.2', email_obfuscation: 'off', rocket_loader: 'off' }
  const calls = []
  const failures = []

  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const ok = (result, info) => json(200, { success: true, errors: [], messages: [], result, ...(info && { result_info: info }) })
  const notFound = (code = 1003) => json(404, { success: false, errors: [{ code, message: 'Not found' }], result: null })
  const tokenFor = (tunnel) => Buffer.from(JSON.stringify({ a: accountId, t: tunnel.id, s: tunnel.secret })).toString('base64')
  const page = (rows, url) => {
    const per = Number(url.searchParams.get('per_page') || 100)
    const at = Number(url.searchParams.get('page') || 1)
    return ok(rows.slice((at - 1) * per, at * per), { page: at, per_page: per, total_count: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / per)) })
  }

  async function fetch(input, init = {}) {
    const url = new URL(input)
    const method = (init.method || 'GET').toUpperCase()
    const path = url.pathname.replace(/^\/client\/v4/, '')
    calls.push({ method, path, query: url.search, body: init.body ? JSON.parse(init.body) : undefined, headers: { ...init.headers } })
    const failure = failures.find((entry) => entry.times > 0 && entry.method === method && entry.path.test(path))
    if (failure) {
      failure.times -= 1
      if (failure.network) throw new TypeError('fetch failed')
      return json(failure.status, { success: false, errors: [{ code: failure.code || 1000 + failure.status, message: failure.message || 'injected failure' }], result: null }, failure.headers || {})
    }
    if (init.headers?.Authorization !== `Bearer ${token}`) return json(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null })
    const body = init.body ? JSON.parse(init.body) : undefined
    let match
    const acct = `/accounts/${accountId}`
    const zone = `/zones/${zoneId}`
    if (path === `${acct}/cfd_tunnel` && method === 'GET') {
      const name = url.searchParams.get('name')
      const rows = [...tunnels.values()].filter((t) => !t.deleted_at && (!name || t.name === name)).map(({ secret, config, ...t }) => t)
      return page(rows, url)
    }
    if (path === `${acct}/cfd_tunnel` && method === 'POST') {
      if ([...tunnels.values()].some((t) => !t.deleted_at && t.name === body.name)) return json(409, { success: false, errors: [{ code: 1013, message: 'tunnel name exists' }] })
      const tunnel = { id: randomUUID(), name: body.name, created_at: new Date(now()).toISOString(), deleted_at: null, connections: [], status: 'inactive', secret: Buffer.from(randomUUID()).toString('base64'), config: null, clients: [] }
      tunnels.set(tunnel.id, tunnel)
      return ok({ id: tunnel.id, name: tunnel.name, created_at: tunnel.created_at, token: tokenFor(tunnel) })
    }
    if ((match = path.match(new RegExp(`^${acct}/cfd_tunnel/([^/]+)(/[a-z]+)?$`)))) {
      const tunnel = tunnels.get(decodeURIComponent(match[1]))
      if (!tunnel || tunnel.deleted_at) return notFound(1003)
      const sub = match[2] || ''
      if (sub === '' && method === 'GET') return ok({ id: tunnel.id, name: tunnel.name, created_at: tunnel.created_at, connections: tunnel.connections, status: tunnel.status })
      if (sub === '' && method === 'PATCH') {
        if (body.tunnel_secret) tunnel.secret = body.tunnel_secret
        return ok({ id: tunnel.id, name: tunnel.name })
      }
      if (sub === '' && method === 'DELETE') {
        if (tunnel.connections.length) return json(400, { success: false, errors: [{ code: 1022, message: 'tunnel has active connections' }] })
        tunnel.deleted_at = new Date(now()).toISOString()
        return ok({ id: tunnel.id })
      }
      if (sub === '/connections' && method === 'GET') return ok(tunnel.clients)
      if (sub === '/connections' && method === 'DELETE') {
        tunnel.connections = []
        tunnel.clients = []
        return ok(null)
      }
      if (sub === '/configurations' && method === 'PUT') {
        tunnel.config = body.config
        return ok({ tunnel_id: tunnel.id, version: (tunnel.version = (tunnel.version || 0) + 1), config: body.config })
      }
      if (sub === '/configurations' && method === 'GET') return ok({ tunnel_id: tunnel.id, config: tunnel.config })
      if (sub === '/token' && method === 'GET') return ok(tokenFor(tunnel))
    }
    if (path === `${zone}/dns_records` && method === 'GET') {
      const name = url.searchParams.get('name')
      const type = url.searchParams.get('type')
      return page([...records.values()].filter((r) => (!name || r.name === name) && (!type || r.type === type)), url)
    }
    if (path === `${zone}/dns_records` && method === 'POST') {
      if ([...records.values()].some((r) => r.name === body.name)) return json(400, { success: false, errors: [{ code: 81053, message: 'record already exists' }] })
      const record = { id: randomUUID().replace(/-/g, ''), ...body, created_on: new Date(now()).toISOString() }
      records.set(record.id, record)
      return ok(record)
    }
    if ((match = path.match(new RegExp(`^${zone}/dns_records/([^/]+)$`))) && method === 'DELETE') {
      if (!records.delete(decodeURIComponent(match[1]))) return notFound(81044)
      return ok({ id: match[1] })
    }
    if ((match = path.match(new RegExp(`^${zone}/settings/([a-z_]+)$`))) && method === 'GET') return ok({ id: match[1], value: settings[match[1]] })
    return notFound(7003)
  }

  return {
    fetch,
    tunnels,
    records,
    settings,
    calls,
    tokenFor,
    liveTunnels: () => [...tunnels.values()].filter((t) => !t.deleted_at),
    // Fail the next `times` calls of method to a path matching `path` (a RegExp).
    fail(method, path, { status = 500, times = 1, network = false, code, message, headers } = {}) {
      failures.push({ method, path, status, times, network, code, message, headers })
    },
    // A connector joins (what Cloudflare would report while an install is connected).
    connect(tunnelId, clientId = randomUUID()) {
      const tunnel = tunnels.get(tunnelId)
      tunnel.connections.push({ id: randomUUID(), client_id: clientId })
      if (!tunnel.clients.some((client) => client.id === clientId)) tunnel.clients.push({ id: clientId, conns: [{ origin_ip: '203.0.113.7' }] })
      tunnel.status = 'healthy'
    },
  }
}
