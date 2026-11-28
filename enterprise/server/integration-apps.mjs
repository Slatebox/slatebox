// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Integration apps (Admin › AI control › Integration apps): the OAuth app an operator registers
// with a vendor that offers no automatic registration (Slack, Asana, HubSpot, ...), entered by an
// administrator instead of only in settings.connectors.oauthApps. One connectorOAuthApps document
// per provider (_id: the provider):
//   clientId           public, kept as text
//   secret             the client secret sealed with the vault (metering/vault.mjs, the server's
//                      SLATEBOX_KEY_ENCRYPTION_KEY), bound to its provider; never returned
//   secretFingerprint  which secret it is (sha256:12345678…WXYZ), the only thing anyone sees of it
//   signingSecret, signingFingerprint  Slack's signing secret (native-apps.mjs signingSecret), sealed
//                      the same way under its own field, shown only as its fingerprint
//   createdAt/By, updatedAt/By
// The values a document holds win over the settings file's; settings stay the fallback (and keep
// what admin does not edit: scopes, resources). A secret belongs to its client id: changing the
// client id without a new secret drops the saved one. The settings secret is used with an admin
// client id only when both client ids are the same app.
//
// The connectors read the apps through apps() on every sign-in, token refresh and gallery listing,
// cached for a few seconds (and dropped at once on this process's own writes), so a pasted secret
// works without a restart on every pod.
//
// Slack is a native app (native-apps.mjs): the same row, plus its signing secret, and
// connectors.apps.slackManifest gives the manifest to create the app with, this server's addresses in it.
//
// Google is not editable here: its MCP servers' app is settings.connectors.oauthApps.google and
// Drive's is settings.googleDocs.web (google/google.mjs); the list shows it read-only.
//
// Pure apart from the injected document store, master key and audit trail.
import { open as openSecret, seal } from '/server/metering/vault.mjs'
import { keyFingerprint } from '/server/ai-control/keys.mjs'
import { defineAction } from '/server/actions/registry.mjs'
import { requireAIControlAdmin } from '/server/actions/ai-control-get.mjs'
import { guardControlWrite } from '/server/actions/ai-providers.mjs'
import { CLIENT_TEXT } from './connector-settings.mjs'
import { KNOWN_PROVIDERS, redirectUriFor } from './oauth.mjs'
import { NATIVE_APPS } from './native-apps.mjs'
import { slackManifest } from './slack/manifest.mjs'

export const CACHE_MS = 5000
export const NO_MASTER = 'Set SLATEBOX_KEY_ENCRYPTION_KEY on this server to store client secrets.'
// Where each vendor's apps are registered (the operator's own console).
export const VENDOR_CONSOLES = Object.freeze({
  github: { label: 'GitHub › Developer settings › OAuth Apps', url: 'https://github.com/settings/developers' },
  slack: { label: 'Slack › Your apps', url: 'https://api.slack.com/apps' },
  linear: { label: 'Linear › Settings › API › OAuth applications', url: 'https://linear.app/settings/api/applications/new' },
  asana: { label: 'Asana › My apps', url: 'https://app.asana.com/0/my-apps' },
  hubspot: { label: 'HubSpot developer portal', url: 'https://developers.hubspot.com' },
  box: { label: 'Box Developer Console', url: 'https://app.box.com/developers/console' },
  zoom: { label: 'Zoom App Marketplace › Build app', url: 'https://marketplace.zoom.us/user/build' },
  pitch: { label: 'Ask Pitch for an OAuth client', url: 'https://pitch.com' },
  salesforce: { label: 'Salesforce Setup › External Client App Manager', url: 'https://login.salesforce.com' },
  microsoft: { label: 'Microsoft Entra admin center › App registrations', url: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade' },
  google: { label: 'Google Cloud console › Credentials', url: 'https://console.cloud.google.com/apis/credentials' },
})
// Every provider listed here: the MCP vendors (oauth.mjs), then the native apps (Slack).
export const APP_PROVIDERS = Object.freeze([...Object.keys(KNOWN_PROVIDERS), ...Object.keys(NATIVE_APPS).filter((provider) => !KNOWN_PROVIDERS[provider])])
// The providers an administrator may set here: every one but Google (settings only).
export const EDITABLE_PROVIDERS = Object.freeze(APP_PROVIDERS.filter((provider) => provider !== 'google'))
const ownerOf = (provider) => ({ ownerType: 'server', ownerId: 'connector-oauth-app', provider })
const signingOwnerOf = (provider) => ({ ownerType: 'server', ownerId: 'connector-oauth-app', provider: `${provider}|signing` })
const hasSigning = (provider) => Boolean(NATIVE_APPS[provider]?.signingSecret)
const nameOf = (provider) => KNOWN_PROVIDERS[provider]?.name || NATIVE_APPS[provider]?.name || provider

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

/** A document as anyone may read it: never the cipher. */
export function publicApp(doc) {
  if (!doc) return null
  return {
    provider: doc._id, clientId: doc.clientId ?? null, hasSecret: Boolean(doc.secret), secretFingerprint: doc.secret ? doc.secretFingerprint ?? null : null,
    ...(hasSigning(doc._id) && { hasSigningSecret: Boolean(doc.signingSecret), signingFingerprint: doc.signingSecret ? doc.signingFingerprint ?? null : null }),
    createdAt: doc.createdAt ?? null, createdBy: doc.createdBy ?? null, updatedAt: doc.updatedAt ?? null, updatedBy: doc.updatedBy ?? null,
  }
}

/**
 * deps: {
 *   rows        { get(provider), all(), put(provider, doc), remove(provider) }: the connectorOAuthApps documents
 *   master      the vault master key (loadMasterKey) or null
 *   settingsApps() → connectorSettings(...).oauthApps (already checked)
 *   origin()    → this Slatebox's public address (the redirect URL is built from it)
 *   audit?(entry) → records { action, actor, target, before, after, reason } (the AI control store's record)
 *   now?(), cacheMs?, log?
 * }
 */
export function createIntegrationApps({ rows, master, settingsApps = () => ({}), origin = () => '', audit = null, now = () => Date.now(), cacheMs = CACHE_MS, log = console }) {
  let cache = null
  let pending = null

  const settingsNow = () => settingsApps() || {}

  // A stored document's secret, opened; null when there is none or it cannot be read here.
  function secretOf(doc) {
    if (!doc?.secret || !master) return null
    try {
      const value = openSecret({ master, owner: ownerOf(doc._id), cipher: doc.secret })
      return CLIENT_TEXT.test(value) ? value : null
    } catch {
      return null
    }
  }

  function signingOf(doc) {
    if (!doc?.signingSecret || !master || !hasSigning(doc._id)) return null
    try {
      const value = openSecret({ master, owner: signingOwnerOf(doc._id), cipher: doc.signingSecret })
      return CLIENT_TEXT.test(value) ? value : null
    } catch {
      return null
    }
  }

  /** The apps the connectors use: the settings file's, with each administrator-entered app on top. */
  function merge(settings, docs) {
    const out = { ...settings }
    for (const doc of docs) {
      if (!EDITABLE_PROVIDERS.includes(doc?._id) || typeof doc.clientId !== 'string' || !CLIENT_TEXT.test(doc.clientId)) continue
      const { clientSecret: settingsSecret, clientId: settingsId, signingSecret: settingsSigning, ...kept } = settings[doc._id] || {}
      const sameApp = settingsId === doc.clientId
      const secret = secretOf(doc) || (sameApp ? settingsSecret : null) || null
      const signing = signingOf(doc) || (sameApp ? settingsSigning : null) || null
      out[doc._id] = { ...kept, clientId: doc.clientId, ...(secret && { clientSecret: secret }), ...(signing && { signingSecret: signing }) }
    }
    return out
  }

  async function load() {
    const settings = settingsNow()
    let docs
    try {
      docs = (await rows.all()) || []
    } catch (error) {
      // the database is down: the last apps read keep answering, else the settings file's
      log.warn?.(`[connectors] integration apps could not be read: ${error.message}`)
      return cache?.apps || settings
    }
    const merged = merge(settings, docs)
    cache = { at: now(), apps: merged }
    return merged
  }

  /** The apps now (at most cacheMs old). Consulted on each sign-in, refresh and gallery listing. */
  async function apps() {
    if (cache && now() - cache.at < cacheMs) return cache.apps
    if (!pending) pending = load().finally(() => { pending = null })
    return pending
  }

  const forget = () => {
    cache = null
  }

  async function record(entry) {
    if (!audit) return
    try {
      await audit(entry)
    } catch (error) {
      log.warn?.(`[connectors] could not record ${entry.action} in the audit trail: ${error.message}`)
    }
  }

  function rowOf(provider, doc, settings) {
    const fromSettings = settings[provider] || null
    const admin = doc && typeof doc.clientId === 'string' && CLIENT_TEXT.test(doc.clientId) && EDITABLE_PROVIDERS.includes(provider)
    let source = 'none'
    if (admin) source = 'admin'
    else if (fromSettings?.clientId) source = 'settings'
    let secretSource = null
    let secretFingerprint = null
    let secretUnreadable = false
    if (admin && doc.secret) {
      secretUnreadable = !secretOf(doc)
      if (!secretUnreadable) {
        secretSource = 'admin'
        secretFingerprint = doc.secretFingerprint ?? null
      }
    }
    if (!secretSource && fromSettings?.clientSecret && (source === 'settings' || fromSettings.clientId === doc?.clientId)) {
      secretSource = 'settings'
      secretFingerprint = keyFingerprint(fromSettings.clientSecret)
    }
    return {
      provider,
      name: nameOf(provider),
      editable: EDITABLE_PROVIDERS.includes(provider),
      source,
      clientId: admin ? doc.clientId : fromSettings?.clientId ?? null,
      settingsClientId: fromSettings?.clientId ?? null,
      hasSecret: Boolean(secretSource),
      secretSource,
      secretFingerprint,
      ...(secretUnreadable && { secretUnreadable: true }),
      adminSaved: Boolean(doc),
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: doc?.updatedBy ?? null,
      console: VENDOR_CONSOLES[provider] || null,
      ...(hasSigning(provider) && { signing: signingRowOf(doc, fromSettings, admin, source) }),
    }
  }

  // The signing secret, like the client secret: which one is set (a fingerprint), never its value.
  function signingRowOf(doc, fromSettings, admin, source) {
    if (admin && doc.signingSecret) {
      const readable = Boolean(signingOf(doc))
      return { hasSecret: readable, secretSource: readable ? 'admin' : null, secretFingerprint: readable ? doc.signingFingerprint ?? null : null, ...(!readable && { secretUnreadable: true }) }
    }
    if (fromSettings?.signingSecret && (source === 'settings' || fromSettings.clientId === doc?.clientId))
      return { hasSecret: true, secretSource: 'settings', secretFingerprint: keyFingerprint(fromSettings.signingSecret) }
    return { hasSecret: false, secretSource: null, secretFingerprint: null }
  }

  /** Every known provider: its client id, whether a secret is set (fingerprint), where each comes from. */
  async function list() {
    const settings = settingsNow()
    const docs = new Map(((await rows.all()) || []).map((doc) => [doc._id, doc]))
    return {
      apps: APP_PROVIDERS.map((provider) => rowOf(provider, docs.get(provider), settings)),
      redirectUrl: redirectUriFor(origin()),
      secretsAvailable: Boolean(master),
    }
  }

  function checkProvider(provider) {
    if (provider === 'google') throw refuse(400, 'invalid_request', 'Google\'s app is set in the settings file (connectors.oauthApps.google, and googleDocs.web for Drive), not here.')
    if (!EDITABLE_PROVIDERS.includes(provider)) throw refuse(404, 'not_found', `There is no integration app ${provider}.`)
  }

  function checkText(value, what) {
    if (value === undefined || value === null) return undefined
    const text = typeof value === 'string' ? value.trim() : value
    if (typeof text !== 'string' || !CLIENT_TEXT.test(text)) throw refuse(400, 'invalid_request', `Paste the ${what} on one line, with no spaces (at most 500 characters).`)
    return text
  }

  /**
   * Saves a provider's client id and/or secret (sealed), and Slack's signing secret. A new client id
   * without a new secret drops the saved secrets (they belonged to the old client). → the provider's row
   */
  async function set({ actor, provider, clientId, clientSecret, signingSecret }) {
    checkProvider(provider)
    const id = checkText(clientId, 'client id')
    const secret = checkText(clientSecret, 'client secret')
    const signing = checkText(signingSecret, 'signing secret')
    if (signing !== undefined && !hasSigning(provider)) throw refuse(400, 'invalid_request', `${nameOf(provider)} has no signing secret.`)
    if (id === undefined && secret === undefined && signing === undefined) throw refuse(400, 'invalid_request', 'Enter a client id, a client secret or both.')
    if ((secret !== undefined || signing !== undefined) && !master) throw refuse(503, 'unavailable', NO_MASTER)
    const before = await rows.get(provider)
    const nextId = id ?? before?.clientId ?? null
    if (!nextId) throw refuse(400, 'invalid_request', 'Enter the client id too.')
    const at = new Date(now())
    const doc = {
      _id: provider,
      clientId: nextId,
      secret: before?.secret ?? null,
      secretFingerprint: before?.secretFingerprint ?? null,
      ...(hasSigning(provider) && { signingSecret: before?.signingSecret ?? null, signingFingerprint: before?.signingFingerprint ?? null }),
      createdAt: before?.createdAt ?? at,
      createdBy: before?.createdBy ?? actor?.userId ?? null,
      updatedAt: at,
      updatedBy: actor?.userId ?? null,
    }
    if (secret !== undefined) Object.assign(doc, { secret: seal({ master, owner: ownerOf(provider), plaintext: secret }), secretFingerprint: keyFingerprint(secret) })
    else if (before && before.clientId !== nextId) Object.assign(doc, { secret: null, secretFingerprint: null })
    if (signing !== undefined) Object.assign(doc, { signingSecret: seal({ master, owner: signingOwnerOf(provider), plaintext: signing }), signingFingerprint: keyFingerprint(signing) })
    else if (hasSigning(provider) && before && before.clientId !== nextId) Object.assign(doc, { signingSecret: null, signingFingerprint: null })
    await rows.put(provider, doc)
    forget()
    await record({ action: 'connectors.apps.set', actor, target: { kind: 'integration-app', id: provider }, before: publicApp(before), after: publicApp(doc) })
    return rowOf(provider, doc, settingsNow())
  }

  /** Forgets what an administrator entered for a provider: the settings file's app (if any) serves again. */
  async function clear({ actor, provider, reason = null }) {
    checkProvider(provider)
    const before = await rows.get(provider)
    if (before) {
      await rows.remove(provider)
      forget()
      await record({ action: 'connectors.apps.clear', actor, target: { kind: 'integration-app', id: provider }, before: publicApp(before), after: null, reason })
    }
    return rowOf(provider, null, settingsNow())
  }

  /** The Slack app's manifest for this server: paste it at api.slack.com/apps, install, enter three values here. */
  const manifest = () => ({ manifest: slackManifest({ origin: origin() }), redirectUrl: redirectUriFor(origin()) })

  return { apps, list, set, clear, forget, manifest, hasMaster: () => Boolean(master) }
}

const ROW_OUT = {
  type: 'object',
  description: 'One provider: provider, name, editable (false for Google: settings only), source (admin, settings or none: where the client id in use comes from), clientId (public), settingsClientId, hasSecret, secretSource (admin or settings), secretFingerprint (sha256:12345678…WXYZ, never the secret), secretUnreadable (saved under another key-encryption key: enter it again), adminSaved, updatedAt, updatedBy, console { label, url } (where the vendor\'s apps are registered), and for Slack signing { hasSecret, secretSource, secretFingerprint } (its signing secret, never the value).',
}
const PROVIDER_IN = { type: 'string', pattern: '^[a-z][a-z0-9-]{1,30}$', description: 'The provider, as connectors.apps.list gives it (asana, hubspot, box, zoom, pitch, salesforce, microsoft, github, slack, linear).' }
const TEXT_IN = (what) => ({ type: 'string', minLength: 1, maxLength: 600, description: `The ${what}, one line.` })
const personOnly = () => 'Only a person enters or clears an integration app.'

/** The admin actions, over a getter for the running store (set at server start). */
export function integrationAppActions(store) {
  return [
    defineAction({
      id: 'connectors.apps.list',
      title: 'Integration apps',
      description: 'Lists the OAuth app of each known provider (Asana, HubSpot, Box, Zoom, Pitch, Salesforce, Microsoft, GitHub, Slack, and Google read-only): its client id, whether a client secret is set (a fingerprint, never the secret; for Slack its signing secret too), whether each comes from Admin or the settings file, who changed it and when, where to register the app, and the redirect URL to give the vendor. Administrators only.',
      toolset: 'admin',
      kind: 'read',
      scope: 'ai:admin:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/integration-apps', operationId: 'listIntegrationApps' } },
      tool: { name: 'list_integration_apps', title: 'List integration apps', description: 'List the OAuth apps this server signs people in to outside tools with: client ids and secret fingerprints, never secrets. Administrators only.' },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: { apps: { type: 'array', items: ROW_OUT }, redirectUrl: { type: 'string' }, secretsAvailable: { type: 'boolean' } } },
      handler: async (principal, _input, { deps }) => {
        await requireAIControlAdmin(principal, deps, 'read integration apps')
        return { status: 200, body: await store().list() }
      },
    }),
    defineAction({
      id: 'connectors.apps.set',
      title: 'Save integration app',
      description: 'Saves a provider\'s OAuth client id and/or client secret. The secret is stored encrypted and never returned. These win over the settings file at once, without a restart. A new client id without a new secret drops the saved secret. Audited. A person only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      confirm: true,
      idempotent: true,
      idempotency: 'optional',
      replay: 'rerun',
      successStatus: 200,
      input: { type: 'object', properties: { provider: PROVIDER_IN, clientId: TEXT_IN('client id'), clientSecret: TEXT_IN('client secret'), signingSecret: { ...TEXT_IN('signing secret (Slack and Linear only)'), writeOnly: true } }, required: ['provider'], additionalProperties: false },
      output: ROW_OUT,
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'connectors.apps.set', target: { kind: 'integration-app', id: input.provider }, doing: 'change integration apps', refusal: personOnly })
        return { status: 200, body: await store().set({ actor, provider: input.provider, clientId: input.clientId, clientSecret: input.clientSecret, signingSecret: input.signingSecret }) }
      },
    }),
    defineAction({
      id: 'connectors.apps.slackManifest',
      title: 'Slack app manifest',
      description: 'The manifest to create this server\'s Slack app with (api.slack.com/apps › Create New App › From a manifest): this server\'s address in every URL and domain. Then install the app and enter its client id, client secret and signing secret in Integration apps. Read-only. Administrators only.',
      toolset: 'admin',
      kind: 'read',
      scope: 'ai:admin:read',
      principals: ['person', 'agent'],
      mounts: { ddp: true },
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object', properties: { manifest: { type: 'object' }, redirectUrl: { type: 'string' } } },
      handler: async (principal, _input, { deps }) => {
        await requireAIControlAdmin(principal, deps, 'read the Slack app manifest')
        return { status: 200, body: store().manifest() }
      },
    }),
    defineAction({
      id: 'connectors.apps.clear',
      title: 'Clear integration app',
      description: 'Forgets the client id and secret an administrator entered for a provider; the settings file\'s app, if any, is used again. Audited. A person only. Administrators only.',
      toolset: 'admin',
      kind: 'write',
      scope: 'ai:admin',
      principals: ['person'],
      mounts: { ddp: true },
      confirm: true,
      destructive: true,
      idempotent: true,
      idempotency: 'optional',
      replay: 'rerun',
      successStatus: 200,
      input: { type: 'object', properties: { provider: PROVIDER_IN, reason: { type: 'string', maxLength: 500 } }, required: ['provider'], additionalProperties: false },
      output: ROW_OUT,
      handler: async (principal, input, { deps }) => {
        const actor = await guardControlWrite(principal, deps, { action: 'connectors.apps.clear', target: { kind: 'integration-app', id: input.provider }, doing: 'change integration apps', reason: input.reason ?? null, refusal: personOnly })
        return { status: 200, body: await store().clear({ actor, provider: input.provider, reason: input.reason ?? null }) }
      },
    }),
  ]
}
