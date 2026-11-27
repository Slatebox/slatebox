// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One short MCP session per job: connect (server/discover on 2026-07-28 servers, initialize on
// older ones), do the job, close. Nothing is kept open between calls, so any app process can make
// any call. Every request goes through mcpFetch. A server that needs sign-in gets the token of the
// person asking (from the vault, credentials.mjs) through a minimal auth provider, and that token
// is attached only to requests to the server's own origin (bindToken). The SDK's own OAuth is
// never used: sign-in is Slatebox's (oauth.mjs, signin.mjs), and a 401 here is reported as
// "needs sign-in" for the service to handle.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { bindToken, McpFetchRefused } from './mcp-fetch.mjs'

export const CLIENT_INFO = Object.freeze({ name: 'Slatebox', version: '1.0.0' })
const PASS_THROUGH = Object.freeze({ getValidator: () => (input) => ({ valid: true, data: input, errorMessage: undefined }) })
export const SESSION_LIMITS = Object.freeze({ requestMs: 20000, tools: 64 })

export class McpProblem extends Error {
  // details: safe fields a page may show (settingsUrl, checked by settingsLinkOf). status: the
  // server's HTTP status, for the audit line only.
  constructor(code, message, { details, status } = {}) {
    super(message)
    this.name = 'McpProblem'
    this.code = code
    if (details !== undefined) this.details = details
    if (Number.isInteger(status)) this.status = status
  }
}

// Hosting domains anyone can put a site under: two hosts there are not the same owner.
const SHARED_SITES = new Set(['github.io', 'githubusercontent.com', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'onrender.com', 'fly.dev', 'ngrok.io', 'ngrok-free.app', 'ngrok.app', 'trycloudflare.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com', 'web.app', 'firebaseapp.com', 'glitch.me', 'replit.app', 'repl.co', 'railway.app', 'deno.dev', 'run.app', 'modal.run', 'blogspot.com'])
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu', 'ne', 'or', 'go'])

/** The registrable domain of a host (mcp.slack.com → slack.com; x.co.uk → keeps three), or null for an IP, a single label or a shared host. */
export function siteOf(host) {
  const name = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (!name || name.startsWith('[') || /^[\d.]+$/.test(name) || !/^[a-z0-9.-]+$/.test(name)) return null
  const labels = name.split('.')
  if (labels.length < 2 || labels.some((label) => !label)) return null
  const take = labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2
  const site = labels.slice(-take).join('.')
  return SHARED_SITES.has(site) ? null : site
}

// The JSON-RPC error a server sent with an HTTP refusal ({ code, message }), or null. The SDK keeps
// the body as data.text (and, on a POST, in its message after "endpoint: ").
const rpcErrorIn = (body) => {
  if (typeof body !== 'string' || body.length > 16384) return null
  try {
    const parsed = JSON.parse(body)
    const rpc = parsed?.error
    return parsed?.jsonrpc === '2.0' && rpc && Number.isInteger(rpc.code) && typeof rpc.message === 'string' ? { code: rpc.code, message: rpc.message } : null
  } catch {
    return null
  }
}
export function rpcErrorOf(error) {
  const candidates = [error, error?.data?.cause, error?.cause].filter((candidate) => candidate && typeof candidate === 'object')
  const bodies = candidates.flatMap((candidate) => [candidate.data?.text, String(candidate.message || '').match(/endpoint: (\{[\s\S]*\})\s*$/)?.[1]])
  return bodies.map(rpcErrorIn).find(Boolean) || null
}

/**
 * A settings page the refusing server named, only when it is an https link on the server's own
 * registrable domain (api.slack.com for mcp.slack.com): shown as a link, never as the server's words.
 */
export function settingsLinkOf(message, host) {
  const site = siteOf(host)
  if (!site) return null
  const match = String(message || '').match(/https:\/\/[^\s"'<>()[\]{}`]+/)
  if (!match) return null
  const raw = match[0].replace(/[.,;:!?]+$/, '')
  if (raw.length > 300) return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  if (siteOf(url.hostname) !== site) return null
  return url.href
}

// What a person is told, by what went wrong. Never the server's own error text.
export function problemOf(error, host, { signedIn = false } = {}) {
  if (error instanceof McpProblem) return error
  if (error instanceof McpFetchRefused) return new McpProblem(error.code, error.message)
  const cause = error?.cause instanceof McpFetchRefused ? error.cause : null
  if (cause) return new McpProblem(cause.code, cause.message)
  const text = String(error?.message || '')
  const status = Number(error?.status ?? error?.code ?? error?.data?.status)
  if (/insufficient[_ ]scope/i.test(text) || error?.name === 'InsufficientScopeError') return new McpProblem('needs_more_access', `${host} needs more access to do that. Sign in again to allow it.`)
  if (status === 401 || /\b401\b|Unauthorized|invalid_token/i.test(text)) return new McpProblem('needs_sign_in', `${host} needs you to sign in.`)
  // An MCP server that answered, in JSON-RPC, that it will not take this app (Slack's "App is not
  // enabled for Slack MCP server access"): its words are not shown, only a link to its settings on
  // its own domain when it named one.
  const rpc = status === 400 || status === 403 ? rpcErrorOf(error) : null
  if (rpc) {
    const settingsUrl = settingsLinkOf(rpc.message, host)
    return new McpProblem('app_refused', `${host} refused this connection. Its owner may need to allow this app.`, { status, ...(settingsUrl && { details: { settingsUrl } }) })
  }
  if (status === 403 && signedIn) return new McpProblem('needs_more_access', `${host} needs more access to do that. Sign in again to allow it.`)
  // Not an MCP server: no such path, or a reply that is not MCP at all (a web page, broken JSON).
  // A JSON-RPC error is an MCP server answering, so the word "JSON" alone is not a sign.
  if ([404, 405, 406, 415].includes(status) || /\b404\b|\b405\b|\b406\b|\b415\b|not\s+found|unexpected content type|Unexpected token|unusable reply|in JSON at position|is not valid JSON|JSON\.parse|Unexpected end of JSON/i.test(text))
    return new McpProblem('not_mcp', `That address didn't answer like an MCP server. Is there a /mcp path?`)
  if (status === 403 || status === 429 || /\b1010\b|\b429\b|blocked|forbidden/i.test(text)) return new McpProblem('blocked', `${host} blocked the connection.`)
  if (/timed? ?out|timeout/i.test(text)) return new McpProblem('timeout', `${host} took too long to answer.`)
  return new McpProblem('unreachable', `Couldn't reach ${host}. Check the address.`)
}

/** Runs fn(client) inside one session. */
export async function withSession(address, fetch, fn, { requestMs = SESSION_LIMITS.requestMs, token = null } = {}) {
  const url = new URL(address)
  const client = new Client(CLIENT_INFO, {
    versionNegotiation: { mode: 'auto', probe: { timeoutMs: requestMs } },
    // No sampling, no roots: Slatebox's model decides, and a server's questions wait for S3.
    capabilities: {},
    // Structured answers are checked by quarantine() (results.mjs), which drops a mismatch and
    // keeps the text, rather than failing the whole call here.
    jsonSchemaValidator: PASS_THROUGH,
  })
  const transport = new StreamableHTTPClientTransport(url, {
    fetch: token ? bindToken(fetch, url.origin) : fetch,
    redirectPolicy: 'same-origin',
    ...(token && { authProvider: { token: async () => token } }),
  })
  try {
    await client.connect(transport, { timeout: requestMs })
  } catch (error) {
    await client.close().catch(() => {})
    throw problemOf(error, url.host, { signedIn: Boolean(token) })
  }
  try {
    return await fn(client)
  } catch (error) {
    throw problemOf(error, url.host, { signedIn: Boolean(token) })
  } finally {
    await client.close().catch(() => {})
  }
}

/** Every tool the server lists, page by page, up to the limit. */
export async function listAllTools(client, { requestMs = SESSION_LIMITS.requestMs, max = SESSION_LIMITS.tools } = {}) {
  const tools = []
  let cursor
  for (let page = 0; page < 8; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: requestMs, cache: 'bypass' })
    tools.push(...(result.tools || []))
    cursor = result.nextCursor
    if (!cursor || tools.length >= max) break
  }
  return tools.slice(0, max)
}

/** Discovery: who the server says it is, and its tools. */
export async function discover(address, fetch, options = {}) {
  return withSession(address, fetch, async (client) => {
    const tools = await listAllTools(client, options)
    return {
      serverInfo: client.getServerVersion?.() || null,
      instructions: client.getInstructions?.() || '',
      era: client.getNegotiatedEra?.() || null,
      tools,
    }
  }, options)
}

/** One tool call. Listing first: the definition called must be the one approved (hash checked by the caller). */
export async function callTool(address, fetch, { name, args, check }, options = {}) {
  return withSession(address, fetch, async (client) => {
    const tools = await listAllTools(client, options)
    if (check) check(tools)
    return client.callTool({ name, arguments: args || {} }, { timeout: options.requestMs || SESSION_LIMITS.requestMs })
  }, options)
}
