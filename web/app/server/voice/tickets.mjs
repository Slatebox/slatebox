// Voice tickets: how a browser that cannot put a header on a WebSocket proves who it is. voice.open
// (a Meteor method, so the person's login is the one DDP already checked) mints a ticket: 32 random
// bytes, stored only as their SHA-256, alive 60 seconds, good once, bound to the person, the voice
// part and the slate. The socket's first message (hello) carries it; the relay takes it (find and
// delete in one step) and so learns who is talking about what. A ticket never goes in a URL, where
// proxies and Cloudflare would log it, and the login token never goes near the socket.
//
// A session that moves (a restart, a provider's goAway it cannot follow) gets a new ticket for the
// same person, part and slate, carrying what it needs to carry on (resume: Gemini's handle, or the
// words said so far for a provider without resumption), for the browser to reconnect with.
//
// Pure apart from the injected store: { insert(doc), take(id, now) → doc | null (one atomic
// find-and-delete of an unexpired ticket) }.
import { createHash, randomBytes } from 'node:crypto'
import { VOICE_SURFACES } from '../ai-control/catalogue.mjs'

export const TICKET_TTL_MS = 60_000
const TICKET = /^[A-Za-z0-9_-]{43}$/
const SLATE_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_EARLIER = 8000

export const hashTicket = (ticket) => createHash('sha256').update(String(ticket)).digest('hex')

export class TicketError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TicketError'
  }
}

function checkResume(resume) {
  if (resume === undefined || resume === null) return null
  const out = {}
  if (typeof resume.handle === 'string' && resume.handle.length <= 2048) out.handle = resume.handle
  if (typeof resume.earlier === 'string' && resume.earlier.trim()) out.earlier = resume.earlier.slice(-MAX_EARLIER)
  if (typeof resume.sessionId === 'string' && resume.sessionId.length <= 64) out.sessionId = resume.sessionId
  if (resume.mode === 'open' || resume.mode === 'ptt') out.mode = resume.mode
  // how long the session had run: its time limit counts on from there
  if (Number.isInteger(resume.elapsedMs) && resume.elapsedMs >= 0 && resume.elapsedMs <= 24 * 60 * 60 * 1000) out.elapsedMs = resume.elapsedMs
  return Object.keys(out).length ? out : null
}

/**
 * deps: { store, now?(), random?(bytes) → Buffer }
 * → { mint({ userId, surface, slateId?, resume? }) → { ticket, expiresAt }, redeem(ticket) → { userId, surface, slateId, resume } | null }
 */
export function createTickets({ store, now = Date.now, random = randomBytes, ttlMs = TICKET_TTL_MS }) {
  async function mint({ userId, surface, slateId = null, resume = null }) {
    if (typeof userId !== 'string' || !userId) throw new TicketError('A ticket is for a signed-in person.')
    if (!VOICE_SURFACES.includes(surface)) throw new TicketError(`${surface} is not a voice part.`)
    if (slateId !== null && (typeof slateId !== 'string' || !SLATE_ID.test(slateId))) throw new TicketError('slateId is a slate id.')
    const ticket = random(32).toString('base64url')
    const at = now()
    const expiresAt = new Date(at + ttlMs)
    const kept = checkResume(resume)
    await store.insert({ _id: hashTicket(ticket), userId, surface, slateId, createdAt: new Date(at), expiresAt, ...(kept && { resume: kept }) })
    return { ticket, expiresAt }
  }

  /** The ticket's binding, once: a second redeem, an expired ticket or an unknown one answers null. */
  async function redeem(ticket) {
    if (typeof ticket !== 'string' || !TICKET.test(ticket)) return null
    const doc = await store.take(hashTicket(ticket), new Date(now()))
    if (!doc) return null
    // the store's filter keeps expired tickets out; checked again so a store without it cannot let one in
    if (!(doc.expiresAt instanceof Date) || doc.expiresAt.getTime() <= now()) return null
    return { userId: doc.userId, surface: doc.surface, slateId: doc.slateId ?? null, resume: doc.resume ?? null }
  }

  return { mint, redeem }
}

/** An in-memory ticket store (tests, and a server with no database yet). */
export function memoryTicketStore() {
  const docs = new Map()
  return {
    docs,
    async insert(doc) {
      if (docs.has(doc._id)) throw new Error('duplicate ticket')
      docs.set(doc._id, { ...doc })
    },
    async take(id, at) {
      const doc = docs.get(id)
      if (!doc) return null
      docs.delete(id)
      return doc.expiresAt > at ? doc : null
    },
  }
}
