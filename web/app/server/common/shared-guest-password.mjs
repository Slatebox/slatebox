// Early guests all had one known password, and an account saved from such a guest could keep it.
// That password is refused everywhere: no sign-in, sign-up, reset or saved account may use it,
// whichever account it is. Only its SHA-256 is kept here, the form accounts-password receives.
import { createHash } from 'node:crypto'

const SHARED_GUEST_PASSWORD_SHA256 = '9dbf8057012e99a692df37f984b92232c1aeee59ba9576be9f440d2ae0bef774'

// A password as accounts-password takes it: plain text, or { digest, algorithm: 'sha-256' }.
export function isSharedGuestPassword(password) {
  if (typeof password === 'string') return createHash('sha256').update(password).digest('hex') === SHARED_GUEST_PASSWORD_SHA256
  if (password && typeof password === 'object' && typeof password.digest === 'string') {
    return password.digest.toLowerCase() === SHARED_GUEST_PASSWORD_SHA256
  }
  return false
}

// The password a validateLoginAttempt attempt was made with: a reset's new password, or the
// password of a sign-in or sign-up. Undefined for a token sign-in.
export function attemptedPassword(attempt) {
  const args = Array.isArray(attempt?.methodArguments) ? attempt.methodArguments : []
  if (attempt?.methodName === 'resetPassword') return args[1]
  return args[0] && typeof args[0] === 'object' ? args[0].password : undefined
}
