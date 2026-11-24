// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// settings.connectors (server-only), all optional:
//   devOrigins   exact http origins on this machine an outside-agent test may reach, such as
//                ["http://127.0.0.1:8765"] for scripts/mcp-test-servers.mjs. Dropped whenever
//                settings.public.env is 'prod' or 'test', so a deployed Slatebox never allows them.
//   userAgent    the User-Agent sent to outside servers (default MCP_USER_AGENT).
//   oauthApps    apps Slatebox registered with a vendor ahead of time, per provider:
//                { "github": { "clientId": "...", "clientSecret": "..." } }
//                A known provider (oauth.mjs KNOWN_PROVIDERS: github) brings its own issuer and
//                minimal scopes; "scopes" overrides them. Any other provider name must also give
//                "issuer" (https; a devOrigins origin in local development only). The client id
//                is public; the secret lives only here (or the environment that fills settings),
//                never in code or the database.
// The vault's master key is not a setting: it is SLATEBOX_KEY_ENCRYPTION_KEY in the environment
// (web/app/server/metering/vault.mjs), the same key the app already uses. Without it, servers that
// need sign-in are not offered.
import { MCP_USER_AGENT } from './mcp-fetch.mjs'
import { KNOWN_PROVIDERS } from './oauth.mjs'

const ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{2,5}$/
const PROVIDER = /^[a-z][a-z0-9-]{1,30}$/

function appsOf(raw, devOrigins) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [name, app] of Object.entries(raw)) {
    if (!PROVIDER.test(name) || !app || typeof app !== 'object') continue
    if (typeof app.clientId !== 'string' || !/^[\x21-\x7e]{1,500}$/.test(app.clientId)) continue
    const entry = { clientId: app.clientId }
    if (typeof app.clientSecret === 'string' && /^[\x21-\x7e]{1,500}$/.test(app.clientSecret)) entry.clientSecret = app.clientSecret
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

export function connectorSettings(settings = {}) {
  const raw = settings.connectors || {}
  const deployed = ['prod', 'test'].includes(settings.public?.env)
  const devOrigins = deployed ? [] : (Array.isArray(raw.devOrigins) ? raw.devOrigins : []).filter((origin) => typeof origin === 'string' && ORIGIN.test(origin))
  const userAgent = typeof raw.userAgent === 'string' && /^[\x20-\x7e]{8,200}$/.test(raw.userAgent) ? raw.userAgent : MCP_USER_AGENT
  return { devOrigins, userAgent, oauthApps: appsOf(raw.oauthApps, devOrigins) }
}
