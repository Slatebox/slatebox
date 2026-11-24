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
export const GOOGLE_LIMITS = Object.freeze({ uploadBytes: 20 * 1024 * 1024, downloadBytes: 2 * 1024 * 1024, files: 20, readChars: 6000 })
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
  access, // { forUser(shareId, userId) -> { slate, canRead, canEdit } | null }
  applyOperations, // the registry's slates.applyOperations as an agent (a save is a live suggestion)
  presence = { end: async () => {} },
  publishImage = null, // async ({ buffer, slateId }) -> a public https address (Docs and Slides fetch pictures from one)
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
  async function slateFor(principal, shareId, { edit = false } = {}) {
    const found = typeof shareId === 'string' ? await access.forUser(shareId, principal.userId) : null
    if (!found?.slate || !found.canRead) refuse(404, 'not_found', 'Slate not found or unavailable.')
    if (edit && !found.canEdit) refuse(403, 'forbidden', 'Only people who can edit this slate can do that.')
    return found.slate
  }

  const integrationOf = (userId) => integrations.findOne({ ownerId: userId, address: GOOGLE_ADDRESS })

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
      ...(row && { integrationId: row._id, status: !isPro && row.status === 'active' ? 'pro_ended' : row.status, grantedScopes: row.scopes || [] }),
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
    const at = new Date(now())
    const tools = normalizeTools(DRIVE_TOOLS).map(({ name, title, description, group, hash }) => ({ name, title, description, group, hash, policy: 'allow' }))
    const existing = await integrationOf(principal.userId)
    let integrationId = existing?._id
    if (existing) await integrations.update(existing._id, { status: 'active', auth: { kind: 'oauth', issuer: GOOGLE_ISSUER }, scopes: granted, tools, changed: null, updatedAt: at })
    else {
      integrationId = 'i' + randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x')
      await integrations.insert({
        _id: integrationId, ownerType: 'user', ownerId: principal.userId, kind: 'google', address: GOOGLE_ADDRESS, host: GOOGLE_HOST, galleryId: 'googledrive',
        name: 'Google Drive', serverName: 'Google Drive', tools, auth: { kind: 'oauth', issuer: GOOGLE_ISSUER }, scopes: granted, defaultContextLevel: 'request', rule: 'ask',
        colorIndex: 2, status: 'active', createdAt: at, updatedAt: at, lastUsedAt: null,
      })
    }
    audit({ kind: 'google_connect', userId: principal.userId, scopes: granted.length })
    return { ok: true, integrationId, scopes: granted }
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

  /**
   * Export a slate to Google Docs: its title, each branch as a heading with its notes as bullets
   * (links kept), and its picture at the end. update: write over the last Doc made from this slate.
   */
  async function exportDoc(principal, { shareId, image = null, update = false }) {
    // The slate first: someone who can't open it learns nothing else.
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    await requireOn(principal)
    const outline = slateOutline(slate)
    let imageUri = null
    if (image) {
      const buffer = decode('png', image)
      if (buffer.length > GOOGLE_LIMITS.uploadBytes) refuse(413, 'too_large', 'That picture is too large.')
      imageUri = publishImage ? await publishImage({ buffer, slateId: slate._id }).catch(() => null) : null
    }
    const link = await docLinks.findOne({ _id: docLinkId(principal.userId, slate._id) })
    let documentId = null
    if (update && link?.documentId) {
      const current = await api(principal.userId, 'GET', `${bases().docs}/v1/documents/${encodeURIComponent(link.documentId)}?fields=body(content(endIndex))`)
      const endIndex = Math.max(...(current.body?.content || []).map((c) => Number(c.endIndex) || 0), 1)
      await api(principal.userId, 'POST', `${bases().docs}/v1/documents/${encodeURIComponent(link.documentId)}:batchUpdate`, { body: { requests: replaceRequests(endIndex, outline, { imageUri }) } })
      documentId = link.documentId
    } else {
      const made = await api(principal.userId, 'POST', `${bases().docs}/v1/documents`, { body: { title: outline.title } })
      if (typeof made.documentId !== 'string' || !made.documentId) refuse(502, 'google_failed', 'Google didn\'t make the document. Try again.')
      documentId = made.documentId
      await api(principal.userId, 'POST', `${bases().docs}/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, { body: { requests: docRequests(outline, { imageUri }) } })
      if (link) await docLinks.update(link._id, { documentId, updatedAt: new Date(now()) })
      else await docLinks.insert({ _id: docLinkId(principal.userId, slate._id), userId: principal.userId, slateId: slate._id, documentId, updatedAt: new Date(now()) })
    }
    audit({ kind: 'google_doc', userId: principal.userId, update: Boolean(update && link), sections: outline.sections.length })
    return { documentId, url: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`, updated: Boolean(update && link?.documentId) }
  }

  /** The last Doc this person made from this slate, if any ("Update this Doc"). */
  async function lastDoc(principal, { shareId }) {
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    const link = await docLinks.findOne({ _id: docLinkId(principal.userId, slate._id) })
    return link?.documentId ? { documentId: link.documentId, url: `https://docs.google.com/document/d/${encodeURIComponent(link.documentId)}/edit` } : { documentId: null, url: null }
  }

  /** Presentation frames to Google Slides: one slide per frame, its title and picture. */
  async function exportSlides(principal, { shareId, slides = [] }) {
    // The slate first: someone who can't open it learns nothing else.
    await requirePerson(principal)
    const slate = await slateFor(principal, shareId)
    await requireOn(principal)
    if (!Array.isArray(slides) || !slides.length) refuse(400, 'invalid_request', 'This slate has no frames to make slides from.')
    const frames = []
    for (const slide of slides.slice(0, DOC_LIMITS.slides)) {
      const buffer = slide.image ? decode('png', slide.image) : null
      const imageUri = buffer && publishImage ? await publishImage({ buffer, slateId: slate._id }).catch(() => null) : null
      frames.push({ title: slide.title, imageUri })
    }
    const made = await api(principal.userId, 'POST', `${bases().slides}/v1/presentations`, { body: { title: plainText(slate.options?.name || 'Slatebox', DOC_LIMITS.titleChars) } })
    if (typeof made.presentationId !== 'string') refuse(502, 'google_failed', 'Google didn\'t make the presentation. Try again.')
    await api(principal.userId, 'POST', `${bases().slides}/v1/presentations/${encodeURIComponent(made.presentationId)}:batchUpdate`, { body: { requests: slideRequests(frames) } })
    audit({ kind: 'google_slides', userId: principal.userId, slides: frames.length })
    return { presentationId: made.presentationId, url: `https://docs.google.com/presentation/d/${encodeURIComponent(made.presentationId)}/edit`, slides: frames.length }
  }

  const fileIdOk = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(id)

  // A file's text, by its kind: a Google Doc's structure, a sheet's rows, or a text file's lines.
  async function readFile(userId, fileId) {
    if (!fileIdOk(fileId)) refuse(400, 'invalid_request', 'That is not a Drive file id.')
    const meta = await api(userId, 'GET', `${bases().drive}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,size`)
    const name = plainText(meta.name || 'Drive file', 120)
    const link = safeLink(meta.webViewLink)?.url || null
    if (meta.mimeType === 'application/vnd.google-apps.document') {
      const doc = await api(userId, 'GET', `${bases().docs}/v1/documents/${encodeURIComponent(fileId)}`)
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

  return { status, connect, saveToDrive, exportDoc, lastDoc, exportSlides, importFile, slateFiles: slateFilesList, attachFiles, driveSession, tokenOf }
}
