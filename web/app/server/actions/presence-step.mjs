import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { planOutput, presenceOf } from './presence-schemas.mjs'

// presence.step: tick a step of this run's checklist.
export default defineAction({
  id: 'presence.step',
  title: 'Tick a plan step',
  description:
    'Mark a step of the plan set with presence.plan as doing, done or skipped. When a step is done and none is under way, the next one starts; a step under way is done when another starts or the run ends. At most 40 per run. A preview run changes nothing.',
  toolset: 'presence',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/presence/step', operationId: 'setPresenceStep' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  replay: 'stored',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      index: { type: 'integer', minimum: 0, maximum: 7, description: 'The step, from 0.' },
      status: { type: 'string', enum: ['doing', 'done', 'skipped'] },
    },
    required: ['shareId', 'index', 'status'],
    additionalProperties: false,
  },
  output: planOutput,
  load: loadSlate(true),
  failure: { code: 'presence_failed', message: 'The step could not be shown. Retry with the same key.' },
  tool: { name: 'tick_plan_step', title: 'Tick a step of your plan', description: 'Mark a step of the plan shown with show_plan as doing, done or skipped.' },
  cli: { command: 'step' },
  async handler(principal, input, { deps, mode, resource: slate }) {
    if (mode === 'preview') return { ok: true, shareId: slate.shareId, plan: { steps: [], current: input.index } }
    const plan = await presenceOf(deps).step(principal, slate, input.index, input.status)
    return { ok: true, shareId: slate.shareId, plan }
  },
})
