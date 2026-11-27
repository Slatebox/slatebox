// A read-only seat in a slate's live room, over REST (slates.live, GET /api/v1/slates/{shareId}/live):
// what the viewer app (and any token or visitor that may read the slate) joins the collaboration
// relay with, without DDP. The same access check as collaborators.init (relay-access.mjs), always
// asked for read only, and the same room token (relay-token.mjs), always role read: this door
// never writes.
//
// stores: relayAccess's stores. loadUser(userId) -> the account (with orgId and isMasterUser) or
// null. settings() -> the server's settings (slateboxAPI for the key pair, public.wsUrl).
// live({ userId, shareId }) answers { code: 'ok', wsUrl, room, token, exp, role: 'read' }, or
// { code } and nothing else: 'relay-off' when the relay is not set up, or relayAccess's refusal.
// A token is a credential: never log the answer.
import { relayAccess, RELAY_CODES } from './relay-access.mjs'
import { relayParams } from './collaborator-details.mjs'

export const RELAY_OFF = 'relay-off'

export function createRelayLive({ stores, loadUser, settings, now = undefined }) {
  async function live({ userId = null, shareId } = {}) {
    const user = userId ? await loadUser(userId) : null
    if (userId && !user) return { code: RELAY_CODES.noAccess }
    const access = await relayAccess(stores, { user, shareId, readOnly: true })
    if (access.code !== RELAY_CODES.ok) return { code: access.code }
    const current = settings() || {}
    const wsUrl = current.public?.wsUrl
    const params = relayParams({ settings: current, access: { ...access, role: 'read' }, legacy: false, ...(now && { now: now() }) })
    if (!params || typeof wsUrl !== 'string' || !wsUrl) return { code: RELAY_OFF }
    return { code: RELAY_CODES.ok, wsUrl, room: access.room, token: params.token, exp: params.exp, role: 'read' }
  }
  return { live }
}
