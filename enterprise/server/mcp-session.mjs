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
  constructor(code, message) {
    super(message)
    this.name = 'McpProblem'
    this.code = code
  }
}

// What a person is told, by what went wrong. Never the server's own error text.
export function problemOf(error, host, { signedIn = false } = {}) {
  if (error instanceof McpProblem) return error
  if (error instanceof McpFetchRefused) return new McpProblem(error.code, error.message)
  const cause = error?.cause instanceof McpFetchRefused ? error.cause : null
  if (cause) return new McpProblem(cause.code, cause.message)
  const text = String(error?.message || '')
  const status = Number(error?.status ?? error?.code ?? error?.data?.status)
  if (/insufficient_scope/i.test(text) || (status === 403 && signedIn)) return new McpProblem('needs_more_access', `${host} needs more access to do that. Sign in again to allow it.`)
  if (status === 401 || /\b401\b|Unauthorized|invalid_token/i.test(text)) return new McpProblem('needs_sign_in', `${host} needs you to sign in.`)
  if (/\b404\b|\b405\b|\b406\b|\b415\b|not\s+found|unexpected content type|Unexpected token|JSON/i.test(text))
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
