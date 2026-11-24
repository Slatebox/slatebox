import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { planOutput, presenceOf } from './presence-schemas.mjs'
import { cleanStepText } from '../presence/agentPresence.mjs'

// presence.plan: the checklist everyone on the slate sees beside this run's pointer.
export default defineAction({
  id: 'presence.plan',
  title: 'Show a plan',
  description:
    'Show the people on a slate what this run will do: 1 to 8 short steps, as a checklist beside your named pointer. The first step is under way; presence.step ticks the steps. Saves move the pointer to what they change. At most 3 plans per run. A preview run shows nothing.',
  toolset: 'presence',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/presence/plan', operationId: 'setPresencePlan' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  replay: 'stored',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 80, pattern: '^[^<>\\x00-\\x1f]+$' },
        description: 'What the run will do, in order, in plain words: "Read the interview notes", "Draft a brief".',
      },
    },
    required: ['shareId', 'steps'],
    additionalProperties: false,
  },
  output: planOutput,
  load: loadSlate(true),
  failure: { code: 'presence_failed', message: 'The plan could not be shown. Retry with the same key.' },
  tool: { name: 'show_plan', title: 'Show your plan to people on the slate', description: 'Show the people on a slate a short checklist (1 to 8 steps) of what you are about to do, beside your name on the canvas.' },
  async handler(principal, input, { deps, mode, resource: slate }) {
    if (mode === 'preview')
      return {
        ok: true,
        shareId: slate.shareId,
        plan: { steps: input.steps.map((text, index) => ({ text: cleanStepText(text), status: index === 0 ? 'doing' : 'todo' })), current: 0 },
      }
    const plan = await presenceOf(deps).plan(principal, slate, input.steps)
    return { ok: true, shareId: slate.shareId, plan }
  },
})
