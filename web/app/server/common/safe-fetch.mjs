// Every fetch the server makes for an address a caller gave it goes through here. Only https,
// only to a public address: the host is resolved, every address it resolves to must be public,
// and the connection is made to that checked address (so a second DNS answer cannot swap it).
// Redirects are followed by hand, a few at most, each checked the same way. The body is capped
// in bytes and the whole request in time.
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'

export const DEFAULT_MAX_BYTES = 15 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15000
const MAX_REDIRECTS = 3

const v4 = (cidr) => {
  const [addr, bits] = cidr.split('/')
  return { net: ipv4ToInt(addr), mask: bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0 }
}
function ipv4ToInt(addr) {
  return addr.split('.').reduce((n, part) => ((n << 8) + Number(part)) >>> 0, 0)
}
const blockedV4 = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
  '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '255.255.255.255/32',
].map(v4)

function expandV6(addr) {
  let a = addr.toLowerCase().split('%')[0]
  if (a.includes('.')) {
    // An embedded IPv4 tail, as in ::ffff:10.0.0.1.
    const i = a.lastIndexOf(':')
    const n = ipv4ToInt(a.slice(i + 1))
    a = `${a.slice(0, i)}:${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = a.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16))
}

export function isPublicAddress(address) {
  const family = net.isIP(address)
  if (family === 4) {
    const n = ipv4ToInt(address)
    return !blockedV4.some(({ net: base, mask }) => ((n & mask) >>> 0) === ((base & mask) >>> 0))
  }
  if (family === 6) {
    const w = expandV6(address)
    if (w.every((x) => x === 0)) return false // ::
    if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return false // ::1
    // IPv4-mapped, IPv4-compatible and NAT64 forms carry an IPv4 address: judge that one.
    const tail = `${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return isPublicAddress(tail)
    if (w[0] === 0x64 && w[1] === 0xff9b) return isPublicAddress(tail)
    if ((w[0] & 0xfe00) === 0xfc00) return false // unique local fc00::/7
    if ((w[0] & 0xffc0) === 0xfe80) return false // link-local fe80::/10
    if ((w[0] & 0xff00) === 0xff00) return false // multicast
    if (w[0] === 0x2001 && w[1] === 0x0db8) return false // documentation
    if (w[0] === 0x2002) return isPublicAddress(`${w[1] >> 8}.${w[1] & 0xff}.${w[2] >> 8}.${w[2] & 0xff}`) // 6to4
    return true
  }
  return false
}

export class FetchRefused extends Error {}

// allowHosts: when set, the only host names this fetch may reach, on the first request and on
// every redirect (an outside service's fixed endpoints, such as a video host's oEmbed).
export function checkUrl(raw, allowHosts) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new FetchRefused('That is not a web address.')
  }
  if (url.protocol !== 'https:') throw new FetchRefused('Only https addresses can be fetched.')
  if (url.username || url.password) throw new FetchRefused('Addresses with credentials cannot be fetched.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new FetchRefused('That address is not public.')
  }
  if (net.isIP(host) && !isPublicAddress(host)) throw new FetchRefused('That address is not public.')
  if (allowHosts && !allowHosts.includes(host.toLowerCase())) throw new FetchRefused('That address is not one this fetch may reach.')
  return url
}

// The lookup the connection uses: every address the name resolves to must be public.
export function publicLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error)
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
      if (!list.length || list.some(({ address }) => !isPublicAddress(address))) {
        return callback(new FetchRefused('That address is not public.'))
      }
      if (options?.all) return callback(null, list)
      return callback(null, list[0].address, list[0].family)
    })
  }
}

function requestOnce(url, { maxBytes, deadline, lookup, accept, userAgent }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return reject(new FetchRefused('The address took too long to answer.'))
    const req = https.request(url, {
      method: 'GET', lookup, timeout: remaining,
      headers: { 'user-agent': userAgent || 'Slatebox image fetch', accept: accept || '*/*' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        return resolve({ redirect: new URL(res.headers.location, url).href })
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new FetchRefused(`The address answered ${res.statusCode}.`))
      }
      const declared = Number(res.headers['content-length'])
      if (declared > maxBytes) {
        res.destroy()
        return reject(new FetchRefused('The file is too large.'))
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          res.destroy()
          reject(new FetchRefused('The file is too large.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new FetchRefused('The address took too long to answer.')))
    req.on('error', reject)
    req.end()
  })
}

export async function safeFetch(raw, { maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS, contentTypes, lookup = publicLookup(), accept, allowHosts, userAgent } = {}) {
  const deadline = Date.now() + timeoutMs
  let url = checkUrl(raw, allowHosts)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const result = await requestOnce(url, { maxBytes, deadline, lookup, accept, userAgent })
    if (result.redirect) {
      url = checkUrl(result.redirect, allowHosts)
      continue
    }
    if (contentTypes && !contentTypes.includes(result.contentType)) {
      throw new FetchRefused(`The address did not answer with an allowed file type (${result.contentType || 'none'}).`)
    }
    return result
  }
  throw new FetchRefused('The address redirected too many times.')
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const fetchPublicImage = (url, opts = {}) => safeFetch(url, { contentTypes: IMAGE_TYPES, accept: 'image/*', ...opts })
