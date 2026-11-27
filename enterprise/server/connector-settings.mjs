// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// settings.connectors (server-only), all optional:
//   devOrigins   exact http origins on this machine an outside-agent test may reach, such as
//                ["http://127.0.0.1:8765"] for scripts/mcp-test-servers.mjs. Kept only when
//                settings.public.env is exactly 'dev' AND the server runs in development
//                (Meteor.isDevelopment): a missing, misspelt or other env drops them (fail closed).
//   userAgent    the User-Agent sent to outside servers (default MCP_USER_AGENT).
//   oauthApps    apps Slatebox registered with a vendor ahead of time, per provider:
//                { "github": { "clientId": "...", "clientSecret": "..." } }
//                A known provider (oauth.mjs KNOWN_PROVIDERS: github, slack, asana, hubspot, box,
//                zoom, pitch, salesforce, microsoft, google) brings its own issuer, its scopes and
//                the only MCP servers its sign-in is sent to; "scopes" overrides the scopes,
//                "resources" (https origins) adds servers. Any other
//                provider name must also give "issuer" (https; a devOrigins origin in local
//                development only) and "resources", or its sign-in is never used. The client id
//                is public; the secret is never in code. An administrator can also enter a known
//                provider's client id and secret in Admin › AI control › Integration apps
//                (integration-apps.mjs): the secret is then stored encrypted with the vault, those
//                values win over these, and these stay the fallback. Google is the exception: its
//                apps are settings only (oauthApps.google, and googleDocs.web for Drive).
// The vault's master key is not a setting: it is SLATEBOX_KEY_ENCRYPTION_KEY in the environment
// (web/app/server/metering/vault.mjs), the same key the app already uses. Without it, servers that
// need sign-in are not offered.
import { MCP_USER_AGENT } from './mcp-fetch.mjs'
import { KNOWN_PROVIDERS } from './oauth.mjs'

const ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/
const PROVIDER = /^[a-z][a-z0-9-]{1,30}$/
// A client id or secret: one line of visible ASCII, at most 500 characters (settings and admin alike).
export const CLIENT_TEXT = /^[\x21-\x7e]{1,500}$/

function appsOf(raw, devOrigins) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, app] of Object.entries(raw)) {
    if (!PROVIDER.test(name) || !app || typeof app !== 'object') continue
    if (typeof app.clientId !== 'string' || !CLIENT_TEXT.test(app.clientId)) continue
    const entry = { clientId: app.clientId }
    if (typeof app.clientSecret === 'string' && CLIENT_TEXT.test(app.clientSecret)) entry.clientSecret = app.clientSecret
    // The MCP servers (origins) this app's sign-in may be sent to; a known provider brings its own.
    if (Array.isArray(app.resources)) {
      const resources = app.resources.filter((r) => {
        try {
          const url = new URL(r)
          return url.protocol === 'https:' || devOrigins.includes(url.origin)
        } catch {
          return false
        }
      }).slice(0, 16)
      if (resources.length) entry.resources = resources
    }
    if (Array.isArray(app.scopes)) entry.scopes = app.scopes.filter((s) => typeof s === 'string' && /^[\x21-\x7e]{1,100}$/.test(s)).slice(0, 24)
    if (!KNOWN_PROVIDERS[name]) {
      let issuer = null
      try {
        issuer = typeof app.issuer === 'string' ? new URL(app.issuer) : null
      } catch {}
      if (!issuer || !(issuer.protocol === 'https:' || devOrigins.includes(issuer.origin))) continue
      entry.issuer = app.issuer
    }
    out[name] = entry
  }
  return out
}

export function connectorSettings(settings = {}, { development = false } = {}) {
  const raw = settings.connectors || {}
  const local = settings.public?.env === 'dev' && development === true
  const devOrigins = !local ? [] : (Array.isArray(raw.devOrigins) ? raw.devOrigins : []).filter((origin) => typeof origin === 'string' && ORIGIN.test(origin))
  const userAgent = typeof raw.userAgent === 'string' && /^[\x20-\x7e]{8,200}$/.test(raw.userAgent) ? raw.userAgent : MCP_USER_AGENT
  return { devOrigins, userAgent, oauthApps: appsOf(raw.oauthApps, devOrigins) }
}
