// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// mcpFetch: the only way Slatebox's MCP client reaches the network. Anyone can type an address,
// so every request is treated as an attempt to reach something it should not:
//   - https only, no user name or password in the address, no "localhost", ".local", ".internal"
//     or cloud metadata names;
//   - the name is resolved here and every address it resolves to must be public (no private,
//     loopback, link-local, CGNAT or metadata address, IPv4-mapped and NAT64 forms included),
//     and the connection goes to the checked address, so a second DNS answer cannot swap it;
//   - redirects are followed by hand, at most 3, and every hop is checked the same way; a hop to
//     another origin drops the Authorization header;
//   - the answer is capped in bytes and the whole request in time;
//   - a real User-Agent is sent (bot walls refuse the default one);
//   - no GET listening stream: Slatebox never keeps a connection open for server pushes.
// The SDK is handed this function as its fetch, so every request it makes (discovery, calls,
// OAuth metadata in S2b) goes through these checks.
//
// devOrigins: exact origins (scheme://host:port) a local development run may reach over plain
// http on this machine, such as a fake MCP server in a test. Ignored on production settings
// (connectorSettings in settings.mjs drops them).
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { Readable } from 'node:stream'
import { isPublicAddress } from '/server/common/safe-fetch.mjs'
import { addressKind } from '/server/methods/ai/endpoint-policy.mjs'

export const MCP_USER_AGENT = 'Slatebox/1.0 (MCP client; +https://slatebox.com/agents)'
export const MCP_FETCH_LIMITS = Object.freeze({ timeoutMs: 20000, maxBytes: 4 * 1024 * 1024, maxRedirects: 3 })

const METADATA_NAMES = /^(metadata|metadata\.google\.internal|metadata\.goog|instance-data|instance-data\.ec2\.internal)$/i

// Plain words a person sees; the remote body is never echoed.
export class McpFetchRefused extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'McpFetchRefused'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new McpFetchRefused(code, message)
}

const PRIVATE = 'Slatebox Cloud can\'t connect to private network addresses.'

export const publicIp = (address) => isPublicAddress(address) && addressKind(address) === 'public'

/** The address checks that need no network. Returns { url, dev } or throws McpFetchRefused. */
export function checkMcpUrl(raw, { devOrigins = [] } = {}) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    refuse('bad_address', 'That is not a web address.')
  }
  if (devOrigins.includes(url.origin)) return { url, dev: true }
  if (url.protocol !== 'https:') refuse('not_https', 'Agent addresses must start with https://')
  if (url.username || url.password) refuse('credentials', 'Leave sign-in details out of the address.')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || METADATA_NAMES.test(host))
    refuse('private_address', PRIVATE)
  if (net.isIP(host) && !publicIp(host)) refuse('private_address', PRIVATE)
  return { url, dev: false }
}

// Every address the name resolves to must be public; the connection uses the checked address.
export function publicOnlyLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(new McpFetchRefused('unreachable', `Couldn't reach ${hostname}. Check the address.`))
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
      if (!list.length || list.some(({ address }) => !publicIp(address))) return callback(new McpFetchRefused('private_address', PRIVATE))
      if (options?.all) return callback(null, list)
      return callback(null, list[0].address, list[0].family)
    })
  }
}

const headersOf = (init) => {
  const out = {}
  const source = init?.headers
  if (!source) return out
  if (typeof source.forEach === 'function' && !Array.isArray(source)) source.forEach((value, key) => { out[key.toLowerCase()] = value })
  else for (const [key, value] of Array.isArray(source) ? source : Object.entries(source)) out[String(key).toLowerCase()] = String(value)
  return out
}

const bodyOf = async (body) => {
  if (body == null) return null
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return Buffer.from(body)
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (typeof body.arrayBuffer === 'function') return Buffer.from(await body.arrayBuffer())
  refuse('bad_request', 'This request could not be sent.')
}

function once(url, { method, headers, body, lookup, dev, deadline, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return reject(new McpFetchRefused('timeout', `${url.host} took too long to answer.`))
    const transport = url.protocol === 'http:' ? http : https
    const req = transport.request(url, {
      method,
      headers: { ...headers, ...(body && { 'content-length': String(body.length) }) },
      timeout: remaining,
      ...(dev ? {} : { lookup }),
      agent: false,
    }, (res) => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        return resolve({ redirect: res.headers.location, status })
      }
      const declared = Number(res.headers['content-length'])
      if (declared > maxBytes) {
        res.destroy()
        return reject(new McpFetchRefused('too_large', `${url.host} sent an answer that is too large.`))
      }
      resolve({ res, status })
    })
    const abort = () => req.destroy(new McpFetchRefused('cancelled', 'The request was cancelled.'))
    signal?.addEventListener?.('abort', abort, { once: true })
    req.on('timeout', () => req.destroy(new McpFetchRefused('timeout', `${url.host} took too long to answer.`)))
    req.on('error', (error) => reject(error instanceof McpFetchRefused ? error : new McpFetchRefused('unreachable', `Couldn't reach ${url.host}. Check the address.`)))
    if (body) req.write(body)
    req.end()
  })
}

// The body as a web stream that errors past maxBytes or the deadline, so an endless event stream
// cannot hold the call open or fill memory.
function cappedStream(res, { maxBytes, deadline, host }) {
  let size = 0
  const timer = setTimeout(() => res.destroy(new McpFetchRefused('timeout', `${host} took too long to answer.`)), Math.max(0, deadline - Date.now()))
  timer.unref?.()
  res.on('data', (chunk) => {
    size += chunk.length
    if (size > maxBytes) res.destroy(new McpFetchRefused('too_large', `${host} sent an answer that is too large.`))
  })
  res.on('close', () => clearTimeout(timer))
  return Readable.toWeb(res)
}

/**
 * Builds the guarded fetch. Options: devOrigins, timeoutMs, maxBytes, maxRedirects, userAgent,
 * resolve (dns.lookup; tests pass their own), onRequest(url) (an audit hook; tests count hops).
 */
export function createMcpFetch({
  devOrigins = [],
  timeoutMs = MCP_FETCH_LIMITS.timeoutMs,
  maxBytes = MCP_FETCH_LIMITS.maxBytes,
  maxRedirects = MCP_FETCH_LIMITS.maxRedirects,
  userAgent = MCP_USER_AGENT,
  resolve = dns.lookup,
  onRequest = () => {},
} = {}) {
  const lookup = publicOnlyLookup(resolve)
  return async function mcpFetch(input, init = {}) {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url
    let method = String(init.method || input?.method || 'GET').toUpperCase()
    // No listening stream (GET) and nothing but the calls the protocol makes.
    if (!['POST', 'DELETE'].includes(method)) return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
    let { url, dev } = checkMcpUrl(raw, { devOrigins })
    const origin = url.origin
    let headers = headersOf(init)
    delete headers.cookie
    delete headers.host
    headers['user-agent'] = userAgent
    let body = await bodyOf(init.body)
    const deadline = Date.now() + timeoutMs
    for (let hop = 0; hop <= maxRedirects; hop++) {
      onRequest(url.href)
      const answer = await once(url, { method, headers, body, lookup, dev, deadline, maxBytes, signal: init.signal })
      if (answer.redirect) {
        let next
        try {
          next = new URL(answer.redirect, url)
        } catch {
          refuse('bad_redirect', `${url.host} redirected to an address that is not valid.`)
        }
        ;({ url, dev } = checkMcpUrl(next.href, { devOrigins }))
        if (url.origin !== origin) delete headers.authorization
        if ([301, 302, 303].includes(answer.status)) {
          // A redirect that turns the call into a GET has nothing left to call.
          return new Response(null, { status: 405, statusText: 'Method Not Allowed' })
        }
        continue
      }
      const { res, status } = answer
      const responseHeaders = new Headers()
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined || key === 'set-cookie') continue
        responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : String(value))
      }
      const empty = [101, 204, 205, 304].includes(status) || method === 'HEAD'
      if (empty) res.resume()
      return new Response(empty ? null : cappedStream(res, { maxBytes, deadline, host: url.host }), { status, headers: responseHeaders })
    }
    refuse('redirects', `${url.host} redirected too many times.`)
  }
}
