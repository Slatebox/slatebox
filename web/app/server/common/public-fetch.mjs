// A fetch() for a server-to-server call to an address someone else chose (a team's identity
// provider in Slatebox Cloud). Only https, only to a public address: the host is resolved, every
// address it resolves to must be public, and the connection is made to that checked address, so a
// second DNS answer cannot swap it. Redirects are not followed. The body is capped in bytes and the
// request in time. Same rules as safe-fetch.mjs, for any method and with a request body.
import https from 'node:https'
import { checkUrl, publicLookup, FetchRefused } from './safe-fetch.mjs'

const MAX_BYTES = 1024 * 1024
const TIMEOUT_MS = 15000

function headerObject(headers) {
  if (!headers) return {}
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries())
  return { ...headers }
}

export function createPublicFetch({ lookup = publicLookup(), maxBytes = MAX_BYTES, timeoutMs = TIMEOUT_MS, request = https.request } = {}) {
  return function publicFetch(input, init = {}) {
    const url = checkUrl(typeof input === 'string' ? input : (input.href || input.url))
    const method = String(init.method || 'GET').toUpperCase()
    const body = init.body === undefined || init.body === null ? null : Buffer.from(String(init.body))
    const headers = headerObject(init.headers)
    if (body) headers['content-length'] = String(body.length)
    return new Promise((resolve, reject) => {
      const req = request(url, { method, lookup, timeout: timeoutMs, headers, signal: init.signal }, (res) => {
        const declared = Number(res.headers['content-length'])
        if (declared > maxBytes) {
          res.destroy()
          reject(new FetchRefused('The answer is too large.'))
          return
        }
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy()
            reject(new FetchRefused('The answer is too large.'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => {
          const out = new Headers()
          for (const [name, value] of Object.entries(res.headers)) {
            for (const one of Array.isArray(value) ? value : [value]) if (value !== undefined) out.append(name, String(one))
          }
          // A redirect is handed back as is (redirect: 'manual'): the caller decides.
          resolve(new Response(res.statusCode === 204 || res.statusCode === 304 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: out }))
        })
        res.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new FetchRefused('The address took too long to answer.')))
      req.on('error', reject)
      if (body) req.write(body)
      req.end()
    })
  }
}
