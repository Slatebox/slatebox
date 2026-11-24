// The one-time ticket /sso/callback hands the browser (in the URL fragment of /sso/done), which
// the "sso" login handler turns into a Meteor session. A ticket is bound to the browser tab that
// started the sign-in: that tab made a random verifier, kept it in its sessionStorage and sent it
// to /sso/login, where only its hash went into the sealed state. Redeeming the ticket needs the
// verifier itself, so a /sso/done link from someone else's sign-in signs nobody in (login CSRF).
// No Meteor import: unit-tested with node.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { bindingFor } from './oidc.mjs'

export { bindingFor }
export const TICKET_MS = 60_000

export const newVerifier = () => randomBytes(32).toString('base64url')

export function createTicketStore({ now = Date.now, ttlMs = TICKET_MS } = {}) {
  const tickets = new Map()
  return {
    issue(userId, binding) {
      const ticket = randomBytes(32).toString('base64url')
      tickets.set(ticket, { userId, binding, expires: now() + ttlMs })
      for (const [key, entry] of tickets) if (entry.expires < now()) tickets.delete(key)
      return ticket
    },
    /** The account the ticket signs in to, or null. A ticket is tried once, right or wrong. */
    redeem(ticket, verifier) {
      if (typeof ticket !== 'string') return null
      const entry = tickets.get(ticket)
      tickets.delete(ticket)
      if (!entry || entry.expires < now() || typeof verifier !== 'string' || !entry.binding) return null
      const given = Buffer.from(bindingFor(verifier))
      const expected = Buffer.from(entry.binding)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      return entry.userId
    },
  }
}
