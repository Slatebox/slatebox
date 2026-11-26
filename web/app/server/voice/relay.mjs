// The voice relay's door: a raw WebSocket server on the app's own HTTP server, for one path only
// (/voice/ws). Every other upgrade is left exactly as it came: Meteor's DDP (sockjs, /websocket and
// /sockjs/...) and anything else keep their own listeners, and this listener never touches a socket
// that is not its own. A browser from another origin is refused before the upgrade (a page elsewhere
// cannot open a voice session with someone's ticket). A socket counts toward the server's limit
// (perPod) and the person's (perPerson) only once its ticket is taken (admit, at hello): until
// then it is one of a few an address may hold waiting (it has 5 s to say hello), so sockets that
// never say hello cannot fill a server. On SIGTERM every session is handed a ticket to carry on
// elsewhere (closing moving) before the process exits (server/shutdown.mjs).
//
// Pure apart from the ws package and the injected session factory.
import { WebSocketServer } from 'ws'
import { VOICE_PATH } from '../../imports/api/common/voice-protocol.mjs'
import { CLOSING_COPY, createVoiceSession } from './session.mjs'

// A browser message is at most 16 KB of JSON or one mic frame: anything bigger is refused by ws itself.
export const MAX_PAYLOAD = 64 * 1024
// Sockets one address may hold before their hello (a few tabs); all addresses together: twice perPod.
export const WAITING_PER_ADDRESS = 4

/**
 * The browser's address: the socket's, or with forwardedCount proxies in front (Meteor's
 * HTTP_FORWARDED_COUNT), the one the outermost of them saw (X-Forwarded-For, counted from the right).
 */
export function clientAddress(req, forwardedCount = 0) {
  const direct = req.socket?.remoteAddress || 'unknown'
  if (!forwardedCount) return direct
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((h) => h.trim()).filter(Boolean)
  return hops[hops.length - forwardedCount] || direct
}

/** The origin a browser must come from: ROOT_URL's (and any the operator adds). */
export function originAllowed(origin, allowed) {
  if (typeof origin !== 'string' || !origin) return false
  let given
  try {
    given = new URL(origin).origin
  } catch {
    return false
  }
  return allowed.some((url) => {
    try {
      return new URL(url).origin === given
    } catch {
      return false
    }
  })
}

function refuse(socket, status, text) {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${text.length}\r\n\r\n${text}`)
  } catch { /* gone */ }
  socket.destroy()
}

/**
 * deps: {
 *   server       the HTTP server (WebApp.httpServer)
 *   origins      the allowed origins (ROOT_URL first)
 *   perPod()     how many sessions this server holds at most (read per connection)
 *   perPerson()  how many sessions one person may have open at once
 *   openElsewhere?(userId, { except }) → how many of their sessions other servers hold (VoiceSessions)
 *   forwardedCount  proxies in front of this server (clientAddress)
 *   sessionDeps  everything createVoiceSession needs but the browser's socket
 *   createSession? (tests)
 *   log?
 * }
 * → { sessions, onUpgrade, drain() (every session: closing moving), close() }
 */
export function createVoiceRelay({
  server, origins, perPod = () => 50, perPerson = () => 2, openElsewhere = async () => 0, forwardedCount = 0,
  sessionDeps, createSession = createVoiceSession, path = VOICE_PATH, log = console,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false })
  const sessions = new Set()
  // sockets before their hello, by address
  const waiting = new Map()
  let waitingTotal = 0
  let draining = false

  // At hello, the ticket taken: this server's sessions and the person's, the one asking aside (a
  // session that moved here is not counted twice: its old one is closing).
  async function admit(session, binding) {
    const except = binding.resume?.sessionId ?? null
    const counted = [...sessions].filter((s) => s !== session && s.admitted?.() && s.state?.() !== 'closed' && s.id !== except)
    if (counted.length >= perPod()) return { ok: false, reason: 'busy', message: CLOSING_COPY.busy }
    const mine = counted.filter((s) => s.userId?.() === binding.userId).length
    const ids = counted.map((s) => s.id)
    const elsewhere = await openElsewhere(binding.userId, { except: [...ids, session.id, ...(except ? [except] : [])] }).catch(() => 0)
    if (mine + elsewhere >= perPerson()) return { ok: false, reason: 'busy', message: CLOSING_COPY.another }
    return { ok: true }
  }

  function onUpgrade(req, socket, head) {
    let pathname
    try {
      pathname = new URL(req.url, 'http://relay.invalid').pathname
    } catch {
      return
    }
    // not ours: DDP's sockjs and every other listener keep it, untouched
    if (pathname !== path) return
    if (!originAllowed(req.headers.origin, origins)) return refuse(socket, 403, 'Forbidden')
    if (draining) return refuse(socket, 503, 'Service Unavailable')
    const address = clientAddress(req, forwardedCount)
    if ((waiting.get(address) || 0) >= WAITING_PER_ADDRESS || waitingTotal >= perPod() * 2) return refuse(socket, 429, 'Too Many Requests')
    wss.handleUpgrade(req, socket, head, (client) => {
      waiting.set(address, (waiting.get(address) || 0) + 1)
      waitingTotal += 1
      let counted = true
      const settle = () => {
        if (!counted) return
        counted = false
        waitingTotal -= 1
        const left = (waiting.get(address) || 1) - 1
        if (left > 0) waiting.set(address, left)
        else waiting.delete(address)
      }
      let session = null
      session = createSession({
        ...sessionDeps, client,
        admit: (binding) => {
          settle()
          return admit(session, binding)
        },
      })
      sessions.add(session)
      session.done.finally(() => {
        settle()
        sessions.delete(session)
      })
    })
  }
  server.on('upgrade', onUpgrade)

  return {
    sessions,
    onUpgrade,
    /** This server is stopping: every session gets a ticket to carry on elsewhere. */
    async drain() {
      draining = true
      const open = [...sessions]
      if (open.length) log.info?.(`[voice] moving ${open.length} voice session(s) to the next server`)
      await Promise.allSettled(open.map((session) => session.moving()))
    },
    close() {
      server.off('upgrade', onUpgrade)
      wss.close()
    },
  }
}
