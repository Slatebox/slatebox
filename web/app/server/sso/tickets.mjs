// The one-time ticket the sign-in callback hands the browser (in the URL fragment of /sso/done),
// which the "sso" login handler turns into a Meteor session. A ticket is bound to the browser tab
// that started the sign-in: that tab made a random verifier, kept it in its sessionStorage and sent
// it to /sso/start, where only its hash went into the sign-in's state. Redeeming the ticket needs
// the verifier itself, so a /sso/done link from someone else's sign-in signs nobody in (login CSRF).
//
// Tickets live in Mongo (ssoTickets, a TTL index removes them): in Slatebox Cloud the callback and
// the redemption can reach different servers. Only the ticket's hash is stored. Taking a ticket is
// one atomic findOneAndDelete, so it is tried once, right or wrong, on whichever server.
// No Meteor import: unit-tested with node (memory storage, or a fake collection).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { bindingFor } from './oidc.mjs'

export { bindingFor }
export const TICKET_MS = 60_000

export const newVerifier = () => randomBytes(32).toString('base64url')
const hashOf = (ticket) => createHash('sha256').update(ticket).digest('base64url')

/** Storage in this process only (tests). */
export function memoryTicketStorage() {
  const tickets = new Map()
  return {
    async put(doc) { tickets.set(doc._id, doc) },
    async take(id) {
      const doc = tickets.get(id)
      tickets.delete(id)
      return doc || null
    },
  }
}

/** Storage in a Mongo collection (the raw driver collection of ssoTickets). */
export function mongoTicketStorage(collection) {
  return {
    async put(doc) { await collection.insertOne(doc) },
    async take(id) {
      const result = await collection.findOneAndDelete({ _id: id })
      // driver 6 answers the document, older drivers { value }
      return (result && Object.hasOwn(result, 'value') && Object.hasOwn(result, 'ok') ? result.value : result) || null
    },
  }
}

export function createTicketStore({ now = Date.now, ttlMs = TICKET_MS, storage = memoryTicketStorage() } = {}) {
  return {
    /** extra: { connectionId }, the connection the sign-in came through. */
    async issue(userId, binding, extra = {}) {
      const ticket = randomBytes(32).toString('base64url')
      const connectionId = typeof extra.connectionId === 'string' ? extra.connectionId : undefined
      await storage.put({ _id: hashOf(ticket), userId, binding, ...(connectionId && { connectionId }), expiresAt: new Date(now() + ttlMs) })
      return ticket
    },
    /** The account the ticket signs in to, or null. A ticket is tried once, right or wrong. */
    async redeem(ticket, verifier) {
      return (await this.take(ticket, verifier))?.userId ?? null
    },
    /** { userId, connectionId } for a good ticket, or null; tried once, right or wrong. */
    async take(ticket, verifier) {
      if (typeof ticket !== 'string' || !ticket || ticket.length > 200) return null
      const entry = await storage.take(hashOf(ticket))
      if (!entry || new Date(entry.expiresAt).getTime() < now() || typeof verifier !== 'string' || !entry.binding) return null
      const given = Buffer.from(bindingFor(verifier))
      const expected = Buffer.from(entry.binding)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
      return { userId: entry.userId, connectionId: entry.connectionId ?? null }
    },
  }
}
