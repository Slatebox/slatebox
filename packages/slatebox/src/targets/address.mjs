// A team address, https://<name>.slatebox.team, for any install target: check the name, sign in,
// claim it on Slatebox Cloud, keep the install credential on this computer, and hand the tunnel
// connector token to the target's secrets. The container's own cloudflared then connects out to
// Cloudflare: no DNS, no open ports, no certificates.
//
// Every function here is safe to run again: a claim retried with the same client key is the same
// claim, and an install that already has its token needs no network at all.
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CloudError, cloudBase, cloudClient, credentialsPath, deviceLabel, newClientKey, readCredentials, removeCredentials,
  signIn, TEAM_ADDRESS_RULE, teamAddressProblem, teamHost, writeCredentials,
} from '../cloud.mjs'
import { EXIT, InstallError } from '../errors.mjs'
import { installDir } from '../record.mjs'

export const TUNNEL_TOKEN = 'SLATEBOX_TUNNEL_TOKEN'
const PENDING_FILE = 'claim.json'

function client(ctx, base) {
  ctx.cloud ??= cloudClient(ctx, base || cloudBase(ctx))
  return ctx.cloud
}

/** A team address that cannot be had: the same answer for taken, reserved and blocked names. */
function unavailable(name, suggestions = []) {
  const free = suggestions?.length ? `\n  Free right now: ${suggestions.join(', ')}` : ''
  return new InstallError(EXIT.NEEDS_INPUT, `${teamHost(name)} isn't available.${free}\n  Choose another: --team-address <name>`, { id: 'address-unavailable', field: 'address.team', suggestions: suggestions || [] })
}

function cloudFailure(error, name) {
  if (error instanceof InstallError) return error
  if (!(error instanceof CloudError)) return error
  switch (error.code) {
    case 'unavailable': return unavailable(name, error.suggestions)
    case 'invalid_name': return new InstallError(EXIT.USAGE, `"${name}" is not a team address: ${TEAM_ADDRESS_RULE}.`, { field: 'address.team' })
    case 'limit_reached': return new InstallError(EXIT.PRECONDITION, `Your Slatebox account already has the most team addresses it may hold, or claimed too many today. ${error.message} Release one you no longer use (slatebox address release on that install), or use your own domain: --domain boards.example.com`, { id: 'address-limit' })
    case 'rate_limited': return new InstallError(EXIT.PRECONDITION, `Slatebox Cloud asks you to wait${error.retryAfter ? ` ${error.retryAfter} seconds` : ''} before trying again. Nothing was changed.`, { id: 'rate-limited', retryAfter: error.retryAfter })
    case 'paused': return new InstallError(EXIT.PRECONDITION, 'New team addresses are paused on Slatebox Cloud right now. Nothing was changed. Try again later, or use --domain or --local.', { id: 'address-paused' })
    case 'suspended': return new InstallError(EXIT.PRECONDITION, `${teamHost(name)} is suspended: ${error.notice || error.message}. Your Slatebox keeps running on this computer; contact abuse@slatebox.com about the address.`, { id: 'address-suspended' })
    case 'upstream_unavailable': return new InstallError(EXIT.PRECONDITION, 'Slatebox Cloud could not set up the secure tunnel just now (Cloudflare did not answer). Nothing was left half made; run the same command again in a minute.', { id: 'upstream-unavailable' })
    case 'not_found': return new InstallError(EXIT.PRECONDITION, `Slatebox Cloud no longer knows the team address of this install (${teamHost(name)}). It may have been released. Run slatebox install --team-address <name> to claim one again.`, { id: 'address-gone' })
    default: return new InstallError(EXIT.PRECONDITION, `Slatebox Cloud answered: ${error.message} (${error.code}, HTTP ${error.status}).`, { id: 'cloud-error', code: error.code })
  }
}

// ------------------------------------------------------------------ check

/**
 * Before the plan: is the name ours already, or free to claim? Never signs in.
 * @returns {Promise<{name: string, host: string, creds: object|null, claim: boolean}>}
 */
export async function checkTeamAddress(ctx, answers) {
  const name = answers.address.team
  const problem = teamAddressProblem(name)
  if (problem) throw new InstallError(EXIT.USAGE, `"${name}" is not a team address: ${problem}.`, { field: 'address.team' })
  const creds = readCredentials(ctx.home, answers.name)
  if (creds && creds.name !== name) {
    throw new InstallError(EXIT.USAGE, `"${answers.name}" already has the team address ${teamHost(creds.name)}. To move it: slatebox rename ${name}${answers.name === 'slatebox' ? '' : ` --name ${answers.name}`}. For a second Slatebox, give it its own --name.`, { field: 'address.team' })
  }
  if (creds) {
    ctx.redactor.add(creds.installCredential)
    return { name, host: teamHost(name), creds, claim: false }
  }
  const cloud = client(ctx)
  ctx.out.step('address', 'start', `Checking ${teamHost(name)}`)
  let answer
  try { answer = await cloud.availability(name) } catch (error) { throw cloudFailure(error, name) }
  if (!answer?.available) throw unavailable(name, answer?.suggestions)
  ctx.out.step('address', 'ok', `${teamHost(name)} is available`)
  return { name, host: teamHost(name), creds: null, claim: true }
}

/** For the interview: the name if it is free, or the suggestions. Never signs in. */
export async function availability(ctx, name) {
  try {
    const answer = await client(ctx).availability(name)
    return { available: Boolean(answer?.available), suggestions: answer?.suggestions || [] }
  } catch (error) {
    if (error instanceof CloudError && error.code === 'invalid_name') return { available: false, suggestions: [], invalid: true }
    throw cloudFailure(error, name)
  }
}

// ------------------------------------------------------------------ claim and attach

function pendingPath(ctx, install) { return join(installDir(ctx.home, install), PENDING_FILE) }

/** One client key per install and name, kept until the claim is done, so a retry is the same claim. */
function pendingKey(ctx, install, name) {
  const path = pendingPath(ctx, install)
  if (existsSync(path)) {
    try {
      const pending = JSON.parse(readFileSync(path, 'utf8'))
      if (pending.name === name && pending.clientKey) return pending.clientKey
    } catch { /* write a new one */ }
  }
  const clientKey = newClientKey()
  mkdirSync(installDir(ctx.home, install), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify({ name, clientKey })}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
  return clientKey
}

async function connectorToken(ctx, cloud, creds, { rotate = false } = {}) {
  const answer = await cloud.connectorToken(creds.installCredential, { rotate })
  if (!answer?.connectorToken) throw new InstallError(EXIT.PRECONDITION, 'Slatebox Cloud sent no tunnel token.')
  ctx.redactor.add(answer.connectorToken)
  return answer.connectorToken
}

/**
 * After the plan was approved: the tunnel token for this install. Claims the name (with a
 * sign-in) if this computer holds no credential for it yet; otherwise uses the token already in
 * the install's secrets, or fetches it again with the install credential.
 * @param {{name: string, creds: object|null, claim: boolean}} check from checkTeamAddress
 * @param {Record<string,string>} stored the install's current secrets
 * @returns {Promise<string>} the connector token
 */
export async function ensureTeamAddress(ctx, answers, check, stored = {}) {
  if (ctx.tunnelToken) return ctx.tunnelToken
  const { name } = check
  if (check.creds && stored[TUNNEL_TOKEN]) {
    ctx.redactor.add(stored[TUNNEL_TOKEN])
    ctx.tunnelToken = stored[TUNNEL_TOKEN]
    return ctx.tunnelToken
  }
  const cloud = client(ctx, check.creds?.cloudUrl)
  if (check.creds) {
    // The token file was lost (a new server, a wiped folder): fetch it again with the credential.
    try {
      ctx.tunnelToken = await connectorToken(ctx, cloud, check.creds)
      ctx.out.step('address', 'ok', `Fetched the secure tunnel token for ${teamHost(name)} again`)
      return ctx.tunnelToken
    } catch (error) {
      if (!(error instanceof CloudError && error.status === 401)) throw cloudFailure(error, name)
    }
    // The credential was revoked or replaced: sign in and mint a new one (this also rotates the tunnel secret).
    const bearer = await signIn(ctx, cloud, { purpose: `reconnect ${teamHost(name)}` })
    let minted
    try { minted = await cloud.mintCredential(bearer, check.creds.claimId) } catch (error) { throw cloudFailure(error, name) }
    const creds = { ...check.creds, installCredential: minted.installCredential, renewedAt: new Date().toISOString() }
    ctx.redactor.add(creds.installCredential)
    writeCredentials(ctx.home, answers.name, creds)
    check.creds = creds
    try { ctx.tunnelToken = minted.connectorToken || await connectorToken(ctx, cloud, creds) } catch (error) { throw cloudFailure(error, name) }
    ctx.redactor.add(ctx.tunnelToken)
    ctx.out.step('address', 'ok', `${teamHost(name)} has a new install credential`)
    return ctx.tunnelToken
  }

  const clientKey = pendingKey(ctx, answers.name, name)
  const bearer = await signIn(ctx, cloud)
  ctx.out.step('address', 'start', `Claiming ${teamHost(name)}`)
  let claimed
  try {
    claimed = await cloud.claim(bearer, {
      name, clientKey, label: ctx.deviceLabel || deviceLabel(),
      idempotencyKey: createHash('sha256').update(`${name}|${clientKey}`).digest('hex'),
    })
  } catch (error) {
    throw cloudFailure(error, name)
  }
  const claim = claimed?.claim
  if (!claim?.id) throw new InstallError(EXIT.PRECONDITION, 'Slatebox Cloud did not confirm the claim.')
  let installCredential = claimed.installCredential
  // A replayed claim (the first answer was lost) carries no credential: mint one.
  if (!installCredential) {
    try { installCredential = (await cloud.mintCredential(bearer, claim.id)).installCredential } catch (error) { throw cloudFailure(error, name) }
  }
  ctx.redactor.add(installCredential)
  const creds = { claimId: claim.id, name: claim.name || name, host: claim.host || teamHost(name), cloudUrl: cloud.base, installCredential, claimedAt: new Date().toISOString() }
  writeCredentials(ctx.home, answers.name, creds)
  rmSync(pendingPath(ctx, answers.name), { force: true })
  check.creds = creds
  check.claim = false
  const of = claimed.count && claimed.limit ? ` (${claimed.count} of ${claimed.limit} team addresses on this account)` : ''
  ctx.out.step('address', 'ok', `Claimed ${creds.host}${of}`)
  try {
    ctx.tunnelToken = claimed.connectorToken || await connectorToken(ctx, cloud, creds)
  } catch (error) {
    throw cloudFailure(error, name)
  }
  ctx.redactor.add(ctx.tunnelToken)
  return ctx.tunnelToken
}

// ------------------------------------------------------------------ day two

function requireCreds(ctx, record) {
  const creds = readCredentials(ctx.home, record.name)
  if (!creds) {
    throw new InstallError(EXIT.PRECONDITION, `"${record.name}" has no team address on this computer (no ${credentialsPath(ctx.home, record.name)}).${record.address?.team ? ' Run slatebox install again to sign in and reconnect it.' : ' Add one with: slatebox install --team-address <name>'}`)
  }
  ctx.redactor.add(creds.installCredential)
  return creds
}

/** The address as Slatebox Cloud sees it: active, suspended (with the notice), or unknown when offline. */
export async function teamStatus(ctx, record) {
  const creds = readCredentials(ctx.home, record.name)
  if (!creds) return { name: record.address.team, host: teamHost(record.address.team), status: 'no credential on this computer' }
  ctx.redactor.add(creds.installCredential)
  try {
    const answer = await client(ctx, creds.cloudUrl).self(creds.installCredential)
    // {claim: {id, name, host, status, suspension?}} (a flat claim is read the same way).
    const self = answer?.claim || answer || {}
    return { name: self.name || creds.name, host: self.host || creds.host, status: self.status || 'unknown', suspension: self.suspension || null }
  } catch (error) {
    if (error instanceof InstallError) return { name: creds.name, host: creds.host, status: 'unknown (Slatebox Cloud not reachable)' }
    if (error instanceof CloudError && error.code === 'suspended') return { name: creds.name, host: creds.host, status: 'suspended', suspension: { notice: error.notice || error.message } }
    return { name: creds.name, host: creds.host, status: `unknown (${error.code || error.message})` }
  }
}

/** A new tunnel secret: every connector holding the old token is dropped. Returns the new token. */
export async function rotateTeamAddress(ctx, record) {
  const creds = requireCreds(ctx, record)
  try {
    ctx.tunnelToken = await connectorToken(ctx, client(ctx, creds.cloudUrl), creds, { rotate: true })
  } catch (error) {
    throw cloudFailure(error, creds.name)
  }
  return ctx.tunnelToken
}

/** Move the address to a new name. The old name keeps working until renameComplete. */
export async function renameTeamAddress(ctx, record, next) {
  const problem = teamAddressProblem(next)
  if (problem) throw new InstallError(EXIT.USAGE, `"${next}" is not a team address: ${problem}.`, { field: 'address.team' })
  const creds = requireCreds(ctx, record)
  if (creds.name === next) throw new InstallError(EXIT.USAGE, `"${record.name}" is already at ${teamHost(next)}.`)
  const cloud = client(ctx, creds.cloudUrl)
  const bearer = await signIn(ctx, cloud, { purpose: `move ${teamHost(creds.name)} to ${teamHost(next)}` })
  let answer
  try { answer = await cloud.rename(bearer, creds.claimId, next) } catch (error) { throw cloudFailure(error, next) }
  const renamed = { ...creds, previousName: creds.name, name: answer?.claim?.name || next, host: answer?.claim?.host || teamHost(next), renamedAt: new Date().toISOString() }
  writeCredentials(ctx.home, record.name, renamed)
  return renamed
}

/** After the install answers at the new name: drop the old one (its name is held for 30 days). */
export async function finishRename(ctx, record) {
  const creds = requireCreds(ctx, record)
  try {
    await client(ctx, creds.cloudUrl).renameComplete(creds.installCredential)
  } catch (error) {
    if (error instanceof InstallError) return { done: false, why: error.message }
    throw cloudFailure(error, creds.name)
  }
  const { previousName, ...rest } = creds
  writeCredentials(ctx.home, record.name, rest)
  return { done: true, previousName }
}

/**
 * Give the address back. With offlineOk, an unreachable Cloud is not an error: the credential is
 * kept so `slatebox address release` can finish later.
 */
export async function releaseTeamAddress(ctx, record, { offlineOk = false } = {}) {
  const creds = requireCreds(ctx, record)
  try {
    await client(ctx, creds.cloudUrl).releaseSelf(creds.installCredential)
  } catch (error) {
    if (error instanceof CloudError && (error.status === 404 || error.status === 401)) {
      // Already released, or the credential was revoked by a release elsewhere.
    } else if (offlineOk && error instanceof InstallError) {
      return { released: false, host: creds.host, claimId: creds.claimId, why: error.message.split('\n')[0] }
    } else {
      throw cloudFailure(error, creds.name)
    }
  }
  removeCredentials(ctx.home, record.name)
  rmSync(pendingPath(ctx, record.name), { force: true })
  return { released: true, host: creds.host, claimId: creds.claimId }
}
