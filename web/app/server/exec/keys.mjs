// Keys and ids for exec runs. Inside a script, every write's idempotency key is derived from
// the run's key and the call's place in the script, so a rerun of the same code with the same
// key (to retry, or to confirm a held call) replays what already saved instead of repeating it.
import { createHash, randomBytes, randomUUID } from 'node:crypto'

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

// 'x' + 40 hex characters + ':' + n: at most 47 printable characters, inside the registry's
// key pattern. subject is the token id (or the account id for a session), as the registry's.
export const deriveKey = (subject, execKey, n) => `x${sha256(`${subject}\n${execKey}`).slice(0, 40)}:${n}`

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
export function randomAlphanumeric(length, bytes = randomBytes) {
  let out = ''
  while (out.length < length) {
    for (const byte of bytes(length * 2)) {
      // 248 = 62 * 4: reject the tail so every character is equally likely.
      if (byte < 248 && out.length < length) out += ALPHANUMERIC[byte % 62]
    }
  }
  return out
}

export const newConfirmationId = () => 'cf_' + randomAlphanumeric(24)
export const newExecId = () => randomUUID()
