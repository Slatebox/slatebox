// Slatebox Cloud, for team addresses (https://<name>.slatebox.team): the device-code sign-in
// (RFC 8628, like `gh auth login`), the team-address API, and the install credential that stays
// on this computer.
//
// What goes where:
//   - The person's sign-in token lives in memory for one command and is never written anywhere.
//   - The install credential (sbxi_…) is written to ~/.slatebox/installs/<name>/credentials.json,
//     mode 0600 in a 0700 folder, and never leaves this computer (not to a server over SSH, not
//     into a container). It can fetch this install's own tunnel token and release its own address,
//     and nothing else.
//   - The tunnel connector token goes only into the install's secrets (secrets.env or the
//     Kubernetes Secret). Slatebox Cloud never stores it; it asks Cloudflare each time.
//
// The base URL is https://app.slatebox.com unless SLATEBOX_CLOUD_URL or --cloud-url says
// otherwise (a local claim service for tests). Plain http:// is accepted only for loopback.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { EXIT, InstallError } from './errors.mjs'
import { installDir } from './record.mjs'

export const DEFAULT_CLOUD = 'https://app.slatebox.com'
export const TEAM_ZONE = 'slatebox.team'
export const CLI_CLIENT_ID = 'slatebox-cli'
export const TEAM_SCOPE = 'team-addresses'
export const CREDENTIALS_FILE = 'credentials.json'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

// ------------------------------------------------------------------ names

// 3-32 characters, a-z 0-9 and hyphens, starting with a letter, not ending with a hyphen, and
// never two hyphens in a row (which also rules out xn-- punycode). The server holds the same rule
// plus the reserved and blocked lists; this is only so a typo is caught before any network call.
export const TEAM_ADDRESS_RULE = '3–32 characters: a–z, 0–9 and hyphens, starting with a letter, not ending with a hyphen (no two hyphens in a row)'
const TEAM_ADDRESS = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/

export function teamAddressProblem(name) {
  const text = String(name ?? '')
  if (!TEAM_ADDRESS.test(text) || text.includes('--')) return TEAM_ADDRESS_RULE
  return null
}

export const teamHost = name => `${name}.${TEAM_ZONE}`
export const teamUrl = name => `https://${teamHost(name)}`

// ------------------------------------------------------------------ base URL

export function cloudBase(ctx) {
  const raw = ctx.flags?.['cloud-url'] || ctx.env?.SLATEBOX_CLOUD_URL || DEFAULT_CLOUD
  let url
  try { url = new URL(raw) } catch { throw new InstallError(EXIT.USAGE, `SLATEBOX_CLOUD_URL (or --cloud-url) is not a URL: ${raw}`) }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new InstallError(EXIT.USAGE, 'SLATEBOX_CLOUD_URL must be https:// (plain http:// only for localhost).')
  }
  if (url.username || url.password || url.search || url.hash) throw new InstallError(EXIT.USAGE, 'SLATEBOX_CLOUD_URL is an origin, with nothing after the host.')
  return url.origin
}

// ------------------------------------------------------------------ errors

/** An answer from Slatebox Cloud that is not a success: {error: {code, message}}. */
export class CloudError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message || code || `HTTP ${status}`)
    this.status = status
    this.code = code || `http_${status}`
    Object.assign(this, extra)
  }
}

function offline(base, error) {
  const host = new URL(base).host
  const why = error?.cause?.code || error?.code || error?.name || error?.message || 'no answer'
  return new InstallError(EXIT.PRECONDITION,
    `Slatebox Cloud (${host}) can't be reached: ${why}.\n` +
    '  A team address is claimed online. Nothing was changed.\n' +
    '  Run this again when you\'re online, or install without one:\n' +
    '    npx slatebox install --local\n' +
    '    npx slatebox install --domain boards.example.com',
    { id: 'cloud-unreachable', cloud: host })
}

// ------------------------------------------------------------------ client

/**
 * @param {object} ctx run context: fetch, redactor
 * @param {string} base Cloud origin
 */
export function cloudClient(ctx, base) {
  const fetchImpl = ctx.fetch || globalThis.fetch

  async function call(method, path, { bearer, body, form, headers = {}, timeout = 20_000 } = {}) {
    const init = { method, headers: { accept: 'application/json', 'user-agent': `slatebox-cli/${ctx.version || '0'}`, ...headers }, redirect: 'error', signal: AbortSignal.timeout(timeout) }
    if (bearer) init.headers.authorization = `Bearer ${bearer}`
    if (form) {
      init.headers['content-type'] = 'application/x-www-form-urlencoded'
      init.body = new URLSearchParams(form).toString()
    } else if (body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    let response
    try {
      response = await fetchImpl(`${base}${path}`, init)
    } catch (error) {
      throw offline(base, error)
    }
    let data = null
    const text = typeof response.text === 'function' ? await response.text().catch(() => '') : JSON.stringify(await response.json?.().catch(() => null))
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    if (response.status >= 200 && response.status < 300) return data ?? {}
    // OAuth errors are {error: "code", error_description}; the API's are {error: {code, message}}.
    const error = data?.error
    const code = typeof error === 'string' ? error : error?.code
    const message = typeof error === 'string' ? data?.error_description : error?.message
    const retryAfter = Number(response.headers?.get?.('retry-after')) || undefined
    throw new CloudError(response.status, code, message, { retryAfter, suggestions: data?.suggestions || error?.suggestions, notice: error?.notice })
  }

  const api = path => `/api/v1/team-addresses${path}`
  const enc = encodeURIComponent

  return {
    base,
    // --- sign-in (RFC 8628)
    deviceAuthorize: label => call('POST', '/oauth/device_authorization', { form: { client_id: CLI_CLIENT_ID, scope: TEAM_SCOPE, device_label: label } }),
    deviceToken: deviceCode => call('POST', '/oauth/token', { form: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLI_CLIENT_ID } }),
    // --- the signed-in person's team addresses
    availability: (name, bearer) => call('GET', api(`/availability?name=${enc(name)}`), { bearer }),
    claim: (bearer, { name, clientKey, label, idempotencyKey }) => call('POST', api(''), { bearer, body: { name, clientKey, label }, headers: { 'idempotency-key': idempotencyKey }, timeout: 120_000 }),
    list: bearer => call('GET', api(''), { bearer }),
    rename: (bearer, id, name) => call('POST', api(`/${enc(id)}/rename`), { bearer, body: { name }, timeout: 120_000 }),
    release: (bearer, id) => call('DELETE', api(`/${enc(id)}`), { bearer, timeout: 120_000 }),
    mintCredential: (bearer, id) => call('POST', api(`/${enc(id)}/install-credential`), { bearer }),
    // --- this install, with its install credential
    self: credential => call('GET', api('/self'), { bearer: credential }),
    connectorToken: (credential, { rotate = false } = {}) => call('POST', api('/self/connector-token'), { bearer: credential, body: { rotate }, timeout: 120_000 }),
    renameComplete: credential => call('POST', api('/self/rename-complete'), { bearer: credential, body: {}, timeout: 120_000 }),
    releaseSelf: credential => call('DELETE', api('/self'), { bearer: credential, timeout: 120_000 }),
  }
}

// ------------------------------------------------------------------ sign-in

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** A short, printable name for this computer, shown on the consent page. */
export function deviceLabel() {
  return hostname().replace(/[^\x20-\x7e]/g, '').slice(0, 64) || 'this computer'
}

/** Open a URL in the person's browser. Failure is fine: the code and link are printed anyway. */
export function openBrowser(url, platform = process.platform) {
  const [cmd, args] = platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch { /* printed anyway */ }
}

/**
 * Sign in to Slatebox Cloud for the team-addresses scope only. Returns an access token that lives
 * 15 minutes and is kept in memory. A personal access token in SLATEBOX_CLOUD_TOKEN (with the
 * team-addresses scope) skips the browser, for CI and agents that a person set up.
 */
export async function signIn(ctx, cloud, { purpose = 'claim a team address' } = {}) {
  const pat = ctx.env?.SLATEBOX_CLOUD_TOKEN
  if (pat) {
    ctx.redactor.add(pat)
    return pat
  }
  const label = ctx.deviceLabel || deviceLabel()
  const grant = await cloud.deviceAuthorize(label).catch(error => { throw signInFailed(error, cloud) })
  if (!grant?.device_code || !grant?.user_code || !grant?.verification_uri) throw new InstallError(EXIT.PRECONDITION, `Slatebox Cloud (${new URL(cloud.base).host}) did not start a sign-in.`)
  ctx.redactor.add(grant.device_code)
  // Only a link on the Cloud's own origin is opened or printed.
  const sameOrigin = link => { try { return new URL(link).origin === cloud.base } catch { return false } }
  const page = sameOrigin(grant.verification_uri) ? grant.verification_uri : `${cloud.base}/device`
  const complete = sameOrigin(grant.verification_uri_complete) ? grant.verification_uri_complete : null
  const minutes = Math.max(1, Math.round((grant.expires_in || 600) / 60))
  ctx.out.event({ event: 'sign-in', status: 'waiting', verificationUri: page, userCode: grant.user_code, expiresIn: grant.expires_in || 600 })
  const lines = ['', `Sign in to Slatebox to ${purpose}.`, `  Open:  ${page}`, `  Code:  ${grant.user_code}`]
  if (ctx.interactive) {
    lines.push(`  (The code expires in ${minutes} minutes.)`)
    ctx.stderr.write(`${lines.join('\n')}\n`)
    if (await ctx.prompt.confirm('Open it in your browser now?', { default: true })) (ctx.openBrowser || openBrowser)(complete || page, ctx.platform)
  } else {
    lines.push(`  (The code expires in ${minutes} minutes. Approve it in a browser where you are signed in to Slatebox.)`)
    ctx.stderr.write(`${lines.join('\n')}\n`)
  }
  ctx.stderr.write('... waiting for approval\n')
  let interval = Math.max(1, Number(grant.interval) || 5) * 1000
  const deadline = Date.now() + (grant.expires_in || 600) * 1000
  const wait = ctx.sleep || sleep
  for (;;) {
    await wait(interval)
    try {
      const token = await cloud.deviceToken(grant.device_code)
      if (!token?.access_token) throw new InstallError(EXIT.PRECONDITION, 'Slatebox Cloud approved the sign-in but sent no token.')
      ctx.redactor.add(token.access_token)
      ctx.out.event({ event: 'sign-in', status: 'ok' })
      return token.access_token
    } catch (error) {
      if (!(error instanceof CloudError)) throw error
      if (error.code === 'authorization_pending') { /* keep waiting */ } else if (error.code === 'slow_down') interval += 5000
      else if (error.code === 'access_denied') throw new InstallError(EXIT.CANCELLED, 'The sign-in was denied in the browser. Nothing was changed.')
      else if (error.code === 'expired_token') throw new InstallError(EXIT.PRECONDITION, 'The sign-in code expired before it was approved. Nothing was changed; run the command again for a new code.')
      else throw signInFailed(error, cloud)
    }
    if (Date.now() > deadline) throw new InstallError(EXIT.PRECONDITION, 'The sign-in code expired before it was approved. Nothing was changed; run the command again for a new code.')
  }
}

function signInFailed(error, cloud) {
  if (error instanceof InstallError) return error
  return new InstallError(EXIT.PRECONDITION, `Slatebox Cloud (${new URL(cloud.base).host}) refused the sign-in: ${error.message}${error.code ? ` (${error.code})` : ''}.`)
}

// ------------------------------------------------------------------ credentials on disk

export const credentialsPath = (home, name) => join(installDir(home, name), CREDENTIALS_FILE)

/**
 * The install's team-address credential, or null. A file or folder that others can read is
 * refused with the command that fixes it, rather than used.
 */
export function readCredentials(home, name) {
  const path = credentialsPath(home, name)
  if (!existsSync(path)) return null
  if (process.platform !== 'win32') {
    const fileMode = statSync(path).mode & 0o777
    const dirMode = statSync(installDir(home, name)).mode & 0o777
    if (fileMode & 0o077 || dirMode & 0o077) {
      throw new InstallError(EXIT.PRECONDITION, `${path} can be read by other users of this computer (mode ${fileMode.toString(8)}, folder ${dirMode.toString(8)}), so it was not used. It holds the key to your team address. Fix it with: chmod 700 ${installDir(home, name)} && chmod 600 ${path}`)
    }
  }
  let data
  try { data = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new InstallError(EXIT.PRECONDITION, `${path} is not readable JSON. Move it away and run slatebox install again to sign in and get a new one.`) }
  if (!data?.claimId || !data?.installCredential || !data?.name) throw new InstallError(EXIT.PRECONDITION, `${path} is missing fields. Move it away and run slatebox install again.`)
  return data
}

/** Written atomically, 0600 in a 0700 folder. */
export function writeCredentials(home, name, data) {
  const dir = installDir(home, name)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  chmodSync(dir, 0o700)
  const path = credentialsPath(home, name)
  writeFileSync(`${path}.tmp`, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 })
  renameSync(`${path}.tmp`, path)
  chmodSync(path, 0o600)
  return path
}

export function removeCredentials(home, name) {
  rmSync(credentialsPath(home, name), { force: true })
}

/** A random value that makes a retried claim from this computer the same claim. */
export const newClientKey = () => randomBytes(16).toString('base64url')
