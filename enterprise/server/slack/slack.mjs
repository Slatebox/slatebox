// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slack as a native integration on Slack's Web API (owner, 2026-11-27: "if web api is the expected
// integration, then let's pivot to that instead of MCP"). Slack lets only Marketplace-listed or
// internal apps use its MCP server, and the Marketplace asks for 10 active workspaces first; an
// unlisted app that anyone may install uses the Web API. Without Meteor: the vault, the stores, the
// network and the app's suggestion path are passed in (enterprise/server/meteor.js).
//
// Connect is one click: Connect, Allow on Slack, done. Slack's OAuth v2 (signin.mjs startNative, the
// same single-use state, binding cookie and callback as every sign-in) gives a user token (the
// person's own reads and writes: only what they can see in Slack) and a bot token (one per
// workspace: link previews, the Send to slate shortcut, /slatebox). Both are sealed: the user token
// in the vault (credentials.mjs, address slack://workspace), the bot token in slackWorkspaces. A
// grant missing a scope, or with more than Slatebox asked for, is refused and revoked.
//
// The agent on a slate (slackSession: the same shape as mcp-session.mjs, so the connector service
// asks it like any agent): fixed tools, so consent and their hashes never move. Lookups run with the
// person's token; changes (post_message, add_reaction) are only proposed during an ask and always
// wait on an approval card (the card's alwaysAsk). Slack limits an unlisted app's
// conversations.history and conversations.replies to one request a minute and 15 messages: a gate
// shared by every server process (slackReadGates, claimed atomically per workspace and method)
// says so in plain words instead of calling Slack; search.messages is not limited, so asks search
// first. Nothing Slack sends is stored beyond the answer's suggestions (7 days unless kept); a
// channel's name → id is kept in memory for 10 minutes, never a message.
import { randomBytes } from 'node:crypto'
import { open, seal } from '/server/metering/vault.mjs'
import { SignInProblem } from '../oauth.mjs'
import { McpProblem } from '../mcp-session.mjs'
import { normalizeTools, plainText } from '../tools.mjs'
import { safeLink } from '../results.mjs'
import { NATIVE_ADDRESSES, NATIVE_CARDS } from '../../common/gallery.mjs'
import { SLACK_BOT_SCOPES, SLACK_CALLBACKS, SLACK_USER_SCOPES } from './manifest.mjs'
import { openMetadata, signMetadata } from './verify.mjs'

export const SLACK_ADDRESS = NATIVE_ADDRESSES.slack
export const SLACK_HOST = 'slack.com'
export const SLACK_ISSUER = 'https://slack.com'
// Where Slack was an MCP server before (people who connected it there move in place on Connect).
export const SLACK_MCP_ADDRESS = 'https://mcp.slack.com/mcp'
export const SLACK_LIMITS = Object.freeze({ objects: 15, searchDefault: 10, channels: 200, channelPages: 5, users: 15, cacheMs: 10 * 60000, cacheSize: 2000, textChars: 4000, pendingMs: 10 * 60000, slates: 100, found: 5 })
export const SLACK_CARD = NATIVE_CARDS.find((card) => card.id === 'slack')

const TS = '^[0-9]{9,11}\\.[0-9]{6}$'
const CHANNEL = { type: 'string', minLength: 1, maxLength: 81, description: 'The channel: its name (#launch or launch) or its id (C0123ABCD).' }
const LIMIT = { type: 'integer', minimum: 1, maximum: SLACK_LIMITS.objects, description: `How many messages, at most ${SLACK_LIMITS.objects}.` }

/** The Slack agent's fixed tools: four lookups and two changes (each change waits on a card). */
export const SLACK_TOOLS = Object.freeze([
  {
    name: 'search_messages', title: 'Search Slack messages',
    description: 'Searches the Slack messages you can see for a few plain words. channel narrows it to one channel; after (yyyy-mm-dd) to messages since that day. Returns each message\'s author, channel, text and link.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 }, channel: CHANNEL, after: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' }, limit: LIMIT }, required: ['query'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_channels', title: 'List your Slack channels',
    description: 'Lists the Slack channels you are in, by name. query keeps the ones whose name has those letters.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 80 } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_channel', title: 'Read a Slack channel',
    description: 'Reads the latest messages in one Slack channel you can see. Slack allows this once a minute; search_messages has no such limit.',
    inputSchema: { type: 'object', properties: { channel: CHANNEL, limit: LIMIT }, required: ['channel'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'read_thread', title: 'Read a Slack thread',
    description: 'Reads one Slack thread: by the link to a message in it (permalink), or by its channel and its first message\'s ts. Slack allows this once a minute.',
    inputSchema: { type: 'object', properties: { permalink: { type: 'string', maxLength: 300 }, channel: CHANNEL, ts: { type: 'string', pattern: TS }, limit: LIMIT }, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'post_message', title: 'Post in Slack',
    description: 'Posts a message as you in a Slack channel, or replies in a thread (thread_ts). It waits on a card until you approve it.',
    inputSchema: { type: 'object', properties: { channel: CHANNEL, text: { type: 'string', minLength: 1, maxLength: SLACK_LIMITS.textChars }, thread_ts: { type: 'string', pattern: TS } }, required: ['channel', 'text'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'add_reaction', title: 'React in Slack',
    description: 'Adds an emoji reaction as you to one Slack message (its channel and its ts). It waits on a card until you approve it.',
    inputSchema: { type: 'object', properties: { channel: CHANNEL, timestamp: { type: 'string', pattern: TS }, name: { type: 'string', pattern: '^:?[a-z0-9_+\'-]{1,100}:?$', description: 'The emoji\'s name, such as thumbsup.' } }, required: ['channel', 'timestamp', 'name'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
])

/** The tools as consented to when Slack is connected: all allowed (every change still waits on a card). */
export const slackConsent = () => normalizeTools(SLACK_TOOLS, SLACK_CARD.recipe.tools).map(({ name, title, description, group, hash, destructive }) => ({ name, title, description, group, hash, policy: 'allow', ...(destructive && { destructive: true }) }))

/**
 * settings.connectors.slack (server-only), all optional:
 *   historyPerMinute  reads of a channel or thread a workspace may make a minute (default 1: Slack's
 *                     limit for an unlisted app)
 *   historyLimit      messages per read (default 15, Slack's limit for an unlisted app)
 *   listed            true once Slatebox is listed in the Slack Marketplace, or for a self-hosted
 *                     install's own internal app: the once-a-minute gate is lifted (Slack's own
 *                     Tier 3 limits apply, and a 429 is still honored)
 *   apiBase           a fake Slack (http://127.0.0.1:port), on a development server only
 */
export function slackSettings(settings = {}, { development = false } = {}) {
  const raw = settings.connectors?.slack || {}
  const base = development && typeof raw.apiBase === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(raw.apiBase) ? raw.apiBase.replace(/\/+$/, '') : null
  const listed = raw.listed === true
  const perMinute = Number.isInteger(raw.historyPerMinute) && raw.historyPerMinute > 0 ? Math.min(raw.historyPerMinute, 60) : 1
  const limit = Number.isInteger(raw.historyLimit) && raw.historyLimit > 0 ? Math.min(raw.historyLimit, listed ? 100 : SLACK_LIMITS.objects) : SLACK_LIMITS.objects
  return { apiBase: base || 'https://slack.com', devOrigins: base ? [base] : [], historyPerMinute: perMinute, historyLimit: limit, listed }
}

/** The guarded fetch, limited to Slack's own hosts (and a development fake): no other address is reached with a Slack token. */
export function slackOnlyFetch(fetch, { devOrigins = [] } = {}) {
  return (input, init) => {
    let url
    try {
      url = new URL(String(input))
    } catch {
      throw new McpProblem('blocked', 'That is not a Slack address.')
    }
    const slack = url.protocol === 'https:' && (url.hostname === SLACK_HOST || url.hostname.endsWith('.' + SLACK_HOST))
    if (!slack && !devOrigins.includes(url.origin)) throw new McpProblem('blocked', 'That is not a Slack address.')
    return fetch(url.href, init)
  }
}

export class SlackRefused extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
const refuse = (status, code, message) => {
  throw new SlackRefused(status, code, message)
}
class SlackApiError extends Error {
  constructor(slack, { retryAfter = null } = {}) {
    super(`Slack answered ${slack}`)
    this.slack = slack
    if (retryAfter) this.retryAfter = retryAfter
  }
}
const failSignIn = (code, message) => {
  throw new SignInProblem(code, message)
}

const ID = /^[A-Z0-9]{2,24}$/
const TOKEN = /^[\x21-\x7e]{8,512}$/
const splitScopes = (raw) => (typeof raw === 'string' ? raw.split(/[,\s]+/).filter(Boolean) : [])
const words = (n, one, many) => `${n} ${n === 1 ? one : many}`
const escapeSlack = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const isError = (text) => ({ isError: true, content: [{ type: 'text', text }] })

// Slack's message markup as plain words: <@U1> a person, <#C1|launch> a channel, <url|label> a link.
function plainMessage(text, names) {
  return String(text || '')
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, (_, id) => '@' + (names.get(id) || 'someone'))
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, (_, name) => '#' + name)
    .replace(/<#[A-Z0-9]+>/g, '#channel')
    .replace(/<!(here|channel|everyone)[^>]*>/g, (_, who) => '@' + who)
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, (_, name) => name)
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url, label) => `${label} (${url})`)
    .replace(/<(https?:\/\/[^>]+)>/g, (_, url) => url)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/** A Slack message link as { channel, ts, threadTs } (a reply's link names its thread), or null. */
export function parsePermalink(raw) {
  const link = safeLink(raw)
  if (!link || !(link.host === SLACK_HOST || link.host.endsWith('.' + SLACK_HOST))) return null
  const url = new URL(link.url)
  const match = /^\/archives\/([A-Z0-9]{6,24})\/p(\d{9,11})(\d{6})$/.exec(url.pathname)
  if (!match) return null
  const thread = url.searchParams.get('thread_ts')
  return { channel: match[1], ts: `${match[2]}.${match[3]}`, threadTs: thread && new RegExp(TS).test(thread) ? thread : null }
}

/**
 * vault, integrations, connections (stores), workspaces { get(id), put(doc), find(query), remove(id) },
 * gates { claim(id, at, until) -> bool, get(id), hold(id, until) }, signIn (signin.mjs), fetch
 * (slackOnlyFetch over the guarded fetch), config() (slackSettings), apps() (the integration apps:
 * apps.slack { clientId, clientSecret, signingSecret }), origin(), enabled() (the card is on), master
 * (the vault's master key, for the bot tokens), access { forUser }, editableSlates(userId, { query,
 * limit }) -> [{ shareId, name }], publicPreview(kind, id) -> { title, description, imageUrl } | null
 * (only for a public slate or a published presentation), applyOperations, presence, itemsFromLayout,
 * onConnected(integration), moveNative(old, set) -> integration (an MCP Slack integration moved in
 * place), audit, now.
 */
export function createSlackService({
  vault, integrations, connections = null, workspaces, gates, signIn, fetch, config, apps, origin, enabled = async () => true, master,
  access, editableSlates = async () => [], publicPreview = async () => null, applyOperations, presence = { end: async () => {} }, itemsFromLayout,
  onConnected = async () => {}, moveNative = null, audit = () => {}, now = Date.now, random = randomBytes,
}) {
  const cfg = () => config()
  const api = (method) => `${cfg().apiBase}/api/${method}`
  const appOf = async () => (await apps())?.slack || null
  const botOwner = (teamId) => ({ ownerType: 'slack', ownerId: teamId, provider: 'bot' })
  const integrationOf = (userId) => integrations.findOne({ ownerId: userId, address: SLACK_ADDRESS })

  /** Whether Slack works on this server: its card on, its app (client id and secret), the vault key. */
  async function usable() {
    const app = await appOf()
    return Boolean((await enabled()) && app?.clientId && app?.clientSecret && vault?.available?.())
  }

  // One Web API call. Slack answers 200 with { ok: false, error } when it refuses: ok is what counts.
  async function call(token, method, params = {}) {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    let response
    try {
      response = await fetch(api(method), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() })
    } catch (error) {
      if (error instanceof McpProblem) throw error
      throw new SlackApiError('unreachable')
    }
    if (response.status === 429) {
      const seconds = Math.min(3600, Math.max(1, Number.parseInt(response.headers?.get?.('retry-after') || '', 10) || 60))
      await response.body?.cancel?.().catch(() => {})
      throw new SlackApiError('ratelimited', { retryAfter: seconds })
    }
    const json = await response.json().catch(() => null)
    if (!json || typeof json !== 'object') throw new SlackApiError('bad_answer')
    if (json.ok !== true) throw new SlackApiError(typeof json.error === 'string' ? json.error.slice(0, 60) : 'failed')
    return json
  }

  // ---------- connecting ----------

  async function requirePerson(principal) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor') refuse(401, 'sign_in', 'Save your account to connect Slack.')
  }

  /** Whether Slack works here and for this person: never a token. */
  async function status(principal) {
    await requirePerson(principal)
    const app = await appOf()
    const row = await integrationOf(principal.userId)
    return {
      enabled: await enabled(),
      configured: Boolean(app?.clientId && app?.clientSecret && vault?.available?.()),
      connected: Boolean(row && row.status === 'active'),
      scopes: [...SLACK_USER_SCOPES],
      ...(row && { integrationId: row._id, status: row.status, workspace: row.account?.teamName || null }),
    }
  }

  /** Connect: a sign-in flow on Slack's own page (one click: Allow). → { flowId, authHost } for the popup. */
  async function connect(principal) {
    await requirePerson(principal)
    if (!(await enabled())) refuse(403, 'disabled', 'Slack integration is turned off on this server.')
    const app = await appOf()
    if (!app?.clientId || !app?.clientSecret) refuse(422, 'not_configured', 'Slack is not set up on this server yet.')
    if (!vault?.available?.()) refuse(422, 'vault_off', 'Slack needs the server\'s key-encryption key, which is not set.')
    try {
      return await signIn.startNative({
        userId: principal.userId,
        kind: 'slack',
        issuer: SLACK_ISSUER,
        authorize: (state, redirectUri) => `${cfg().apiBase}/oauth/v2/authorize?${new URLSearchParams({ client_id: app.clientId, scope: SLACK_BOT_SCOPES.join(','), user_scope: SLACK_USER_SCOPES.join(','), redirect_uri: redirectUri, state })}`,
      })
    } catch (error) {
      if (error instanceof SignInProblem) refuse(422, error.code, error.message)
      throw error
    }
  }

  async function revokeQuietly(token) {
    if (!token) return
    await call(token, 'auth.revoke').catch(() => {})
  }

  /**
   * The sign-in callback's code (signin.mjs finish, for flows of kind 'slack'): exchanged at
   * oauth.v2.access, checked (Slack's ok, both tokens, exactly the scopes asked for), sealed, and the
   * person's Slack integration made or renewed. Throws SignInProblem with plain words.
   */
  async function finishInstall(flow, code) {
    const app = await appOf()
    if (!app?.clientId || !app?.clientSecret) failSignIn('not_configured', 'Slack is not set up on this server yet.')
    let json = null
    try {
      const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: flow.redirectUri })
      const response = await fetch(api('oauth.v2.access'), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString() })
      json = await response.json().catch(() => null)
    } catch {
      failSignIn('token_failed', 'Couldn\'t reach Slack. Try again in a minute.')
    }
    // Slack answers HTTP 200 when it refuses: only ok: true is a sign-in.
    if (!json || json.ok !== true) failSignIn('token_failed', 'Slack didn\'t finish the sign-in. Try again.')
    const user = json.authed_user && typeof json.authed_user === 'object' ? json.authed_user : {}
    const userToken = typeof user.access_token === 'string' && TOKEN.test(user.access_token) && (!user.token_type || user.token_type === 'user') ? user.access_token : null
    const botToken = json.token_type === 'bot' && typeof json.access_token === 'string' && TOKEN.test(json.access_token) ? json.access_token : null
    const teamId = typeof json.team?.id === 'string' && ID.test(json.team.id) ? json.team.id : null
    const enterpriseId = typeof json.enterprise?.id === 'string' && ID.test(json.enterprise.id) ? json.enterprise.id : null
    const slackUserId = typeof user.id === 'string' && ID.test(user.id) ? user.id : null
    const revokeBoth = () => Promise.all([revokeQuietly(userToken), revokeQuietly(botToken)])
    if (!userToken || !botToken || !teamId || !slackUserId) {
      await revokeBoth()
      failSignIn('token_failed', 'Slack didn\'t finish the sign-in. Try again.')
    }
    const userScopes = splitScopes(user.scope)
    const botScopes = splitScopes(json.scope)
    const missing = [...SLACK_USER_SCOPES.filter((s) => !userScopes.includes(s)), ...SLACK_BOT_SCOPES.filter((s) => !botScopes.includes(s))]
    const extra = [...userScopes.filter((s) => !SLACK_USER_SCOPES.includes(s)), ...botScopes.filter((s) => !SLACK_BOT_SCOPES.includes(s))]
    if (missing.length) {
      await revokeBoth()
      failSignIn('scope_missing', 'Slack didn\'t allow everything Slatebox asks for. Connect again and allow it.')
    }
    // More than Slatebox asked for (only possible with a misconfigured app): refused and revoked.
    if (extra.length) {
      await revokeBoth()
      failSignIn('scope_wrong', 'Slack granted more access than Slatebox asks for, so Slatebox did not keep it.')
    }
    // The workspace's address, for links back to its messages (auth.test needs no scope).
    const who = await call(userToken, 'auth.test').catch(() => null)
    const site = safeLink(who?.url)
    const url = site && site.host.endsWith('.' + SLACK_HOST) ? site.url.replace(/\/?$/, '/') : null
    const teamName = plainText(json.team?.name || who?.team || 'Slack', 80)
    await vault.save({
      userId: flow.userId,
      address: SLACK_ADDRESS,
      resource: null,
      issuer: SLACK_ISSUER,
      kind: 'oauth',
      registration: { kind: 'preregistered', provider: 'slack', clientId: app.clientId },
      server: { issuer: SLACK_ISSUER, tokenEndpoint: api('oauth.v2.access'), revocationEndpoint: api('auth.revoke'), revocation: 'slack' },
      tokens: { accessToken: userToken, scopes: userScopes },
    })
    const at = new Date(now())
    // One bot token per workspace: each install overwrites it (the newest wins).
    await workspaces.put({
      _id: (enterpriseId ? enterpriseId + ':' : '') + teamId, teamId, enterpriseId, teamName, appId: typeof json.app_id === 'string' ? json.app_id.slice(0, 30) : null,
      botUserId: typeof json.bot_user_id === 'string' && ID.test(json.bot_user_id) ? json.bot_user_id : null,
      botToken: seal({ master, owner: botOwner(teamId), plaintext: botToken }), botScopes, installedBy: flow.userId, installedAt: at, updatedAt: at,
    })
    const set = {
      kind: 'slack', address: SLACK_ADDRESS, host: SLACK_HOST, galleryId: 'slack', serverName: 'Slack', tools: slackConsent(), auth: { kind: 'oauth', issuer: SLACK_ISSUER },
      scopes: userScopes, account: { teamId, teamName, slackUserId, enterpriseId, url }, slackTeamId: teamId, slackUserId, status: 'active', statusNote: null, changed: null, updatedAt: at,
    }
    // One Slack workspace per person: connecting another replaces the first.
    const row = await integrationOf(flow.userId)
    // Connected before as Slack's MCP server: moved in place (its name, colour and slates stay).
    const old = !row && moveNative ? await integrations.findOne({ ownerId: flow.userId, address: SLACK_MCP_ADDRESS }) : null
    if (row) await integrations.update(row._id, set)
    else if (old) await moveNative(old, set)
    else {
      await integrations.insert({
        _id: 'i' + random(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x'), ownerType: 'user', ownerId: flow.userId, name: 'Slack', defaultContextLevel: 'request', rule: 'ask',
        colorIndex: 5, createdAt: at, lastUsedAt: null, ...set,
      })
    }
    // Connecting again is consenting again: the Slack agent resumes on every slate it is on.
    await onConnected(await integrationOf(flow.userId)).catch(() => {})
    audit({ kind: 'slack_connect', userId: flow.userId, scopes: userScopes.length })
    return { host: 'Slack' }
  }

  // ---------- the agent's tools ----------

  // Reading a channel or a thread: once a minute per workspace while Slatebox is unlisted, shared by
  // every server process (claimed atomically), and Slack's own 429 sets the next time.
  const throttled = (seconds) => new McpProblem('rate_limited',
    `Slack lets Slatebox read a channel or thread only once a minute until Slatebox is listed in the Slack Marketplace. Try again in ${words(seconds, 'second', 'seconds')}, or ask a question and Slatebox will search Slack instead.`,
    { details: { retryAfter: seconds } })
  async function gated(teamId, method, fn) {
    const id = `${teamId}:${method}`
    if (!cfg().listed) {
      const at = now()
      const claimed = await gates.claim(id, new Date(at), new Date(at + Math.ceil(60000 / cfg().historyPerMinute)))
      if (!claimed) {
        const row = await gates.get(id).catch(() => null)
        throw throttled(Math.max(1, Math.ceil(((row?.nextAt ? new Date(row.nextAt).getTime() : at + 60000) - at) / 1000)))
      }
    }
    try {
      return await fn()
    } catch (error) {
      if (error?.slack === 'ratelimited') {
        await gates.hold(id, new Date(now() + error.retryAfter * 1000)).catch(() => {})
        throw throttled(error.retryAfter)
      }
      throw error
    }
  }

  // A channel's name → id, per workspace, kept in memory for a while (names only, never a message).
  const channels = new Map()
  const remember = (teamId, list) => {
    for (const channel of list) {
      if (typeof channel?.id !== 'string' || typeof channel.name !== 'string') continue
      if (channels.size >= SLACK_LIMITS.cacheSize) channels.delete(channels.keys().next().value)
      channels.set(`${teamId}:${channel.name.toLowerCase()}`, { id: channel.id, at: now() })
      channels.set(`${teamId}:#${channel.id}`, { id: channel.name, at: now() })
    }
  }
  const cached = (key) => {
    const hit = channels.get(key)
    return hit && now() - hit.at < SLACK_LIMITS.cacheMs ? hit.id : null
  }
  async function resolveChannel(token, teamId, raw) {
    const text = String(raw || '').trim()
    if (/^[CGD][A-Z0-9]{6,24}$/.test(text)) return { id: text, name: cached(`${teamId}:#${text}`) || text }
    const name = text.replace(/^#/, '').toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(name)) return null
    const hit = cached(`${teamId}:${name}`)
    if (hit) return { id: hit, name }
    let cursor
    for (let page = 0; page < SLACK_LIMITS.channelPages; page++) {
      const json = await call(token, 'conversations.list', { types: 'public_channel,private_channel', exclude_archived: true, limit: SLACK_LIMITS.channels, ...(cursor && { cursor }) })
      remember(teamId, json.channels || [])
      const found = (json.channels || []).find((c) => String(c?.name || '').toLowerCase() === name)
      if (found) return { id: found.id, name }
      cursor = json.response_metadata?.next_cursor
      if (!cursor) break
    }
    return null
  }

  // The authors' names (users.info), for one answer only.
  async function namesOf(token, ids) {
    const names = new Map()
    for (const id of [...new Set(ids.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, SLACK_LIMITS.users)) {
      const json = await call(token, 'users.info', { user: id }).catch(() => null)
      const person = json?.user
      const name = plainText(person?.profile?.display_name || person?.real_name || person?.profile?.real_name || person?.name || '', 60)
      if (name) names.set(id, name)
    }
    return names
  }

  const clampLimit = (value, max, fallback) => Math.max(1, Math.min(max, Number.isInteger(value) ? value : fallback))
  const messageLink = (account, channel, ts, threadTs = null) => {
    if (!account?.url || !channel || !ts) return null
    return `${account.url}archives/${channel}/p${String(ts).replace('.', '')}${threadTs && threadTs !== ts ? `?thread_ts=${threadTs}&cid=${channel}` : ''}`
  }

  // An answer the connector service quarantines like any agent's: plain lines, a link per message.
  async function messagesAnswer(token, list, { account, channel = null, threadTs = null, empty }) {
    const names = await namesOf(token, list.flatMap((m) => [m.user, ...String(m.text || '').match(/<@([A-Z0-9]+)/g)?.map((x) => x.slice(2)) || []]))
    const messages = list.map((m) => {
      const where = m.channel?.name || channel?.name || null
      const permalink = safeLink(m.permalink)?.url || messageLink(account, m.channel?.id || channel?.id, m.ts, threadTs)
      return {
        author: names.get(m.user) || plainText(m.username || '', 60) || 'Someone',
        channel: where,
        text: plainText(plainMessage(m.text, names), 1200),
        ts: typeof m.ts === 'string' ? m.ts : null,
        ...(permalink && { permalink }),
      }
    }).filter((m) => m.text)
    if (!messages.length) return { content: [{ type: 'text', text: empty }] }
    const lines = messages.map((m) => `${m.channel ? '#' + m.channel + ' · ' : ''}${m.author}: ${m.text}${m.permalink ? ' ' + m.permalink : ''}`)
    return {
      content: [{ type: 'text', text: lines.join('\n') }, ...messages.filter((m) => m.permalink).map((m) => ({ type: 'resource_link', uri: m.permalink, name: `${m.channel ? '#' + m.channel + ' · ' : ''}${m.author}` }))],
      structuredContent: { messages },
    }
  }

  const TOOL_RUNS = {
    async search_messages(args, { token, account }) {
      const query = plainText(args.query, 200)
      if (!query) return isError('Say what to search Slack for.')
      const channel = typeof args.channel === 'string' ? args.channel.trim().replace(/^#/, '') : ''
      const after = typeof args.after === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.after) ? args.after : ''
      const q = [query, channel && !/\bin:/.test(query) && `in:#${channel}`, after && !/\bafter:/.test(query) && `after:${after}`].filter(Boolean).join(' ')
      const json = await call(token, 'search.messages', { query: q, count: clampLimit(args.limit, SLACK_LIMITS.objects, SLACK_LIMITS.searchDefault) })
      return messagesAnswer(token, (json.messages?.matches || []).slice(0, SLACK_LIMITS.objects), { account, empty: 'Slack found no messages for that.' })
    },
    async list_channels(args, { token, teamId }) {
      const json = await call(token, 'users.conversations', { types: 'public_channel,private_channel', exclude_archived: true, limit: SLACK_LIMITS.channels })
      const list = (json.channels || []).filter((c) => typeof c?.name === 'string')
      remember(teamId, list)
      const want = typeof args.query === 'string' ? args.query.trim().replace(/^#/, '').toLowerCase() : ''
      const names = list.map((c) => c.name).filter((name) => !want || name.toLowerCase().includes(want)).slice(0, SLACK_LIMITS.channels)
      return { content: [{ type: 'text', text: names.length ? names.map((name) => '#' + name).join('\n') : 'You are in no Slack channels with that name.' }], structuredContent: { channels: names } }
    },
    async read_channel(args, { token, teamId, account }) {
      const channel = await resolveChannel(token, teamId, args.channel)
      if (!channel) return isError('Slack has no channel by that name that you can see.')
      const json = await gated(teamId, 'conversations.history', () => call(token, 'conversations.history', { channel: channel.id, limit: clampLimit(args.limit, cfg().historyLimit, cfg().historyLimit) }))
      return messagesAnswer(token, (json.messages || []).slice(0, cfg().historyLimit), { account, channel, empty: `#${channel.name} has no messages Slatebox can read.` })
    },
    async read_thread(args, { token, teamId, account }) {
      const link = args.permalink ? parsePermalink(args.permalink) : null
      if (args.permalink && !link) return isError('That is not a link to a Slack message.')
      const channel = link ? { id: link.channel, name: cached(`${teamId}:#${link.channel}`) || null } : await resolveChannel(token, teamId, args.channel)
      const ts = link ? link.threadTs || link.ts : typeof args.ts === 'string' && new RegExp(TS).test(args.ts) ? args.ts : null
      if (!channel || !ts) return isError('Name the thread: paste the link to a message in it.')
      const json = await gated(teamId, 'conversations.replies', () => call(token, 'conversations.replies', { channel: channel.id, ts, limit: clampLimit(args.limit, cfg().historyLimit, cfg().historyLimit) }))
      return messagesAnswer(token, (json.messages || []).slice(0, cfg().historyLimit), { account, channel, threadTs: ts, empty: 'That thread has no messages Slatebox can read.' })
    },
    async post_message(args, { token, teamId }) {
      const channel = await resolveChannel(token, teamId, args.channel)
      if (!channel) return isError('Slack has no channel by that name that you can see.')
      const text = typeof args.text === 'string' ? args.text.slice(0, SLACK_LIMITS.textChars) : ''
      if (!text.trim()) return isError('There is nothing to post.')
      const thread = typeof args.thread_ts === 'string' && new RegExp(TS).test(args.thread_ts) ? args.thread_ts : undefined
      const posted = await call(token, 'chat.postMessage', { channel: channel.id, text, ...(thread && { thread_ts: thread }) })
      const link = await call(token, 'chat.getPermalink', { channel: channel.id, message_ts: posted.ts }).catch(() => null)
      return { content: [{ type: 'text', text: `Posted in #${channel.name}.` }], structuredContent: { ok: true, channel: channel.name, ts: posted.ts, ...(safeLink(link?.permalink) && { permalink: safeLink(link.permalink).url }) } }
    },
    async add_reaction(args, { token, teamId }) {
      const channel = await resolveChannel(token, teamId, args.channel)
      if (!channel) return isError('Slack has no channel by that name that you can see.')
      const name = String(args.name || '').replace(/^:|:$/g, '')
      if (!/^[a-z0-9_+'-]{1,100}$/.test(name) || !new RegExp(TS).test(String(args.timestamp || ''))) return isError('Name the message and the emoji.')
      await call(token, 'reactions.add', { channel: channel.id, timestamp: args.timestamp, name })
      const link = await call(token, 'chat.getPermalink', { channel: channel.id, message_ts: args.timestamp }).catch(() => null)
      return { content: [{ type: 'text', text: `Reacted with :${name}: in #${channel.name}.` }], structuredContent: { ok: true, ...(safeLink(link?.permalink) && { permalink: safeLink(link.permalink).url }) } }
    },
  }

  // What Slack's refusal means for the person, in Slatebox's own words (never Slack's).
  function answerOf(error) {
    if (error instanceof McpProblem) throw error
    const code = error?.slack
    if (['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive'].includes(code)) throw new McpProblem('needs_sign_in', 'Connect Slack again on the Integrations page.')
    if (code === 'missing_scope') throw new McpProblem('needs_more_access', 'Slack needs more access to do that. Connect again.')
    if (code === 'ratelimited') throw new McpProblem('rate_limited', `Slack asked Slatebox to slow down. Try again in ${words(error.retryAfter || 60, 'second', 'seconds')}.`, { details: { retryAfter: error.retryAfter || 60 } })
    if (['channel_not_found', 'not_in_channel', 'is_archived'].includes(code)) return isError('Slack couldn\'t find that channel, or you are not in it.')
    if (['thread_not_found', 'message_not_found'].includes(code)) return isError('Slack couldn\'t find that message.')
    if (code === 'already_reacted') return isError('You already reacted with that emoji.')
    if (code === 'invalid_name') return isError('Slack has no emoji by that name.')
    if (code === 'unreachable') return isError('Couldn\'t reach Slack. Try again in a minute.')
    if (error instanceof SlackApiError) return isError('Slack couldn\'t do that just now. Try again in a minute.')
    throw error
  }

  /**
   * The Slack agent's session (the same shape as mcp-session.mjs), for the connector service:
   * discover lists its fixed tools; callTool runs one with the person's own token (options.token,
   * from the vault). Answers are MCP-shaped, so they are quarantined like any agent's.
   */
  const slackSession = {
    async discover() {
      return { serverInfo: { name: 'Slack' }, instructions: '', tools: SLACK_TOOLS.map((tool) => structuredClone(tool)) }
    },
    async callTool(_address, _fetch, { name, args, check }, { token = null, ownerId = null } = {}) {
      if (!(await usable())) return isError('Slack integration is turned off on this server.')
      if (check) check(SLACK_TOOLS.map((tool) => structuredClone(tool)))
      if (!token) throw new McpProblem('needs_sign_in', 'Connect Slack on the Integrations page first.')
      const run = TOOL_RUNS[name]
      if (!run) return isError('Unknown tool.')
      const row = ownerId ? await integrationOf(ownerId) : null
      try {
        return await run(args && typeof args === 'object' ? args : {}, { token, teamId: row?.slackTeamId || row?.account?.teamId || 'none', account: row?.account || {} })
      } catch (error) {
        return answerOf(error)
      }
    },
  }

  // ---------- inside Slack: link previews, Send to slate, /slatebox ----------

  async function botTokenOf(teamId) {
    if (typeof teamId !== 'string' || !ID.test(teamId) || !master) return null
    const rows = (await workspaces.find({ teamId })) || []
    const row = rows.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0]
    if (!row?.botToken) return null
    try {
      return open({ master, owner: botOwner(teamId), cipher: row.botToken })
    } catch {
      return null
    }
  }

  // The Slatebox person a Slack person is (they connected Slack in Slatebox), or null.
  async function personOf(teamId, slackUserId) {
    if (typeof teamId !== 'string' || typeof slackUserId !== 'string') return null
    const rows = await integrations.find({ kind: 'slack', slackTeamId: teamId, slackUserId })
    return rows.find((row) => row.status === 'active') || null
  }

  const ours = () => {
    try {
      return new URL(origin()).host
    } catch {
      return ''
    }
  }

  // A slate's preview by its own visibility only, never the poster's rights: the whole channel sees
  // it, so only a public slate (or a published presentation) shows its name and picture.
  function unfurlOf(url, preview) {
    if (!preview?.title) return { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*Private slate* · <${url}|Open in Slatebox>` } }] }
    const image = safeLink(preview.imageUrl)
    return {
      blocks: [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*<${url}|${escapeSlack(plainText(preview.title, 120))}>*${preview.description ? '\n' + escapeSlack(plainText(preview.description, 300)) : ''}` },
        ...(image && { accessory: { type: 'image', image_url: image.url, alt_text: plainText(preview.title, 120) } }),
      }],
    }
  }

  /** link_shared: this server's slate and presentation links in a message get a preview; nothing is stored. */
  async function linkShared(payload) {
    const event = payload?.event || {}
    const bot = await botTokenOf(payload?.team_id)
    if (!bot) return { unfurled: 0 }
    const unfurls = {}
    for (const link of (Array.isArray(event.links) ? event.links : []).slice(0, 10)) {
      const url = safeLink(link?.url)
      if (!url || url.host !== ours()) continue
      const match = /^\/(canvas|present)\/([A-Za-z0-9_-]{1,80})\/?$/.exec(new URL(url.url).pathname)
      if (!match) continue
      const preview = await publicPreview(match[1], match[2]).catch(() => null)
      unfurls[link.url] = unfurlOf(url.url, preview)
    }
    if (!Object.keys(unfurls).length) return { unfurled: 0 }
    const where = typeof event.unfurl_id === 'string' && typeof event.source === 'string' ? { unfurl_id: event.unfurl_id, source: event.source } : { channel: event.channel, ts: event.message_ts }
    await call(bot, 'chat.unfurl', { ...where, unfurls })
    audit({ kind: 'slack_unfurl', links: Object.keys(unfurls).length })
    return { unfurled: Object.keys(unfurls).length }
  }

  // The messages a shortcut was used on, held briefly in this process only (what Slack sent us),
  // until its modal is answered; never in the database.
  const pending = new Map()
  const tidyPending = () => {
    for (const [key, item] of pending) if (now() - item.at > SLACK_LIMITS.pendingMs) pending.delete(key)
  }
  const connectView = () => ({
    type: 'modal',
    title: { type: 'plain_text', text: 'Send to slate' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: 'Connect Slack in Slatebox first. Then Send to slate puts any message on a slate you pick.' } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Slatebox' }, url: `${origin()}/integrations`, action_id: 'open_integrations' }] },
    ],
  })

  async function openView(bot, trigger, view) {
    await call(bot, 'views.open', { trigger_id: trigger, view })
  }

  /** The "Send to slate" shortcut: a modal listing the slates this person may edit. */
  async function messageAction(payload) {
    const teamId = payload?.team?.id
    const bot = await botTokenOf(teamId)
    const trigger = typeof payload?.trigger_id === 'string' ? payload.trigger_id : null
    if (!bot || !trigger) return { opened: false }
    const row = await personOf(teamId, payload?.user?.id)
    if (!row) {
      await openView(bot, trigger, connectView())
      return { opened: 'connect' }
    }
    const slates = (await editableSlates(row.ownerId, { limit: SLACK_LIMITS.slates }).catch(() => [])).slice(0, SLACK_LIMITS.slates)
    const secret = (await appOf())?.signingSecret
    const channel = typeof payload?.channel?.id === 'string' && ID.test(payload.channel.id) ? payload.channel.id : null
    const ts = typeof payload?.message?.ts === 'string' && new RegExp(TS).test(payload.message.ts) ? payload.message.ts : null
    if (!secret || !channel || !ts) return { opened: false }
    if (!slates.length) {
      await openView(bot, trigger, { type: 'modal', title: { type: 'plain_text', text: 'Send to slate' }, close: { type: 'plain_text', text: 'Close' }, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'You have no slates you can edit yet. Make one in Slatebox, then try again.' } }] })
      return { opened: 'empty' }
    }
    tidyPending()
    const key = random(12).toString('base64url')
    pending.set(key, {
      at: now(), teamId, channel, channelName: plainText(payload.channel?.name || '', 80), ts, user: payload.message?.user || null,
      text: typeof payload.message?.text === 'string' ? payload.message.text.slice(0, SLACK_LIMITS.textChars) : '', threadTs: payload.message?.thread_ts || null,
      responseUrl: typeof payload.response_url === 'string' ? payload.response_url : null,
    })
    await openView(bot, trigger, {
      type: 'modal',
      callback_id: SLACK_CALLBACKS.sendToSlate,
      // Only which message (signed), never its text.
      private_metadata: signMetadata(secret, { c: channel, t: ts, k: key }),
      title: { type: 'plain_text', text: 'Send to slate' },
      submit: { type: 'plain_text', text: 'Send' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [{
        type: 'input', block_id: 'slate', label: { type: 'plain_text', text: 'Slate' },
        element: { type: 'static_select', action_id: 'pick', placeholder: { type: 'plain_text', text: 'Pick a slate' }, options: slates.map((s) => ({ text: { type: 'plain_text', text: plainText(s.name || 'Untitled slate', 75) || 'Untitled slate' }, value: String(s.shareId).slice(0, 150) })) },
      }],
    })
    return { opened: 'slates', slates: slates.length }
  }

  // The Slack agent of a person (its suggestions are filed under one id per person, like Google Drive's).
  const slackAgent = (row, runId) => ({
    kind: 'agent', userId: row.ownerId, tokenId: 'connector:slack:' + row.ownerId, tokenName: 'Slack', scopes: ['slates:read', 'slates:write'], runId,
    connector: { id: 'slack-' + row.ownerId, name: 'Slack', ...(Number.isInteger(row.colorIndex) && { colorIndex: row.colorIndex }) },
  })

  /**
   * The modal's answer: checked now (the signed message, a person who connected Slack, a slate they
   * still edit). → { response } for Slack, and land() to run after answering (one suggestion).
   */
  async function viewSubmission(payload) {
    const errors = (text) => ({ response: { response_action: 'errors', errors: { slate: text } } })
    const secret = (await appOf())?.signingSecret
    const meta = openMetadata(secret, payload?.view?.private_metadata)
    if (!meta || typeof meta.c !== 'string' || typeof meta.t !== 'string') return errors('That form is no longer valid. Use Send to slate again.')
    const teamId = payload?.team?.id
    const row = await personOf(teamId, payload?.user?.id)
    if (!row) return errors('Connect Slack in Slatebox first.')
    const shareId = payload?.view?.state?.values?.slate?.pick?.selected_option?.value
    const found = typeof shareId === 'string' ? await access.forUser(shareId, row.ownerId).catch(() => null) : null
    if (!found?.slate || !found.canEdit) return errors('You can\'t edit that slate any more. Pick another.')
    return { response: { response_action: 'clear' }, land: () => land(row, found.slate, meta, teamId) }
  }

  async function land(row, slate, meta, teamId) {
    const token = await vault.tokenFor(row.ownerId, SLACK_ADDRESS).catch(() => null)
    if (!token) return { landed: false }
    const held = pending.get(meta.k)
    pending.delete(meta.k)
    let message = held && held.channel === meta.c && held.ts === meta.t ? held : null
    if (!message) {
      // Another server process opened the modal: the message read again, through the shared gate.
      const json = await gated(teamId, 'conversations.history', () => call(token, 'conversations.history', { channel: meta.c, latest: meta.t, inclusive: true, limit: 1 })).catch(() => null)
      const got = (json?.messages || []).find((m) => m.ts === meta.t)
      message = got ? { channel: meta.c, ts: meta.t, user: got.user, text: got.text || '', channelName: '' } : null
    }
    if (!message?.text) return { landed: false }
    const names = await namesOf(token, [message.user, ...(message.text.match(/<@([A-Z0-9]+)/g) || []).map((x) => x.slice(2))])
    const link = await call(token, 'chat.getPermalink', { channel: meta.c, message_ts: meta.t }).catch(() => null)
    const permalink = safeLink(link?.permalink)?.url || null
    const author = names.get(message.user) || 'Someone'
    const text = plainText(`${author}: ${plainMessage(message.text, names)}`, 1200)
    const runId = 's' + random(9).toString('base64url')
    const groups = [{ label: message.channelName ? `From #${message.channelName}` : 'From Slack', layout: 'column', notes: [{ key: 's1', text, ...(permalink && { link: permalink }) }], lines: [] }]
    const items = itemsFromLayout({ groups, slate, serverName: 'Slack', view: null, message: `Slack: ${plainText(text, 100)}` })
    let landed = 0
    for (const item of items) {
      const answer = await applyOperations(slackAgent(row, runId), { shareId: slate.shareId, plan: item.plan, expectedRevision: slate.revision ?? 0 }, 'save').catch(() => null)
      if (answer?.body?.suggestion?.actionId || answer?.body?.outcome === 'saved') landed++
    }
    await presence.end(runId, 'done').catch(() => {})
    audit({ kind: 'slack_send_to_slate', userId: row.ownerId, ok: landed > 0, chars: text.length })
    const respond = held?.responseUrl ? responseUrlOf(held.responseUrl) : null
    if (respond && landed) {
      const name = plainText(slate.options?.name || 'your slate', 80) || 'your slate'
      await fetch(respond.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text: `Sent to *${escapeSlack(name)}*. Keep it on the slate to make it a note.` }) }).catch(() => {})
    }
    return { landed }
  }

  // Where Slack takes an answer to a shortcut: its own hooks address only (a development fake too).
  function responseUrlOf(raw) {
    try {
      const url = new URL(String(raw))
      if (url.username || url.password) return null
      if (url.protocol === 'https:' && url.hostname === 'hooks.slack.com') return { url: url.href }
      return cfg().devOrigins.includes(url.origin) ? { url: url.href } : null
    } catch {
      return null
    }
  }

  /** /slatebox [words]: up to five of this person's slates whose names match, as links (only they see it). */
  async function command(form) {
    const row = await personOf(form?.team_id, form?.user_id)
    if (!row) return { response_type: 'ephemeral', text: `Connect Slack in Slatebox first: <${origin()}/integrations|Integrations>.` }
    const query = plainText(form?.text || '', 80)
    const slates = await editableSlates(row.ownerId, { query, limit: SLACK_LIMITS.found }).catch(() => [])
    if (!slates.length) return { response_type: 'ephemeral', text: query ? `None of your slates is called "${escapeSlack(query)}".` : 'You have no slates yet.' }
    return { response_type: 'ephemeral', text: slates.slice(0, SLACK_LIMITS.found).map((s) => `<${origin()}/canvas/${encodeURIComponent(s.shareId)}|${escapeSlack(plainText(s.name || 'Untitled slate', 80))}>`).join('\n') }
  }

  // A person whose Slack access ended at Slack: their sign-in is forgotten (no revocation: it is already
  // dead) and the integration and its agents say why, until they connect again.
  async function signedOutAtSlack(row, note) {
    await vault.remove(row.ownerId, SLACK_ADDRESS, { revoke: false }).catch(() => {})
    const at = new Date(now())
    await integrations.update(row._id, { status: 'needs_sign_in', statusNote: note, updatedAt: at })
    if (connections) for (const agent of await connections.find({ integrationId: row._id, status: { $ne: 'removed' } })) await connections.update(agent._id, { status: 'needs_sign_in', updatedAt: at })
  }

  /** app_uninstalled: the workspace's bot token and every member's sign-in are gone. */
  async function uninstalled(teamId) {
    if (typeof teamId !== 'string' || !ID.test(teamId)) return { people: 0 }
    for (const row of (await workspaces.find({ teamId })) || []) await workspaces.remove(row._id)
    const rows = await integrations.find({ kind: 'slack', slackTeamId: teamId })
    for (const row of rows) await signedOutAtSlack(row, 'Slatebox was removed from your Slack workspace. Connect Slack again once it is back.')
    audit({ kind: 'slack_uninstalled', people: rows.length })
    return { people: rows.length }
  }

  /** tokens_revoked: only the listed people's sign-ins, and the bot token when it is listed. */
  async function tokensRevoked(teamId, tokens = {}) {
    if (typeof teamId !== 'string' || !ID.test(teamId)) return { people: 0, bots: 0 }
    let people = 0
    for (const id of (Array.isArray(tokens.oauth) ? tokens.oauth : []).filter((id) => typeof id === 'string' && ID.test(id)).slice(0, 500)) {
      for (const row of await integrations.find({ kind: 'slack', slackTeamId: teamId, slackUserId: id })) {
        await signedOutAtSlack(row, 'Your Slack access for Slatebox was revoked. Connect Slack again to use it.')
        people++
      }
    }
    let bots = 0
    const botIds = (Array.isArray(tokens.bot) ? tokens.bot : []).filter((id) => typeof id === 'string')
    for (const row of (await workspaces.find({ teamId })) || []) {
      if (!row.botUserId || !botIds.includes(row.botUserId)) continue
      await workspaces.remove(row._id)
      bots++
    }
    audit({ kind: 'slack_tokens_revoked', people, bots })
    return { people, bots }
  }

  /** An account deleted: the workspaces it installed no longer name it. */
  async function forgetPerson(userId) {
    for (const row of (await workspaces.find({ installedBy: userId })) || []) await workspaces.put({ ...row, installedBy: null, updatedAt: new Date(now()) })
  }

  /** The signing secret Slack signs its requests with (Admin › Integration apps), or null. */
  const signingSecret = async () => (await appOf())?.signingSecret || null

  return {
    usable, status, connect, finishInstall, slackSession, linkShared, messageAction, viewSubmission, command, uninstalled, tokensRevoked, forgetPerson, signingSecret,
    // what is held in memory (tests look): shortcut messages waiting for their modal, channel names
    _pending: pending, _channels: channels,
  }
}
