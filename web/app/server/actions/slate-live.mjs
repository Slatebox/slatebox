import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'

// A read-only seat in a slate's live room (server/common/relay-live.mjs): what a client outside the
// app (the viewer app) joins the collaboration relay with to see edits as they happen. Two checks,
// both needed: the slate read every token read takes (loadSlate, as slates.get), and the relay's own
// room check (relayAccess, as collaborators.init). The role is always read: this never writes.
export default defineAction({
  id: 'slates.live',
  title: 'Watch a slate live',
  description:
    'A read-only seat in a slate\'s live room: the relay address (wsUrl), the room and a room token that lasts 15 minutes (exp, unix seconds). Join the relay with them to see edits as people make them; ask again before exp for a fresh token. The role is always read. A public slate answers without a token. 503 unavailable when this server has no live relay.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/live', operationId: 'getSlateLive' } },
  input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      wsUrl: { type: 'string', description: 'The relay\'s WebSocket address.' },
      room: { type: 'string', description: 'The slate\'s room on the relay.' },
      token: { type: 'string', description: 'The room token: a credential, never log it.' },
      exp: { type: 'integer', description: 'When the token lapses, unix seconds.' },
      role: { type: 'string', enum: ['read'] },
    },
    required: ['wsUrl', 'room', 'token', 'exp', 'role'],
  },
  load: loadSlate(false),
  tool: { name: 'watch_slate_live', title: 'Watch a slate live', description: 'Get a read-only seat in a slate\'s live room (relay address, room and a short-lived token) to follow edits as people make them.' },
  async handler(principal, _input, { deps, resource: slate }) {
    if (!deps.relayLive) throw problem(503, 'unavailable', 'This server has no live relay.')
    const seat = await deps.relayLive.live({ userId: principal.userId || null, shareId: slate.shareId })
    if (seat.code === 'relay-off') throw problem(503, 'unavailable', 'This server has no live relay.')
    // Refused by the relay's own check: nothing, and nothing about why.
    if (seat.code !== 'ok') throw problem(404, 'not_found', 'Slate not found or unavailable.')
    return { wsUrl: seat.wsUrl, room: seat.room, token: seat.token, exp: seat.exp, role: 'read' }
  },
})
