// Proof that a free trial's host is really the asking install's (owner review, 2026-11-25). A trial
// key is bound to one host name and each public host gets one trial, so Cloud must never take a
// stranger's word for the host: otherwise any free account could ask for 'acme.com' and use up
// acme.com's trial. MIT, runs without Meteor (scripts/license-issuer.test.mjs).
//
//   1. The self-hosted server makes a one-time proof { id, secret } (createProofStore, kept in
//      memory for ten minutes) and sends it with its ask (POST /licenses/key { host, proof }).
//   2. While answering, Cloud fetches https://<host>/.well-known/slatebox-license-proof/<id> and
//      takes the trial only if that host answers the same secret (createHostProver). Only the
//      install that made the proof can answer it at its own address.
//   3. Nothing about a host is recorded (no per-host refusal, no trial row) before it is proven.
//
// Cloud's fetch never reaches a private address (loopback, private ranges, link-local, CGNAT,
// unique-local, multicast), checked on the address it actually connects to (DNS rebinding), never
// follows a redirect, reads at most 1 KiB and gives up after five seconds.
import { lookup as dnsLookup } from 'node:dns'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import https from 'node:https'
import { isIP } from 'node:net'

export const PROOF_PATH = '/.well-known/slatebox-license-proof/'
const PROOF_TTL = 10 * 60_000
const ID = /^[A-Za-z0-9_-]{16,64}$/
const SECRET = /^[A-Za-z0-9_-]{32,128}$/

/** A proof as sent by an install, or null when it is not one. */
export function cleanProof(value) {
  if (!value || typeof value !== 'object') return null
  const { id, secret } = value
  return typeof id === 'string' && ID.test(id) && typeof secret === 'string' && SECRET.test(secret) ? { id, secret } : null
}

/** The self-hosted side: one-time proofs, answered at PROOF_PATH<id> for ten minutes. */
export function createProofStore({ now = Date.now, max = 50 } = {}) {
  const proofs = new Map()
  const sweep = () => {
    for (const [id, row] of proofs) if (row.until <= now()) proofs.delete(id)
  }
  const store = {
    make() {
      sweep()
      while (proofs.size >= max) proofs.delete(proofs.keys().next().value)
      const proof = { id: randomBytes(16).toString('base64url'), secret: randomBytes(32).toString('base64url') }
      proofs.set(proof.id, { secret: proof.secret, until: now() + PROOF_TTL })
      return proof
    },
    answer(id) {
      sweep()
      return (typeof id === 'string' && proofs.get(id)?.secret) || null
    },
    forget(id) {
      proofs.delete(id)
    },
    /** An Express/Connect handler for GET PROOF_PATH:id. */
    handler() {
      return (req, res) => {
        const id = String(req.params?.id ?? (req.url || '').split('?')[0].split('/').pop())
        const secret = store.answer(id)
        res.statusCode = secret ? 200 : 404
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(secret || 'No such proof.')
      }
    },
  }
  return store
}

const v4 = (ip) => ip.split('.').map(Number)
/** Whether an address is one Cloud must never fetch from (not on the public internet). */
export function privateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = v4(ip)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (isIP(ip) === 6) {
    const low = ip.toLowerCase()
    if (low === '::' || low === '::1') return true
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return privateAddress(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(low)
  }
  return true
}

// dns.lookup that refuses private addresses: used for the connection itself, so a name that
// answers a public address to a first lookup and a private one to the next gains nothing.
function publicLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }]
    const bad = list.find((entry) => privateAddress(entry.address))
    if (!list.length || bad) return callback(Object.assign(new Error(`${hostname} is not a public address`), { code: 'EPRIVATE' }))
    if (options?.all) return callback(null, list)
    return callback(null, list[0].address, list[0].family)
  })
}

/** GET a short text answer over https from a public address only. Resolves { status, text }. */
export function publicGet(url, { timeoutMs = 5000, limit = 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup: publicLookup, timeout: timeoutMs, headers: { accept: 'text/plain', 'user-agent': 'slatebox-cloud (license host check)' } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        text += chunk
        if (text.length > limit) req.destroy(Object.assign(new Error('answer too long'), { code: 'ETOOLONG' }))
      })
      res.on('end', () => resolve({ status: res.statusCode || 0, text }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })))
    req.on('error', reject)
  })
}

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Cloud's side: whether `host` answers the proof.
 * @param {{ get?: (url: string) => Promise<{ status: number, text: string }>, originFor?: (host: string) => string }} [options]
 *   get: publicGet by default (https, public addresses only); originFor: https://<host> by default.
 * @returns {{ prove: (host: string, proof: unknown) => Promise<{ ok: true } | { ok: false, why: 'no_proof'|'unreachable'|'mismatch' }> }}
 */
export function createHostProver({ get = publicGet, originFor = (host) => `https://${host}` } = {}) {
  return {
    async prove(host, given) {
      const proof = cleanProof(given)
      if (!proof) return { ok: false, why: 'no_proof' }
      let answer
      try {
        answer = await get(`${originFor(host)}${PROOF_PATH}${proof.id}`)
      } catch {
        return { ok: false, why: 'unreachable' }
      }
      if (answer?.status !== 200) return { ok: false, why: answer?.status ? 'mismatch' : 'unreachable' }
      return same(String(answer.text || '').trim(), proof.secret) ? { ok: true } : { ok: false, why: 'mismatch' }
    },
  }
}
