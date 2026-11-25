// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Cloudflare calls team addresses make, and nothing else: Cloudflare Tunnels in our account
// and CNAME records in the slatebox.team zone. fetch is injected (tests use a fake Cloudflare).
//
//   timeout   10 seconds per attempt
//   retries   up to 4 attempts, backing off 0.5s, 1s, 2s, 4s plus jitter, only on network errors,
//             429 (honoring Retry-After, at most 30s) and 5xx; never on another 4xx
//   secrets   the API token goes in the Authorization header only; request headers are never
//             logged, and a failure keeps only Cloudflare's errors[].code and message
//   tokens    a tunnel's connector token is returned to the caller and never kept here
const API = 'https://api.cloudflare.com/client/v4'
export const TUNNEL_PREFIX = 'sbx-'
export const DNS_COMMENT_PREFIX = 'slatebox-team-claim:'

export class CloudflareError extends Error {
  constructor(message, { status = 0, retryable = false, errors = [], step } = {}) {
    super(message)
    this.name = 'CloudflareError'
    this.status = status
    this.retryable = retryable
    // Only code and message, trimmed: never a response body, never a header.
    this.errors = errors.slice(0, 5).map((error) => ({ code: Number(error?.code) || 0, message: `${error?.message || ''}`.slice(0, 200) }))
    if (step) this.step = step
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} options
 * @param {string} options.token      the API token (Tunnel Write on the account, DNS Write on the zone)
 * @param {string} options.accountId
 * @param {string} options.zoneId
 * @param {typeof fetch} options.fetch
 * @param {number} [options.paceMs]   at least this long between two calls (the reconciler's pace)
 */
export function createCloudflare({ token, accountId, zoneId, fetch, sleep = defaultSleep, random = Math.random, timeoutMs = 10_000, attempts = 4, paceMs = 0, now = Date.now, base = API }) {
  if (!token || !accountId || !zoneId) throw new Error('team addresses: the Cloudflare settings need token, accountId and zoneId')
  if (typeof fetch !== 'function') throw new Error('team addresses: a fetch function is required')
  let lastCall = 0

  async function once(method, path, body) {
    if (paceMs) {
      const wait = lastCall + paceMs - now()
      if (wait > 0) await sleep(wait)
      lastCall = now()
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  // → result, or throws CloudflareError. allow404: a 404 answers null (a delete already done).
  async function call(method, path, body, { allow404 = false, label = `${method} ${path.replace(/[0-9a-f]{32}|[0-9a-f-]{36}/g, ':id')}` } = {}) {
    let last
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        const backoff = 500 * 2 ** (attempt - 1)
        const hinted = last?.retryAfter ? Math.min(30_000, last.retryAfter * 1000) : 0
        await sleep(Math.max(backoff, hinted) + Math.floor(random() * 250))
      }
      let res
      try {
        res = await once(method, path, body)
      } catch (error) {
        last = new CloudflareError(`Cloudflare ${label}: ${error?.name === 'AbortError' ? 'timed out' : 'could not be reached'}`, { retryable: true })
        continue
      }
      if (allow404 && res.status === 404) return null
      let json = null
      try {
        json = await res.json()
      } catch {
        json = null
      }
      if (res.ok && json?.success !== false) return { result: json?.result ?? null, info: json?.result_info ?? null }
      const errors = Array.isArray(json?.errors) ? json.errors : []
      const retryable = res.status === 429 || res.status >= 500
      last = new CloudflareError(`Cloudflare ${label}: ${res.status}${errors.length ? ` (${errors.map((e) => e.code).join(', ')})` : ''}`, { status: res.status, retryable, errors })
      const retryAfter = Number(res.headers?.get?.('retry-after'))
      if (Number.isFinite(retryAfter) && retryAfter > 0) last.retryAfter = retryAfter
      if (!retryable) throw last
    }
    throw last
  }

  const acct = `/accounts/${encodeURIComponent(accountId)}`
  const zone = `/zones/${encodeURIComponent(zoneId)}`
  const tunnel = (id) => `${acct}/cfd_tunnel/${encodeURIComponent(id)}`

  // Every page of a list, at most `max` items.
  async function all(path, params, max = 5000) {
    const items = []
    for (let page = 1; items.length < max; page += 1) {
      const query = new URLSearchParams({ ...params, page: String(page), per_page: '100' })
      const { result, info } = await call('GET', `${path}?${query}`)
      const rows = Array.isArray(result) ? result : []
      items.push(...rows)
      const pages = info?.total_pages ?? (rows.length < 100 ? page : page + 1)
      if (!rows.length || page >= pages) break
    }
    return items
  }

  return {
    async findTunnel(name) {
      const { result } = await call('GET', `${acct}/cfd_tunnel?${new URLSearchParams({ name, is_deleted: 'false' })}`)
      return (Array.isArray(result) ? result : []).find((row) => row.name === name) || null
    },
    // → { id, name, token? } (the token Cloudflare includes is handed on, never kept)
    async createTunnel(name) {
      const { result } = await call('POST', `${acct}/cfd_tunnel`, { name, config_src: 'cloudflare' })
      return result
    },
    async getTunnel(id) {
      const found = await call('GET', tunnel(id), undefined, { allow404: true })
      return found ? found.result : null
    },
    listTunnels: () => all(`${acct}/cfd_tunnel`, { is_deleted: 'false' }),
    async listConnections(id) {
      const found = await call('GET', `${tunnel(id)}/connections`, undefined, { allow404: true })
      return Array.isArray(found?.result) ? found.result : []
    },
    async putConfig(id, config) {
      const { result } = await call('PUT', `${tunnel(id)}/configurations`, { config })
      return result
    },
    async getConfig(id) {
      const found = await call('GET', `${tunnel(id)}/configurations`, undefined, { allow404: true })
      return found?.result?.config ?? null
    },
    // The connector token (a string): returned straight to the one install that owns the tunnel.
    async tunnelToken(id) {
      const { result } = await call('GET', `${tunnel(id)}/token`)
      if (typeof result !== 'string' || !result) throw new CloudflareError('Cloudflare gave no connector token', { status: 502 })
      return result
    },
    // A new tunnel secret: every token made with the old one stops working for new connections.
    async rotateSecret(id, secret) {
      const { result } = await call('PATCH', tunnel(id), { tunnel_secret: secret })
      return result
    },
    // → true when deleted, false when it was already gone.
    async deleteConnections(id) {
      return (await call('DELETE', `${tunnel(id)}/connections`, undefined, { allow404: true })) !== null
    },
    async deleteTunnel(id) {
      return (await call('DELETE', tunnel(id), undefined, { allow404: true })) !== null
    },
    async findCname(host) {
      const { result } = await call('GET', `${zone}/dns_records?${new URLSearchParams({ type: 'CNAME', name: host })}`)
      return (Array.isArray(result) ? result : []).find((row) => row.name === host) || null
    },
    async createCname({ name, content, comment }) {
      const { result } = await call('POST', `${zone}/dns_records`, { type: 'CNAME', name, content, proxied: true, ttl: 1, comment })
      return result
    },
    async deleteDns(id) {
      return (await call('DELETE', `${zone}/dns_records/${encodeURIComponent(id)}`, undefined, { allow404: true })) !== null
    },
    listDns: () => all(`${zone}/dns_records`, { type: 'CNAME' }),
    async zoneSetting(id) {
      const { result } = await call('GET', `${zone}/settings/${encodeURIComponent(id)}`)
      return result?.value
    },
  }
}

export const tunnelTarget = (tunnelId) => `${tunnelId}.cfargotunnel.com`
