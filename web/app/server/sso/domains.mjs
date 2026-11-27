// Proving a team owns an email domain before its connection signs anyone in there: a DNS TXT record
//   _slatebox-challenge.<domain>  TXT  "slatebox-domain-verification=<token>"
// with a random 32-byte token per domain and connection. Checked when the admin presses Check, then
// daily (under a lease, meteor side). A domain whose record has been missing for seven days stops
// routing sign-ins and its team's admins are emailed; it routes again once the record is back.
// On a self-hosted server the server administrator may mark a domain verified without DNS: they
// run the server, and the server's addresses are often on a private network.
// No Meteor import: unit-tested with node (scripts/sso-connections.test.mjs).
import { randomBytes } from 'node:crypto'

export const CHALLENGE_LABEL = '_slatebox-challenge'
export const CHALLENGE_PREFIX = 'slatebox-domain-verification='
export const FAILING_GRACE_MS = 7 * 24 * 3600_000
export const RECHECK_MS = 24 * 3600_000

export const newDomainToken = () => randomBytes(32).toString('base64url')

export const challengeRecord = (domain, token) => ({
  name: `${CHALLENGE_LABEL}.${domain}`,
  type: 'TXT',
  value: `${CHALLENGE_PREFIX}${token}`,
})

/** A domain entry as a connection stores it, before it is verified. */
export const newDomainEntry = (domain, now = Date.now(), token = newDomainToken()) => ({
  domain, token, addedAt: new Date(now), verifiedAt: null, lastCheckAt: null, failingSince: null,
})

/**
 * Whether the challenge record is there. resolveTxt is dns/promises.resolveTxt (injected): it
 * answers the record's strings in chunks, which are joined. A missing name is "not found", any
 * other DNS failure is "unknown" (an outage does not count against the domain).
 */
export async function lookupChallenge({ domain, token, resolveTxt }) {
  const { name, value } = challengeRecord(domain, token)
  let records
  try {
    records = await resolveTxt(name)
  } catch (error) {
    if (['ENOTFOUND', 'ENODATA', 'NXDOMAIN'].includes(error?.code)) return { status: 'missing' }
    return { status: 'unknown' }
  }
  const found = (records || []).some((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks)).trim() === value)
  return { status: found ? 'found' : 'missing' }
}

/**
 * The entry after a check. found: verified (now, if it was not) and no longer failing. missing: a
 * verified domain starts failing (failingSince) and stays verified; an unverified one stays so.
 * unknown: only the time of the check changes.
 */
export function afterCheck(entry, status, now = Date.now()) {
  const at = new Date(now)
  if (status === 'found') return { ...entry, verifiedAt: entry.verifiedAt || at, lastCheckAt: at, failingSince: null }
  if (status === 'missing' && entry.verifiedAt) return { ...entry, lastCheckAt: at, failingSince: entry.failingSince || at }
  return { ...entry, lastCheckAt: at }
}

/** Whether a domain routes sign-ins: verified, and its record missing for less than seven days. */
export function domainRoutes(entry, now = Date.now()) {
  if (!entry?.verifiedAt) return false
  if (!entry.failingSince) return true
  return now - new Date(entry.failingSince).getTime() < FAILING_GRACE_MS
}

/** Whether a check just took a domain past the seven days (the admins are emailed once). */
export const justStoppedRouting = (before, after, now = Date.now()) => domainRoutes(before, now) && !domainRoutes(after, now)

/** The verified domains due for their daily check. */
export const dueForRecheck = (entry, now = Date.now()) =>
  Boolean(entry?.verifiedAt) && entry.verifiedBy !== 'server-admin' && (!entry.lastCheckAt || now - new Date(entry.lastCheckAt).getTime() >= RECHECK_MS)
