import { problem } from './errors.mjs'

// What presence.plan and presence.step answer: the run's checklist as screens show it.
export const planOutput = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    mode: { type: 'string', enum: ['save', 'preview'] },
    shareId: { type: 'string' },
    plan: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { text: { type: 'string' }, status: { type: 'string', enum: ['todo', 'doing', 'done', 'skipped', 'stopped'] } },
            required: ['text', 'status'],
          },
        },
        current: { type: 'integer', minimum: 0, description: 'The step under way.' },
      },
      required: ['steps', 'current'],
    },
  },
  required: ['ok', 'shareId', 'plan'],
}

// Presence is drawn only from what the server writes: without the store there is nothing to write to.
export function presenceOf(deps) {
  if (!deps.presence) throw problem(503, 'presence_unavailable', 'This server does not show agents on slates.')
  return deps.presence
}
