// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Slatebox GitHub App's credentials: settings.connectors.githubApp
//   { appId, slug, clientId, clientSecret, privateKey, webhookSecret, apiUrl?, webUrl? }
// or what an administrator entered in Admin › Integration apps › GitHub App (one document,
// githubAppSettings _id 'app'; the secret parts sealed with the vault, bound to this use; never
// returned, only fingerprints). The document wins over the settings file.
//
// Slatebox Cloud registers one public App (the owner, once). A self-hosted install makes its own in
// one click with GitHub's App manifest flow: manifestFor() gives the form the admin's browser posts
// to GitHub (github.com/settings/apps/new, or an organization's), GitHub sends the browser back to
// /integrations/github/manifest/callback with a code, and finishManifest() exchanges it once for the
// new App's id, key and secrets, stored sealed. The flow's state is single use, ten minutes.
import { randomBytes } from 'node:crypto'
import { open as openSecret, seal } from '/server/metering/vault.mjs'
import { keyFingerprint } from '/server/ai-control/keys.mjs'
import { GITHUB_API, USER_AGENT } from './app.mjs'

export const MANIFEST_CALLBACK_PATH = '/integrations/github/manifest/callback'
const SECRET_FIELDS = ['clientSecret', 'privateKey', 'webhookSecret']
const PUBLIC_FIELDS = ['appId', 'slug', 'clientId', 'apiUrl', 'webUrl']
const OWNER = (field) => ({ ownerType: 'server', ownerId: 'github-app', provider: field })
const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })

const TEXT = /^[\x21-\x7e]{1,200}$/
const PEM = /^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]{100,8000}-----END (RSA )?PRIVATE KEY-----\s*$/

/** The App's manifest for this Slatebox address (the permissions and events the recipes need). */
export function appManifest(origin, { name = 'Slatebox' } = {}) {
  const at = (path) => new URL(path, origin).href
  return {
    name: `${name}`.slice(0, 34),
    url: origin,
    hook_attributes: { url: at('/integrations/github/events'), active: true },
    redirect_url: at(MANIFEST_CALLBACK_PATH),
    callback_urls: [at('/integrations/github/installed')],
    setup_url: at('/integrations/github/installed'),
    setup_on_update: true,
    request_oauth_on_install: true,
    public: false,
    // contents:write is used only for diagram pull requests a person allows per recipe (the standing permission).
    default_permissions: { metadata: 'read', contents: 'write', pull_requests: 'write', checks: 'write' },
    default_events: ['push', 'pull_request'],
  }
}

/**
 * deps: { rows: { get(), put(doc), remove() }, master (vault key or null), settings() → settings.connectors.githubApp,
 *         flows: { put(state, value, expiresAt), take(state) → value|null }, fetch, audit?(entry), now?, origin() }
 */
export function createGithubAppSettings({ rows, master, settings = () => ({}), flows, fetch = globalThis.fetch, audit = null, now = () => Date.now(), origin = () => '' }) {
  const unseal = (doc, field) => {
    if (!doc?.[field] || !master) return null
    try {
      return openSecret({ master, owner: OWNER(field), cipher: doc[field] })
    } catch {
      return null
    }
  }

  /** The credentials in use (secrets included: for this module's callers on the server only). */
  async function credentials() {
    const file = settings() || {}
    const doc = await rows.get()
    const out = { apiUrl: GITHUB_API, webUrl: 'https://github.com' }
    for (const f of PUBLIC_FIELDS) if (file[f]) out[f] = String(file[f])
    for (const f of SECRET_FIELDS) if (file[f]) out[f] = String(file[f])
    if (doc) {
      for (const f of PUBLIC_FIELDS) if (doc[f]) out[f] = doc[f]
      for (const f of SECRET_FIELDS) {
        const v = unseal(doc, f)
        if (v) out[f] = v
      }
    }
    return out
  }

  /** What anyone may see: ids and fingerprints, never a secret. */
  async function view() {
    const c = await credentials()
    const doc = await rows.get()
    return {
      appId: c.appId ?? null, slug: c.slug ?? null, clientId: c.clientId ?? null, apiUrl: c.apiUrl,
      ready: Boolean(c.appId && c.privateKey && c.webhookSecret && c.clientId && c.clientSecret && c.slug),
      fingerprints: Object.fromEntries(SECRET_FIELDS.map((f) => [f, c[f] ? keyFingerprint(c[f]) : null])),
      source: doc ? 'admin' : c.appId ? 'settings' : 'none',
      installUrl: c.slug ? `${c.webUrl}/apps/${encodeURIComponent(c.slug)}/installations/new` : null,
      secretsAvailable: Boolean(master),
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: doc?.updatedBy ?? null,
    }
  }

  async function record(entry) {
    if (audit) await Promise.resolve(audit(entry)).catch(() => {})
  }

  async function set({ actor, values }) {
    if (!master) throw refuse(503, 'unavailable', 'Set SLATEBOX_KEY_ENCRYPTION_KEY on this server to store the GitHub App\'s secrets.')
    const before = (await rows.get()) || {}
    const doc = { ...before, _id: 'app', updatedAt: new Date(now()), updatedBy: actor?.userId ?? null }
    for (const f of PUBLIC_FIELDS) {
      if (values[f] === undefined) continue
      const v = `${values[f]}`.trim()
      if (f.endsWith('Url') ? !/^https:\/\/[\w.-]+(\/[\w./-]*)?$/.test(v) : !TEXT.test(v)) throw refuse(400, 'invalid_request', `Paste the ${f} on one line.`)
      doc[f] = v
    }
    for (const f of SECRET_FIELDS) {
      if (values[f] === undefined) continue
      const v = `${values[f]}`.trim().replace(/\r\n?/g, '\n')
      if (f === 'privateKey' ? !PEM.test(v) : !TEXT.test(v)) throw refuse(400, 'invalid_request', f === 'privateKey' ? 'Paste the App\'s private key (.pem), whole.' : `Paste the ${f} on one line.`)
      doc[f] = seal({ master, owner: OWNER(f), plaintext: v })
    }
    await rows.put(doc)
    await record({ action: 'connectors.githubApp.set', actor, target: { kind: 'integration-app', id: 'github-app' }, after: { fields: Object.keys(values).sort() } })
    return view()
  }

  async function clear({ actor }) {
    await rows.remove()
    await record({ action: 'connectors.githubApp.clear', actor, target: { kind: 'integration-app', id: 'github-app' } })
    return view()
  }

  /** The manifest form for the admin's browser: { action, manifest (JSON text), state }. */
  async function manifestFor({ actor, org = null }) {
    const state = randomBytes(24).toString('base64url')
    await flows.put(state, { userId: actor?.userId ?? null }, new Date(now() + 10 * 60 * 1000))
    const c = await credentials()
    const base = org ? `${c.webUrl}/organizations/${encodeURIComponent(org)}/settings/apps/new` : `${c.webUrl}/settings/apps/new`
    return { action: `${base}?state=${state}`, manifest: JSON.stringify(appManifest(origin())), state }
  }

  /** GitHub's code back, exchanged once for the new App's credentials (stored sealed). */
  async function finishManifest({ code, state }) {
    const flow = typeof state === 'string' ? await flows.take(state) : null
    if (!flow) throw refuse(400, 'invalid_request', 'That setup link expired. Start again from Admin › Integration apps.')
    if (typeof code !== 'string' || !/^[\w-]{1,100}$/.test(code)) throw refuse(400, 'invalid_request', 'GitHub sent no code.')
    const c = await credentials()
    const res = await fetch(`${c.apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': USER_AGENT },
    })
    if (!res.ok) throw refuse(502, 'github_failed', `GitHub answered ${res.status}.`)
    const app = await res.json()
    return set({
      actor: { kind: 'person', userId: flow.userId },
      values: { appId: String(app.id), slug: app.slug, clientId: app.client_id, clientSecret: app.client_secret, privateKey: app.pem, webhookSecret: app.webhook_secret },
    })
  }

  return { credentials, view, set, clear, manifestFor, finishManifest }
}

/** The App's OAuth: a code from the install callback exchanged for the person's token (not kept). */
export function appOAuth({ credentials, fetch = globalThis.fetch }) {
  return {
    async exchange(code) {
      const c = await credentials()
      if (!c.clientId || !c.clientSecret) throw refuse(503, 'github_app_missing', 'The GitHub App is not set up on this server.')
      const res = await fetch(`${c.webUrl}/login/oauth/access_token`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ client_id: c.clientId, client_secret: c.clientSecret, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.access_token !== 'string') throw refuse(401, 'sign_in_needed', 'GitHub did not confirm the sign-in.')
      return data.access_token
    },
  }
}
