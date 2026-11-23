import { createHmac, timingSafeEqual } from 'node:crypto'

// Two things are signed with the Slatebox API key, and neither may stand in for the other.
//
// - A signed HTTP hook request (api.slatebox.com -> /slates/createOrDisplay, the passthrough route)
//   carries HMAC(publicKey:dateString), where dateString is the moment it was signed as an ISO
//   instant (Date#toISOString).
// - The collaboration relay's credential, which any viewer of a slate receives from
//   collaborators.init, carries HMAC(publicKey:timestamp). The relay accepts any timestamp, so the
//   app stamps it with a prefix that is never an ISO instant.
//
// A hook accepts only a strict ISO instant, so a relay credential (whose signed text starts with
// the prefix) never passes as a hook signature.
export const COLLAB_STAMP_PREFIX = 'collab.'
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

const sign = (publicKey, secretKey, text) => createHmac('sha256', secretKey).update(`${publicKey}:${text}`).digest('base64')

function sameText(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

// The signed-request check for the HTTP hooks: a signature over a current ISO instant.
export function hookSignatureIsValid({ publicKey, secretKey, bearer, dateString, now = Date.now() } = {}) {
  if (typeof bearer !== 'string' || typeof dateString !== 'string') return false
  if (typeof publicKey !== 'string' || typeof secretKey !== 'string' || !publicKey || !secretKey) return false
  if (!ISO_INSTANT.test(dateString)) return false
  const sent = Date.parse(dateString)
  if (!Number.isFinite(sent) || sent < now - 1000 * 60 * 15 || sent > now + 1000 * 60 * 5) return false
  let sentSignature
  try { sentSignature = decodeURIComponent(bearer) } catch { return false }
  return sameText(sign(publicKey, secretKey, dateString), sentSignature)
}

// The relay credential: base64("publicKey:hash") and the stamp the hash covers. The relay
// (collab.slatebox.com, src/auth/isAuthenticated.js) recomputes HMAC(publicKey:timestamp).
export function collabCredential({ publicKey, secretKey, now = new Date() }) {
  const timestamp = `${COLLAB_STAMP_PREFIX}${now.toISOString()}`
  const bearer = Buffer.from(`${publicKey}:${sign(publicKey, secretKey, timestamp)}`, 'utf8').toString('base64')
  return { bearer, timestamp }
}
