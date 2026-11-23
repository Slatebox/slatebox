// A person's own OpenAI-compatible endpoint. The server sends their briefs there, so the
// address must be public: https only, no private, loopback, link-local or cluster names, and
// a name that resolves to a private address is refused when the key is saved and again on
// every connection (the agent's lookup), so a later DNS answer cannot point it inside.
// A self-hosted operator's own endpoint (workshop-provider.mjs) is not limited by this.
import https from 'node:https'
import dns from 'node:dns'
import { checkUrl, publicLookup } from '../common/safe-fetch.mjs'

export const ENDPOINT_MESSAGE = 'Enter the public address of your model, starting with https://'

const invalid = (message = ENDPOINT_MESSAGE) => Object.assign(new Error(message), { error: 'invalid-key', reason: message })

export function checkOwnEndpoint(baseUrl) {
  let url
  try {
    url = checkUrl(baseUrl)
  } catch {
    throw invalid()
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  // single-label names (redis, mongo) and cluster suffixes only resolve inside a network
  if (!host.includes('.') || /\.(svc|cluster\.local|lan|home|corp|intranet)$/i.test(host)) throw invalid()
  if (url.search || url.hash) throw invalid()
  return url.href.replace(/\/+$/, '')
}

export async function assertPublicHost(baseUrl, resolve = dns.lookup) {
  const { hostname } = new URL(checkOwnEndpoint(baseUrl))
  const lookup = publicLookup(resolve)
  await new Promise((ok, fail) => {
    lookup(hostname.replace(/^\[|\]$/g, ''), { all: true }, error => (error ? fail(invalid()) : ok()))
  })
}

// The agent every request to a person's endpoint uses.
export function ownEndpointAgent(lookup = publicLookup()) {
  return new https.Agent({ lookup, keepAlive: false })
}
