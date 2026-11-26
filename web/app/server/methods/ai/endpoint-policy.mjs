// Where the server may send an AI request. The address of an AI connection comes from a person,
// a team admin, an administrator or the operator's settings, and the server connects to it, so:
//   - a cloud metadata address is refused for everyone, everywhere;
//   - on Slatebox Cloud (hosted) every address saved in the app (people's and teams' own AI,
//     administrators) must be a public https address (metering/own-endpoint.mjs has the rule), and
//     the operator's private-endpoints switch does not apply: it is a self-hosted choice;
//   - on a self-hosted server the operator may use any other address, loopback included, and
//     people may use their LAN or the host (host.docker.internal) over http, but never the
//     container itself (loopback) or a link-local address.
// The check runs on the address as typed and again on every address its name resolves to, in
// the lookup the connection itself uses, so a later DNS answer cannot point it elsewhere.
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import { isPublicAddress } from '../../common/safe-fetch.mjs'
import { checkOwnEndpoint, ownEndpointAgent } from '../../metering/own-endpoint.mjs'
import nodeFetch from 'node-fetch'

export class EndpointRefused extends Error {
  constructor(message) {
    super(message)
    this.name = 'EndpointRefused'
  }
}

// Instance metadata services: AWS, GCP, Azure (169.254.169.254), AWS ECS task metadata, AWS IPv6,
// Alibaba Cloud, Oracle Cloud (192.0.0.192), GCP IPv6 (fd20:ce::254) and Azure WireServer
// (168.63.129.16). They hand out the machine's cloud credentials, so no AI request may reach them.
const METADATA_ADDRESSES = new Set(['169.254.169.254', '169.254.170.2', '169.254.170.23', 'fd00:ec2::254', 'fd00:ec2::23', '100.100.100.200',
  '192.0.0.192', 'fd20:ce::254', '168.63.129.16'])
const METADATA_NAMES = /^(metadata|metadata\.google\.internal|metadata\.goog|instance-data|instance-data\.ec2\.internal)$/i

function v6Words(address) {
  let a = address.toLowerCase().split('%')[0]
  if (a.includes('.')) {
    const i = a.lastIndexOf(':')
    const n = a.slice(i + 1).split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0)
    a = `${a.slice(0, i)}:${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = a.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16))
}

const canonicalV6 = (words) => words.map((w) => w.toString(16)).join(':')
const METADATA_V6 = new Set([...METADATA_ADDRESSES].filter((a) => a.includes(':')).map((a) => canonicalV6(v6Words(a))))

// 'metadata' | 'loopback' | 'link-local' | 'private' | 'public' (or null for a non-address)
export function addressKind(address) {
  const family = net.isIP(address)
  if (family === 4) {
    if (METADATA_ADDRESSES.has(address)) return 'metadata'
    if (address.startsWith('127.') || address.startsWith('0.')) return 'loopback'
    if (address.startsWith('169.254.')) return 'link-local'
    return isPublicAddress(address) ? 'public' : 'private'
  }
  if (family === 6) {
    const w = v6Words(address)
    if (METADATA_V6.has(canonicalV6(w))) return 'metadata'
    const v4 = (hi, lo) => addressKind(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`)
    // IPv4-mapped and IPv4-compatible forms carry an IPv4 address: judge that one.
    if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || (w[5] === 0 && (w[6] || w[7] > 1)))) return v4(w[6], w[7])
    // NAT64 (64:ff9b::/96 and the local-use 64:ff9b:1::/48) and 6to4 (2002::/16) reach an IPv4 address too.
    if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return v4(w[6], w[7])
    if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) {
      // a /48 network may carry the address at the /96 position or at the /48 one (RFC 6052)
      const kinds = [v4(w[6], w[7]), v4(w[3], ((w[4] & 0xff) << 8) | (w[5] >> 8))]
      return kinds.includes('metadata') ? 'metadata' : kinds[0]
    }
    if (w[0] === 0x2002) return v4(w[1], w[2])
    if (w.every((x) => x === 0) || (w.slice(0, 7).every((x) => x === 0) && w[7] === 1)) return 'loopback'
    if ((w[0] & 0xffc0) === 0xfe80) return 'link-local'
    return isPublicAddress(address) ? 'public' : 'private'
  }
  return null
}

/**
 * The rules for one level of configuration.
 * level: 'person' | 'team' (a person's or team's own connection), 'server' (an administrator's,
 * saved in the app), 'file' (the operator's settings file or environment).
 */
// privateEndpoints false (the self-host operator's ai.privateEndpoints off) keeps people's and
// teams' connections on public addresses; the operator's own connections are not affected.
export function endpointRules({ hosted, level, privateEndpoints = true }) {
  if (level === 'file') return { hosted, level, publicOnly: false, allow: new Set(['public', 'private', 'loopback', 'link-local']) }
  if (hosted) return { hosted, level, publicOnly: true, allow: new Set(['public']) }
  if (level === 'server') return { hosted, level, publicOnly: false, allow: new Set(['public', 'private', 'loopback', 'link-local']) }
  return { hosted, level, publicOnly: false, allow: new Set(privateEndpoints ? ['public', 'private'] : ['public']) }
}

const REFUSED_PRIVATE_SELFHOST = 'This server\'s operator allows only public addresses for people\'s own AI. Enter the public address of your model.'
const REFUSED = {
  metadata: 'That address is a cloud metadata service. AI requests are never sent there.',
  loopback: 'That address is this server itself. Use your computer\'s address on the network, or host.docker.internal for a model on the host.',
  'link-local': 'That is a link-local address. Use the address of the machine that runs the model.',
  private: 'That address is not public. Enter the public address of your model, starting with https://',
}

function refuseKind(kind, rules) {
  if (!kind || rules.allow.has(kind)) return
  if (kind === 'private' && !rules.hosted && !rules.publicOnly) throw new EndpointRefused(REFUSED_PRIVATE_SELFHOST)
  throw new EndpointRefused(REFUSED[kind] || REFUSED.private)
}

// The base address of an AI connection, as stored: no trailing slash. Throws EndpointRefused.
export function checkEndpointUrl(raw, rules) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) throw new EndpointRefused('Enter the address of your model, for example http://host.docker.internal:11434/v1')
  if (rules.publicOnly) {
    // the hosted rule, kept in one place with the own-key endpoint check
    let checked
    try {
      checked = checkOwnEndpoint(raw.trim())
    } catch (error) {
      throw new EndpointRefused(error.reason || error.message)
    }
    const host = new URL(checked).hostname.replace(/^\[|\]$/g, '')
    if (METADATA_NAMES.test(host)) throw new EndpointRefused(REFUSED.metadata)
    if (net.isIP(host)) refuseKind(addressKind(host), rules)
    return checked
  }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new EndpointRefused('That is not a web address. Enter one like http://host.docker.internal:11434/v1')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new EndpointRefused('The address must start with http:// or https://')
  if (url.username || url.password) throw new EndpointRefused('Put the key in the key field, not in the address.')
  if (url.search || url.hash) throw new EndpointRefused('The address ends at the path, for example /v1, with nothing after it.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (METADATA_NAMES.test(host)) throw new EndpointRefused(REFUSED.metadata)
  if (net.isIP(host)) refuseKind(addressKind(host), rules)
  else if (/^localhost$|\.localhost$/i.test(host)) refuseKind('loopback', rules)
  return url.href.replace(/\/+$/, '')
}

// The lookup every connection to an AI endpoint uses: each address the name resolves to must be
// allowed at this level.
export function guardedLookup(rules, resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error)
      const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
      try {
        if (!list.length) throw new EndpointRefused(REFUSED.private)
        for (const { address } of list) {
          const kind = addressKind(address)
          if (kind === 'metadata') throw new EndpointRefused(REFUSED.metadata)
          refuseKind(kind, rules)
        }
      } catch (refused) {
        return callback(refused)
      }
      if (options?.all) return callback(null, list)
      return callback(null, list[0].address, list[0].family)
    })
  }
}

export async function assertEndpointHost(baseUrl, rules, resolve = dns.lookup) {
  const { hostname } = new URL(checkEndpointUrl(baseUrl, rules))
  const host = hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) return
  await new Promise((ok, fail) => {
    guardedLookup(rules, resolve)(host, { all: true }, (error) => (error ? fail(error instanceof EndpointRefused ? error : new EndpointRefused(`The name ${host} could not be found.`)) : ok()))
  })
}

// The agent for one connection: plain http or https, with the guarded lookup, never kept alive.
export function endpointAgent(baseUrl, rules, resolve = dns.lookup) {
  const Agent = new URL(baseUrl).protocol === 'http:' ? http.Agent : https.Agent
  return new Agent({ lookup: guardedLookup(rules, resolve), keepAlive: false })
}

// The agent for a connection at this level: on hosted Slatebox a person's https endpoint uses the
// own-key agent (public addresses only), as own keys always have.
export function agentFor(baseUrl, rules, resolve) {
  return rules?.publicOnly && !resolve && baseUrl.startsWith('https:') ? ownEndpointAgent() : endpointAgent(baseUrl, rules, resolve)
}

// How much of an answer the server reads from a connection: enough for any chat answer or a
// generated image, never so much that one endpoint can fill the server's memory. Test connection
// reads less (a model list and two short answers).
export const MAX_CONNECTION_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_CHECK_RESPONSE_BYTES = 2 * 1024 * 1024

export class ResponseTooLarge extends Error {
  constructor(maxBytes) {
    super(`The endpoint's answer was too large (over ${Math.round(maxBytes / (1024 * 1024))} MB).`)
    this.name = 'ResponseTooLarge'
  }
}

async function readCapped(body, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of body) {
    total += chunk.length
    if (total > maxBytes) {
      body.destroy?.()
      throw new ResponseTooLarge(maxBytes)
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/**
 * The fetch every request to an AI connection uses: through the agent for its level (the guarded
 * lookup), following no redirect, answering with a standard Response. The AI SDK cannot read a
 * node-fetch response ("Failed to process successful response"), and the requests are not
 * streamed, so the body is read whole, up to maxBytes.
 */
export function connectionFetch(baseUrl, rules, resolve, { maxBytes = MAX_CONNECTION_RESPONSE_BYTES } = {}) {
  const agent = agentFor(baseUrl, rules, resolve)
  return async (url, init = {}) => {
    const response = await nodeFetch(String(url), { ...init, redirect: 'error', agent })
    const declared = Number(response.headers.get('content-length'))
    if (declared > maxBytes) {
      response.body?.destroy?.()
      throw new ResponseTooLarge(maxBytes)
    }
    const empty = [101, 204, 205, 304].includes(response.status)
    const body = empty || !response.body ? null : await readCapped(response.body, maxBytes)
    return new Response(body, { status: response.status, statusText: response.statusText, headers: new Headers([...response.headers]) })
  }
}
