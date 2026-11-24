// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Google as a native integration (owner, 2026-11-24): connect Google once, save slates to Drive,
// export them to Google Docs (and frames to Slides), bring a Doc, sheet or text file in as a
// suggestion, and invite "Google Drive" onto a slate as an agent that reads the files picked for it.
// Without Meteor: the vault, the stores, the network and the app's suggestion path are passed in.
//
// Scope: drive.file only (files this app made, or the person picked in the Google Picker). It covers
// Drive upload, export and download, Docs create/get/batchUpdate and Slides create/batchUpdate for
// those files, and needs no restricted-scope security assessment. Reading a person's whole Drive
// would need drive.readonly (restricted: Google verification plus a yearly CASA assessment); it is
// not asked for.
//
// Connecting: the page's Google Identity Services code client (popup, redirect_uri "postmessage",
// offline access) hands this server a one-time code; the server exchanges it and seals the tokens
// in the person's vault (credentials.mjs, address google://drive, issuer accounts.google.com),
// renewed under its lease and revoked at oauth2.googleapis.com/revoke on disconnect. No Google token
// ever reaches a browser, a publication, a log line or an answer. (The Picker gets its own short
// browser token from the same client id, kept in memory on the page, never sent here.)
import { randomBytes } from 'node:crypto'
import { SignInNeeded } from '../credentials.mjs'
import { tokenResult } from '../oauth.mjs'
import { normalizeTools, plainText } from '../tools.mjs'
import { safeLink } from '../results.mjs'
import { slateOutline, docRequests, replaceRequests, slideRequests, groupsFromDoc, groupsFromCsv, groupsFromText, DOC_LIMITS } from './docs.mjs'

export const GOOGLE_ADDRESS = 'google://drive'
export const GOOGLE_HOST = 'drive.google.com'
export const GOOGLE_ISSUER = 'https://accounts.google.com'
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** Exactly what Slatebox asks Google for. */
export const GOOGLE_SCOPES = Object.freeze([DRIVE_FILE_SCOPE])
// Granted alongside by Google itself when a person already allowed them to this client; harmless.
const TOLERATED = new Set([DRIVE_FILE_SCOPE, 'openid', 'email', 'profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'])
export const GOOGLE_LIMITS = Object.freeze({ uploadBytes: 20 * 1024 * 1024, downloadBytes: 2 * 1024 * 1024, files: 20, readChars: 6000, pictureBytesPerCall: 30 * 1024 * 1024, picturesPerHour: 60 })
export const GOOGLE_PRO = 'Google integration is part of Slatebox Pro and Slatebox Business.'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export const DEFAULT_BASES = Object.freeze({
  oauth: 'https://oauth2.googleapis.com',
  drive: 'https://www.googleapis.com',
  docs: 'https://docs.googleapis.com',
  slides: 'https://slides.googleapis.com',
})

/** The Drive agent's two fixed tools (read-only lookups), consented to when Google is connected. */
export const DRIVE_TOOLS = Object.freeze([
  { name: 'list_slate_files', title: 'List this slate\'s Drive files', description: 'Lists the Google Drive files picked for this slate: their names, kinds and links.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'read_drive_file', title: 'Read a Drive file', description: 'Reads the text of one Google Drive file picked for this slate (a Doc, a sheet as rows, or a text file).', inputSchema: { type: 'object', properties: { fileId: { type: 'string', description: 'The file id, as list_slate_files gives it.' } }, required: ['fileId'] }, annotations: { readOnlyHint: true } },
])

export class GoogleRefused extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}
const refuse = (status, code, message) => {
  throw new GoogleRefused(status, code, message)
}

/**
 * Google's settings, from settings.googleDocs.web (the OAuth client, server only) and
 * settings.public.google (the Picker's API key and the project number, public by nature). apiBase
 * (one fake Google for every API) is honored only on a development server, like stripe.apiBase.
 */
export function googleSettings(settings = {}, { development = false } = {}) {
  const web = settings.googleDocs?.web || {}
  const pub = settings.public?.google || {}
  const base = development && typeof settings.google?.apiBase === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(settings.google.apiBase) ? settings.google.apiBase.replace(/\/+$/, '') : null
  return {
    clientId: typeof web.client_id === 'string' ? web.client_id : null,
    clientSecret: typeof web.client_secret === 'string' ? web.client_secret : null,
    pickerApiKey: typeof pub.pickerApiKey === 'string' && pub.pickerApiKey ? pub.pickerApiKey : null,
    appId: typeof pub.appId === 'string' && /^\d{4,20}$/.test(pub.appId) ? pub.appId : null,
    bases: base ? { oauth: base, drive: base, docs: base, slides: base } : DEFAULT_BASES,
    devOrigins: base ? [base] : [],
  }
}

/** What an administrator may know about Google's setup: yes or no for each part, never a value. */
export function googleConfiguration(config, { vaultKey }) {
  return { client: Boolean(config.clientId && config.clientSecret), pickerKey: Boolean(config.pickerApiKey), appId: Boolean(config.appId), vaultKey: Boolean(vaultKey) }
}

export function createGoogleService({
  vault, // credentials.mjs
  integrations, // the integrations store (service.mjs's)
  docLinks, // { findOne({ _id }), insert, update }: each person's last Doc per slate
  slateFiles, // { findOne({ _id }), insert, update }: each person's picked Drive files per slate
  fetch, // a guarded fetch (mcp-fetch.mjs createMcpFetch) that may GET, POST, PATCH
  config, // () => googleSettings(...)
  pro, // async (userId) -> boolean
  enabled = async () => true, // the Google card is on in /admin/ai › Gallery
  access, // { forUser(shareId, userId), forToken(principal, shareId) } -> { slate, canRead, canEdit } | null
  applyOperations, // the registry's slates.applyOperations as an agent (a save is a live suggestion)
  presence = { end: async () => {} },
  // async ({ buffer, slateId }) -> { url, remove() } (or a bare url): a public https address Docs and
  // Slides fetch a picture from once, at insertion (they keep their own copy); removed right after.
  publishImage = null,
  onConnected = async () => {}, // async (integration): the connector service resumes its agents on every slate
  itemsFromLayout, // translate.mjs
  audit = () => {},
  now = Date.now,
}) {
  const bases = () => config().bases

  async function requirePerson(principal) {
    if (!principal?.userId || principal.kind === 'guest' || principal.kind === 'visitor') refuse(401, 'sign_in', 'Save your account to connect Google.')
  }
  async function requireOn(principal) {
    await requirePerson(principal)
    if (!(await enabled())) refuse(403, 'disabled', 'Google integration is turned off on this server.')
    const cfg = config()
    if (!cfg.clientId || !cfg.clientSecret) refuse(422, 'not_configured', 'Google is not set up on this server.')
    if (!vault?.available?.()) refuse(422, 'vault_off', 'Google needs the server\'s key-encryption key, which is not set.')
    if (!(await pro(principal.userId))) refuse(402, 'pro_required', GOOGLE_PRO)
  }
  // A token (API, exec, MCP) by the token rule: its account's own rights, never an unlisted link's
  // (a bearer token carries no invitation). A signed-in page by its session's rule.
  async function accessOf(principal, shareId) {
    if (typeof shareId !== 'string') return null
    if (principal.kind === 'agent' && !principal.connector) return access.forToken ? access.forToken(principal, shareId) : null
    return access.forUser(shareId, principal.userId)
  }
  async function slateFor(principal, shareId, { edit = false } = {}) {
    const found = await accessOf(principal, shareId)
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (edit && !found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate can do that.')
    return found.slate
  }

  const integrationOf = (userId) => integrations.findOne({ ownerId: userId, address: GOOGLE_ADDRESS })

  /** Whether Google works on this server at all: the card on, a client, the vault key (agents check this too). */
  async function usable() {
    const cfg = config()
    return Boolean((await enabled()) && cfg.clientId && cfg.clientSecret && vault?.available?.())
  }

  // The person's Google token (renewed under the vault's lease when it is about to end).
  async function tokenOf(userId) {
    let token = null
    try {
      token = await vault.tokenFor(userId, GOOGLE_ADDRESS)
    } catch (error) {
      if (!(error instanceof SignInNeeded)) throw error
      const row = await integrationOf(userId)
      if (row && error.code === 'needs_sign_in') await integrations.update(row._id, { status: 'needs_sign_in', updatedAt: new Date(now()) })
      refuse(401, error.code === 'busy' ? 'busy' : 'needs_sign_in', error.code === 'busy' ? error.message : 'Connect Google again on the Integrations page.')
    }
    if (!token) refuse(401, 'google_not_connected', 'Connect Google first on the Integrations page.')
    return token
  }

  // One Google API call as the person. A refused token is renewed once, then "connect again".
  async function api(userId, method, url, { body = null, headers = {}, raw = false, max = GOOGLE_LIMITS.downloadBytes } = {}, retried = false) {
    const token = retried ? await vault.tokenFor(userId, GOOGLE_ADDRESS, { force: true }).catch(() => null) : await tokenOf(userId)
    if (!token) refuse(401, 'needs_sign_in', 'Connect Google again on the Integrations page.')
    let response
    try {
      response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(body && !headers['content-type'] && { 'content-type': 'application/json' }), ...headers }, ...(body && { body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) }) })
    } catch (error) {
      refuse(502, 'google_unreachable', 'Couldn\'t reach Google. Try again in a minute.')
    }
    if (response.status === 401 && !retried) return api(userId, method, url, { body, headers, raw, max }, true)
    if (response.status === 401) refuse(401, 'needs_sign_in', 'Connect Google again on the Integrations page.')
    if (response.status === 403) refuse(403, 'google_forbidden', 'Google refused that. Slatebox can only reach files it made or that you picked.')
    if (response.status === 404) refuse(404, 'google_not_found', 'Google couldn\'t find that file, or Slatebox may not open it. Pick it again.')
    if (!response.ok) refuse(502, 'google_failed', 'Google couldn\'t do that just now. Try again in a minute.')
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > max) refuse(413, 'too_large', 'That file is too large to bring in.')
    if (raw) return buffer.toString('utf8')
    try {
      return JSON.parse(buffer.toString('utf8') || '{}')
    } catch {
      refuse(502, 'google_failed', 'Google answered something Slatebox could not read.')
    }
  }

  /** Whether Google works here and for this person: never a token. */
  async function status(principal) {
    await requirePerson(principal)
    const cfg = config()
    const row = await integrationOf(principal.userId)
    const on = await enabled()
    const isPro = await pro(principal.userId)
    return {
      enabled: on,
      configured: Boolean(cfg.clientId && cfg.clientSecret) && Boolean(vault?.available?.()),
      // Public by nature: the browser's Google sign-in and Picker need them.
      clientId: on ? cfg.clientId : null,
      pickerReady: Boolean(on && cfg.pickerApiKey && cfg.appId),
      scopes: [...GOOGLE_SCOPES],
      connected: Boolean(row && row.status !== 'needs_sign_in'),
      ...(row && { integrationId: row._id, status: !isPro && row.status === 'active' ? 'pro_ended' : row.status, grantedScopes: row.scopes || [], account: row.account || null }),
      pro: isPro,
    }
  }

  /** The page's one-time code for tokens, sealed in the vault; makes (or renews) the Google integration. */
  async function connect(principal, { code }) {
    await requireOn(principal)
    const cfg = config()
    if (typeof code !== 'string' || code.length < 8 || code.length > 2048) refuse(400, 'invalid_request', 'Google didn\'t send a sign-in code. Try again.')
    let json = null
    try {
      const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: 'postmessage', client_id: cfg.clientId, client_secret: cfg.clientSecret })
      const response = await fetch(`${bases().oauth}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: params.toString() })
      json = await response.json().catch(() => null)
    } catch {
      refuse(502, 'google_unreachable', 'Couldn\'t reach Google. Try again in a minute.')
    }
    const tokens = tokenResult(json, now())
    if (!tokens || tokens.error) refuse(422, 'google_refused', 'Google didn\'t finish the sign-in. Try again.')
    const granted = tokens.scopes.length ? tokens.scopes : [...GOOGLE_SCOPES]
    const revokeNow = async () => {
      const params = new URLSearchParams({ token: tokens.refreshToken || tokens.accessToken })
      await fetch(`${bases().oauth}/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() }).catch(() => {})
    }
    // drive.file unticked on Google's screen: nothing works, so say so instead of half-connecting.
    if (!granted.includes(DRIVE_FILE_SCOPE)) {
      await revokeNow()
      refuse(422, 'scope_missing', 'Google didn\'t allow access to the files Slatebox makes or you pick. Connect again and leave that box ticked.')
    }
    // More than Slatebox asked for (only possible with a misconfigured client): refused and revoked.
    if (granted.some((scope) => !TOLERATED.has(scope))) {
      await revokeNow()
      refuse(422, 'scope_wrong', 'Google granted more access than Slatebox asks for, so Slatebox did not keep it.')
    }
    // Lasting access (a refresh token) is what lets agents and exports work later.
    if (!tokens.refreshToken) {
      await revokeNow()
      refuse(422, 'no_offline', 'Google didn\'t give Slatebox lasting access. Connect again.')
    }
    await vault.save({
      userId: principal.userId,
      address: GOOGLE_ADDRESS,
      resource: null,
      issuer: GOOGLE_ISSUER,
      kind: 'oauth',
      registration: { kind: 'preregistered', provider: 'google', clientId: cfg.clientId },
      server: { issuer: GOOGLE_ISSUER, tokenEndpoint: `${bases().oauth}/token`, revocationEndpoint: `${bases().oauth}/revoke` },
      tokens: { ...tokens, scopes: granted },
    })
    // Which Google account this is (Drive's about, allowed under drive.file): the Picker is told to use
    // the same one, so the files picked there are ones this sign-in may open.
    const about = await fetch(`${bases().drive}/drive/v3/about?fields=user(emailAddress)`, { method: 'GET', headers: { authorization: `Bearer ${tokens.accessToken}` } })
      .then((response) => (response.ok ? response.json() : null)).catch(() => null)
    const email = typeof about?.user?.emailAddress === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(about.user.emailAddress) ? about.user.emailAddress : null
    const at = new Date(now())
    const tools = normalizeTools(DRIVE_TOOLS).map(({ name, title, description, group, hash }) => ({ name, title, description, group, hash, policy: 'allow' }))
    const existing = await integrationOf(principal.userId)
    let integrationId = existing?._id
    if (existing) await integrations.update(existing._id, { status: 'active', auth: { kind: 'oauth', issuer: GOOGLE_ISSUER }, scopes: granted, tools, changed: null, account: email, updatedAt: at })
    else {
      integrationId = 'i' + randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')
      await integrations.insert({
        _id: integrationId, ownerType: 'user', ownerId: principal.userId, kind: 'google', address: GOOGLE_ADDRESS, host: GOOGLE_HOST, galleryId: 'googledrive',
        name: 'Google Drive', serverName: 'Google Drive', tools, auth: { kind: 'oauth', issuer: GOOGLE_ISSUER }, scopes: granted, defaultContextLevel: 'request', rule: 'ask',
        colorIndex: 2, status: 'active', account: email, createdAt: at, updatedAt: at, lastUsedAt: null,
      })
    }
    // Connecting again is consenting again: the Drive agent resumes on every slate it is on (paused
    // ones too, e.g. after its fixed tools changed in a release).
    await onConnected(await integrationOf(principal.userId)).catch(() => {})
    audit({ kind: 'google_connect', userId: principal.userId, scopes: granted.length })
    return { ok: true, integrationId, scopes: granted, account: email }
  }

  // The app-made "Slatebox" folder in the person's Drive (found again, or made once).
  async function folderOf(userId) {
    const q = encodeURIComponent(`mimeType='${FOLDER_MIME}' and name='Slatebox' and trashed=false`)
    const listed = await api(userId, 'GET', `${bases().drive}/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1&spaces=drive`)
    if (listed.files?.[0]?.id) return listed.files[0].id
    const made = await api(userId, 'POST', `${bases().drive}/drive/v3/files?fields=id`, { body: { name: 'Slatebox', mimeType: FOLDER_MIME } })
    return made.id
  }

  async function upload(userId, { name, mimeType, buffer, folderId }) {
    const boundary = 'sb' + randomBytes(12).toString('hex')
    const meta = JSON.stringify({ name, mimeType, ...(folderId && { parents: [folderId] }) })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ])
    return api(userId, 'POST', `${bases().drive}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink`, { body, headers: { 'content-type': `multipart/related; boundary=${boundary}` } })
  }

  const FORMATS = {
    png: { mimeType: 'image/png', ext: 'png' },
    pdf: { mimeType: 'application/pdf', ext: 'pdf' },
    svg: { mimeType: 'image/svg+xml', ext: 'svg' },
    slatebox: { mimeType: 'application/json', ext: 'slatebox' },
  }
  const fileName = (slate, ext) => `${(plainText(slate.options?.name || 'Slate', 80) || 'Slate').replace(/[\\/:*?"<>|]/g, '-')}.${ext}`

  // What the page rendered: a data URL (PNG, PDF) or SVG text, checked to be what it says.
  function decode(format, data) {
    if (format === 'slatebox') return null
    if (typeof data !== 'string' || !data) refuse(400, 'invalid_request', 'Nothing to save.')
    if (format === 'svg') {
      if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(data)) refuse(400, 'invalid_request', 'That is not an SVG picture.')
      return Buffer.from(data, 'utf8')
    }
    const buffer = Buffer.from(data.replace(/^data:[a-z/+.-]+;base64,/i, ''), 'base64')
    const magic = format === 'png' ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) : buffer.subarray(0, 5).toString('latin1') === '%PDF-'
    if (!magic) refuse(400, 'invalid_request', `That is not a ${format.toUpperCase()} file.`)
    return buffer
  }

  /** Save a slate to the person's Drive (in the app's Slatebox folder): a picture, a PDF or the slate file. */
  async function saveToDrive(principal, { shareId, format, data = null }) {
    // The slate first: someone who can't open it learns nothing else.
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    await requireOn(principal)
    const kind = FORMATS[format]
    if (!kind) refuse(400, 'invalid_request', 'Choose PNG, PDF, SVG or the slate file.')
    const buffer = format === 'slatebox' ? Buffer.from(JSON.stringify({ slatebox: 1, name: slate.options?.name || '', shareId: slate.shareId, nodes: slate.nodes || [] })) : decode(format, data)
    if (buffer.length > GOOGLE_LIMITS.uploadBytes) refuse(413, 'too_large', 'That is too large to save to Drive.')
    const folderId = await folderOf(principal.userId)
    const file = await upload(principal.userId, { name: fileName(slate, kind.ext), mimeType: kind.mimeType, buffer, folderId })
    audit({ kind: 'google_save', userId: principal.userId, format, bytes: buffer.length })
    return { fileId: file.id, name: file.name, webViewLink: safeLink(file.webViewLink)?.url || `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view` }
  }

  const docLinkId = (userId, slateId) => `${userId}:${slateId}`

  // Pictures for Docs and Slides. Google fetches each from a public address once, when it is inserted,
  // and keeps its own copy, so the app's copy lives only for that request: each picture is checked to
  // be a PNG, counted against the person's hourly budget, published, and removed right after.
  const pictureLog = new Map() // userId -> the times of their recent pictures
  function budgetPictures(userId, count) {
    if (!count) return
    const since = now() - 3600000
    const times = (pictureLog.get(userId) || []).filter((at) => at > since)
    if (times.length + count > GOOGLE_LIMITS.picturesPerHour) refuse(429, 'too_many_pictures', 'That is a lot of pictures in one hour. Try again later, or export without pictures.')
    for (let i = 0; i < count; i++) times.push(now())
    pictureLog.set(userId, times)
  }
  function decodePictures(images) {
    const buffers = images.map((image) => (image ? decode('png', image) : null))
    const total = buffers.reduce((sum, buffer) => sum + (buffer?.length || 0), 0)
    if (buffers.some((buffer) => buffer && buffer.length > GOOGLE_LIMITS.uploadBytes) || total > GOOGLE_LIMITS.pictureBytesPerCall) refuse(413, 'too_large', 'Those pictures are too large.')
    return buffers
  }
  // Google must be able to fetch it: https, and not an address only this network knows (a self-hosted
  // install's own file store often is). Anything else goes without its picture.
  const PRIVATE_V4 = /^(0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
  function reachableByGoogle(url) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    const host = parsed.hostname.toLowerCase()
    if (parsed.protocol !== 'https:' || !host.includes('.') || host.startsWith('[')) return false
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) && PRIVATE_V4.test(host)) return false
    return true
  }
  async function publishPictures(slateId, buffers) {
    const out = []
    for (const buffer of buffers) {
      const made = buffer && publishImage ? await publishImage({ buffer, slateId }).catch(() => null) : null
      const url = typeof made === 'string' ? made : made?.url
      const remove = typeof made?.remove === 'function' ? made.remove : async () => {}
      if (url && reachableByGoogle(url)) out.push({ url, remove })
      else {
        await remove().catch(() => {})
        out.push(null)
      }
    }
    return out
  }
  const removePictures = (pictures) => Promise.all(pictures.filter(Boolean).map((picture) => picture.remove().catch(() => {})))

  // A batchUpdate (all or nothing at Google) with its pictures; when Google can't take them (it
  // couldn't fetch one), the same again without them. → whether the pictures went in.
  async function batchWithPictures(userId, url, requestsFor, withPictures) {
    if (!withPictures) {
      await api(userId, 'POST', url, { body: { requests: requestsFor(false) } })
      return false
    }
    try {
      await api(userId, 'POST', url, { body: { requests: requestsFor(true) } })
      return true
    } catch (error) {
      if (!(error instanceof GoogleRefused) || !['google_failed', 'google_forbidden'].includes(error.code)) throw error
      await api(userId, 'POST', url, { body: { requests: requestsFor(false) } })
      return false
    }
  }
  // A file this export just made, when writing into it failed: never left behind empty.
  const discard = (userId, fileId) => api(userId, 'DELETE', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}`).catch(() => {})

  /**
   * Export a slate to Google Docs: its title, each branch as a heading with its notes as bullets
   * (links kept), and its picture at the end. update: write over the last Doc made from this slate.
   * Only people who can edit the slate (as before): its picture is published for Google for a moment.
   */
  async function exportDoc(principal, { shareId, image = null, update = false }) {
    // The slate first: someone who can't open it learns nothing else.
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId, { edit: true })
    await requireOn(principal)
    const outline = slateOutline(slate)
    const [buffer] = decodePictures([image])
    budgetPictures(principal.userId, buffer ? 1 : 0)
    const link = await docLinks.findOne({ _id: docLinkId(principal.userId, slate._id) })
    const pictures = await publishPictures(slate._id, [buffer])
    const imageUri = pictures[0]?.url || null
    let documentId = null
    let picture = false
    try {
      if (update && link?.documentId) {
        const current = await api(principal.userId, 'GET', `${bases().docs}/v1/documents/${encodeURIComponent(link.documentId)}?fields=body(content(endIndex))`)
        const endIndex = Math.max(...(current.body?.content || []).map((c) => Number(c.endIndex) || 0), 1)
        picture = await batchWithPictures(principal.userId, `${bases().docs}/v1/documents/${encodeURIComponent(link.documentId)}:batchUpdate`, (withPicture) => replaceRequests(endIndex, outline, { imageUri: withPicture ? imageUri : null }), Boolean(imageUri))
        documentId = link.documentId
      } else {
        const made = await api(principal.userId, 'POST', `${bases().docs}/v1/documents`, { body: { title: outline.title } })
        if (typeof made.documentId !== 'string' || !made.documentId) refuse(502, 'google_failed', 'Google didn\'t make the document. Try again.')
        try {
          picture = await batchWithPictures(principal.userId, `${bases().docs}/v1/documents/${encodeURIComponent(made.documentId)}:batchUpdate`, (withPicture) => docRequests(outline, { imageUri: withPicture ? imageUri : null }), Boolean(imageUri))
        } catch (error) {
          await discard(principal.userId, made.documentId)
          throw error
        }
        documentId = made.documentId
        if (link) await docLinks.update(link._id, { documentId, updatedAt: new Date(now()) })
        else await docLinks.insert({ _id: docLinkId(principal.userId, slate._id), userId: principal.userId, slateId: slate._id, documentId, updatedAt: new Date(now()) })
      }
    } finally {
      await removePictures(pictures)
    }
    audit({ kind: 'google_doc', userId: principal.userId, update: Boolean(update && link), sections: outline.sections.length, picture })
    return { documentId, url: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`, updated: Boolean(update && link?.documentId), picture }
  }

  /** The last Doc this person made from this slate, if any ("Update this Doc"). */
  async function lastDoc(principal, { shareId }) {
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    const link = await docLinks.findOne({ _id: docLinkId(principal.userId, slate._id) })
    return link?.documentId ? { documentId: link.documentId, url: `https://docs.google.com/document/d/${encodeURIComponent(link.documentId)}/edit` } : { documentId: null, url: null }
  }

  /** Presentation frames to Google Slides: one slide per frame, its title and picture (people who can edit). */
  async function exportSlides(principal, { shareId, slides = [] }) {
    // The slate first: someone who can't open it learns nothing else.
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId, { edit: true })
    await requireOn(principal)
    if (!Array.isArray(slides) || !slides.length) refuse(400, 'invalid_request', 'This slate has no frames to make slides from.')
    const chosen = slides.slice(0, DOC_LIMITS.slides)
    const buffers = decodePictures(chosen.map((slide) => slide?.image || null))
    budgetPictures(principal.userId, buffers.filter(Boolean).length)
    const pictures = await publishPictures(slate._id, buffers)
    let made = null
    let picture = false
    try {
      made = await api(principal.userId, 'POST', `${bases().slides}/v1/presentations`, { body: { title: plainText(slate.options?.name || 'Slatebox', DOC_LIMITS.titleChars) } })
      if (typeof made.presentationId !== 'string') refuse(502, 'google_failed', 'Google didn\'t make the presentation. Try again.')
      const frames = (withPictures) => chosen.map((slide, i) => ({ title: slide?.title, imageUri: withPictures ? pictures[i]?.url || null : null }))
      try {
        picture = await batchWithPictures(principal.userId, `${bases().slides}/v1/presentations/${encodeURIComponent(made.presentationId)}:batchUpdate`, (withPictures) => slideRequests(frames(withPictures)), pictures.some(Boolean))
      } catch (error) {
        await discard(principal.userId, made.presentationId)
        throw error
      }
    } finally {
      await removePictures(pictures)
    }
    audit({ kind: 'google_slides', userId: principal.userId, slides: chosen.length, picture })
    return { presentationId: made.presentationId, url: `https://docs.google.com/presentation/d/${encodeURIComponent(made.presentationId)}/edit`, slides: chosen.length, picture }
  }

  const DOC_FIELDS = 'title,body(content(paragraph(elements(textRun(content,textStyle(link(url)))),paragraphStyle(namedStyleType))))'
  const fileIdOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id)

  // A file's text, by its kind: a Google Doc's structure, a sheet's rows, or a text file's lines.
  async function readFile(userId, fileId) {
    if (!fileIdOk(fileId)) refuse(400, 'invalid_request', 'That is not a Drive file id.')
    const meta = await api(userId, 'GET', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,size`)
    const name = plainText(meta.name || 'Drive file', 120)
    const link = safeLink(meta.webViewLink)?.url || null
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      // Only what becomes notes (a Doc's full JSON is wordy: pictures and styles would overrun the cap).
      const doc = await api(userId, 'GET', `${bases().docs}/v1/documents/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DOC_FIELDS)}`)
      return { name, link, mimeType: meta.mimeType, groups: groupsFromDoc({ ...doc, title: name }) }
    }
    if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const csv = await api(userId, 'GET', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`, { raw: true })
      return { name, link, mimeType: meta.mimeType, groups: groupsFromCsv(csv, name) }
    }
    if (/^text\/|^application\/(json|markdown)/.test(meta.mimeType || '')) {
      const text = await api(userId, 'GET', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true })
      return { name, link, mimeType: meta.mimeType, groups: groupsFromText(text, name) }
    }
    if (meta.mimeType === 'application/vnd.google-apps.presentation') {
      const text = await api(userId, 'GET', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`, { raw: true })
      return { name, link, mimeType: meta.mimeType, groups: groupsFromText(text, name) }
    }
    refuse(415, 'unsupported_file', `Slatebox can bring in Google Docs, Sheets, Slides and text files, not ${plainText(meta.mimeType || 'this kind of file', 60)}.`)
  }

  // Google's own agent on the slate: its suggestions are filed under one id per person, like an invited agent's.
  const googleAgent = async (userId, runId) => ({
    kind: 'agent', userId, tokenId: 'connector:google:' + userId, tokenName: 'Google Drive', scopes: ['slates:read', 'slates:write'], runId,
    connector: { id: 'google-' + userId, name: 'Google Drive', colorIndex: 2 },
  })

  /**
   * Bring a Doc, sheet, Slides deck or text file in as one grouped suggestion (ghosts everyone on the
   * slate sees; Keep all is one undo). Only files Slatebox may open: made by it, or picked before.
   */
  async function importFile(principal, { shareId, fileId, view = null }) {
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId, { edit: true })
    await requireOn(principal)
    const read = await readFile(principal.userId, fileId)
    if (!read.groups.length) refuse(422, 'empty_file', `${read.name} has no text to bring in.`)
    // The link back to the file rides on the first note of the first group.
    if (read.link && read.groups[0].notes[0] && !read.groups[0].notes[0].link) read.groups[0].notes[0].link = read.link
    const runId = 'g' + randomBytes(9).toString('base64url')
    const agent = await googleAgent(principal.userId, runId)
    const items = itemsFromLayout({ groups: read.groups, slate, serverName: 'Google Drive', view, message: `Google Drive: ${plainText(read.name, 120)}` })
    const actions = []
    for (const item of items) {
      const answer = await applyOperations(agent, { shareId: slate.shareId, plan: item.plan, expectedRevision: slate.revision ?? 0 }, 'save')
      if (answer?.body?.suggestion?.actionId) actions.push(answer.body.suggestion.actionId)
    }
    await presence.end(runId, 'done').catch(() => {})
    const notes = read.groups.reduce((sum, group) => sum + group.notes.length, 0)
    audit({ kind: 'google_import', userId: principal.userId, notes })
    return { name: read.name, actions, added: { notes, groups: read.groups.length } }
  }

  const filesId = (userId, slateId) => `${userId}:${slateId}`

  /** The Drive files picked for this slate (the Drive agent reads only these). */
  async function slateFilesList(principal, { shareId }) {
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    const row = await slateFiles.findOne({ _id: filesId(principal.userId, slate._id) })
    return { files: row?.files || [] }
  }

  /** Files picked in the Picker for this slate (ids, names and kinds only): what the Drive agent may read here. */
  async function attachFiles(principal, { shareId, files = [], replace = false }) {
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId, { edit: true })
    await requireOn(principal)
    const clean = (Array.isArray(files) ? files : []).filter((file) => fileIdOk(file?.id)).map((file) => ({ id: file.id, name: plainText(file.name || 'Drive file', 120), mimeType: plainText(file.mimeType || '', 120) }))
    const row = await slateFiles.findOne({ _id: filesId(principal.userId, slate._id) })
    const merged = [...(replace ? [] : row?.files || []), ...clean].filter((file, i, all) => all.findIndex((f) => f.id === file.id) === i).slice(-GOOGLE_LIMITS.files)
    if (row) await slateFiles.update(row._id, { files: merged, updatedAt: new Date(now()) })
    else await slateFiles.insert({ _id: filesId(principal.userId, slate._id), userId: principal.userId, slateId: slate._id, files: merged, updatedAt: new Date(now()) })
    return { files: merged }
  }

  /**
   * The Drive agent's session (the same shape as mcp-session.mjs), for the connector service:
   * discover lists its two fixed tools; callTool runs one with the person's Google token, on the
   * files picked for the slate only. Answers are MCP-shaped, so they are quarantined like any agent's.
   */
  const driveSession = {
    async discover() {
      return { serverInfo: { name: 'Google Drive' }, instructions: '', tools: DRIVE_TOOLS.map((tool) => ({ ...tool })) }
    },
    async callTool(address, _fetch, { name, args, check }, { ownerId, slateId } = {}) {
      // Turned off in /admin/ai (or its client or key gone): stored sign-ins are not used.
      if (!(await usable())) return { isError: true, content: [{ type: 'text', text: 'Google integration is turned off on this server.' }] }
      if (check) check(DRIVE_TOOLS.map((tool) => ({ ...tool })))
      const row = ownerId && slateId ? await slateFiles.findOne({ _id: filesId(ownerId, slateId) }) : null
      const picked = row?.files || []
      if (name === 'list_slate_files') {
        if (!picked.length) return { content: [{ type: 'text', text: 'No Drive files are picked for this slate yet. Pick some with "Drive files" on the agent\'s chip.' }] }
        return { content: [{ type: 'text', text: picked.map((file) => `${file.name} (${file.mimeType || 'file'}) id ${file.id} https://drive.google.com/file/d/${file.id}/view`).join('\n') }] }
      }
      if (name === 'read_drive_file') {
        const fileId = args?.fileId
        if (!picked.some((file) => file.id === fileId)) return { isError: true, content: [{ type: 'text', text: 'That file is not picked for this slate.' }] }
        const read = await readFile(ownerId, fileId)
        const text = read.groups.map((group) => [group.label, ...group.notes.map((note) => '- ' + note.text)].join('\n')).join('\n\n').slice(0, GOOGLE_LIMITS.readChars)
        return { content: [{ type: 'text', text: `${read.name}${read.link ? ' ' + read.link : ''}\n${text}` }] }
      }
      return { isError: true, content: [{ type: 'text', text: 'Unknown tool.' }] }
    },
  }

  /** Disconnecting Google forgets what it kept per slate: the files picked for the Drive agent, the last Docs. */
  async function forget(userId) {
    for (const store of [slateFiles, docLinks]) for (const row of await store.find({ userId })) await store.remove(row._id)
  }

  return { usable, forget, status, connect, saveToDrive, exportDoc, lastDoc, exportSlides, importFile, slateFiles: slateFilesList, attachFiles, driveSession, tokenOf }
}
