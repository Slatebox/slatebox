// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Slatebox GitHub App's own credentials at work: a JWT signed RS256 with the App's private key
// (node:crypto, no dependency), exchanged for an installation token at
// POST /app/installations/{id}/access_tokens. Tokens are cached per installation until five minutes
// before they expire (GitHub gives an hour), and forgotten on a 401. The private key and tokens
// never leave this module's memory: no log line carries them.
import { createSign } from 'node:crypto'

export const GITHUB_API = 'https://api.github.com'
export const USER_AGENT = 'Slatebox-Recipes (+https://slatebox.com)'
const EARLY_MS = 5 * 60 * 1000

const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

/** The App's JWT: issued a minute in the past (clock drift), valid nine minutes, issuer the App id. */
export function appJwt({ appId, privateKey, now = Date.now() }) {
  if (!appId || !privateKey) throw Object.assign(new Error('The GitHub App is not set up on this server.'), { code: 'github_app_missing', status: 503 })
  const iat = Math.floor(now / 1000) - 60
  const head = b64url({ alg: 'RS256', typ: 'JWT' })
  const body = b64url({ iat, exp: iat + 600, iss: String(appId) })
  const signer = createSign('RSA-SHA256')
  signer.update(`${head}.${body}`)
  return `${head}.${body}.${signer.sign(privateKey).toString('base64url')}`
}

/** A GitHub REST call with the App's JWT (installation lookups only). */
const baseOf = async (apiBase) => (typeof apiBase === 'function' ? (await apiBase()) || GITHUB_API : apiBase)

async function appCall({ fetch, apiBase, credentials, now }, method, path, body) {
  const creds = await credentials()
  const res = await fetch(`${await baseOf(apiBase)}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${appJwt({ ...creds, now: now() })}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': USER_AGENT,
      ...(body && { 'content-type': 'application/json' }),
    },
    ...(body && { body: JSON.stringify(body) }),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}.`), { status: res.status, code: res.status === 404 ? 'github_installation_gone' : 'github_failed' })
  return data
}

/**
 * Installation tokens. deps: { fetch, apiBase? (text or a function giving it), credentials() → { appId, privateKey }, now? }
 * → { token(installationId) → string, forget(installationId), installation(id) → GitHub's record }
 */
export function createInstallationTokens({ fetch = globalThis.fetch, apiBase = GITHUB_API, credentials, now = () => Date.now() }) {
  const cache = new Map()
  const pending = new Map()
  const deps = { fetch, apiBase, credentials, now }
  async function mint(installationId) {
    const data = await appCall(deps, 'POST', `/app/installations/${encodeURIComponent(installationId)}/access_tokens`)
    if (!data?.token) throw Object.assign(new Error('GitHub gave no installation token.'), { code: 'github_failed', status: 502 })
    const expires = Date.parse(data.expires_at) || now() + 3600 * 1000
    cache.set(String(installationId), { token: data.token, refreshAt: expires - EARLY_MS })
    return data.token
  }
  return {
    async token(installationId) {
      const key = String(installationId)
      const hit = cache.get(key)
      if (hit && now() < hit.refreshAt) return hit.token
      if (!pending.has(key)) pending.set(key, mint(key).finally(() => pending.delete(key)))
      return pending.get(key)
    },
    forget(installationId) {
      cache.delete(String(installationId))
    },
    installation: (installationId) => appCall(deps, 'GET', `/app/installations/${encodeURIComponent(installationId)}`),
    size: () => cache.size,
  }
}

/** The installations a person's GitHub sign-in (the App's user-to-server token) can see. → [{ id, account }] */
export async function userInstallations({ fetch = globalThis.fetch, apiBase = GITHUB_API, userToken }) {
  const out = []
  for (let page = 1; page <= 5; page += 1) {
    const res = await fetch(`${await baseOf(apiBase)}/user/installations?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${userToken}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': USER_AGENT },
    })
    if (res.status === 401) throw Object.assign(new Error('Sign in to GitHub again.'), { name: 'SignInNeeded', code: 'sign_in_needed', status: 401 })
    if (!res.ok) throw Object.assign(new Error(`GitHub answered ${res.status}.`), { status: res.status, code: 'github_failed' })
    const data = await res.json()
    for (const i of data.installations || []) out.push({ id: i.id, account: i.account?.login ?? null })
    if ((data.installations || []).length < 100) break
  }
  return out
}
