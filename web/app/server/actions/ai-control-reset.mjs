import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf } from './ai-schemas.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { BINDABLE_SURFACES } from '../ai-control/bindings.mjs'
import { PROMPT_IDS } from '../ai-control/prompts/index.mjs'
import { RESET_TARGETS } from '../ai-control/admin.mjs'

// Break-glass: back to the defaults. It can never send a request anywhere new. From a script it is
// held for the person to agree (confirm), so `slatebox exec 'ai.control.reset({target:"all",
// reason:"…"})'` works when the page does not.
export default defineAction({
  id: 'ai.control.reset',
  title: 'Reset AI control',
  description:
    'Returns AI configuration to its defaults. target binding removes one part\'s choice (surface), so it uses the default model again; bindings removes every part\'s choice and the default\'s, so the built-in default (Meta Muse Ember) answers everything; prompt returns one prompt (promptId) to its built-in text, prompts every prompt (their versions stay); all does every one. Providers, models and keys stay. AI turned off for everyone stays off. From a token, a reset that would switch back on a part an administrator turned off is refused. Needs a reason, which the audit trail keeps. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/reset', operationId: 'resetAIControl' } },
  tool: { name: 'reset_ai_control', title: 'Reset AI control', description: 'Return this server\'s AI choices or prompts to their defaults. Needs a reason; a person agrees first. Administrators only.' },
  confirm: true,
  destructive: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      target: { type: 'string', enum: [...RESET_TARGETS] },
      surface: { type: 'string', enum: [...BINDABLE_SURFACES], description: 'For target binding: the part of Slatebox.' },
      promptId: { type: 'string', enum: [...PROMPT_IDS], description: 'For target prompt: the prompt.' },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['target', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { target: { type: 'string' }, removed: { type: 'array', items: { type: 'string' } }, prompts: { type: 'array', items: { type: 'string' } } } },
  handler: async (principal, input, { deps }) => {
    const actor = actorOf(principal)
    try {
      await requireAIControlAdmin(principal, deps, 'reset AI control')
    } catch (error) {
      await deps.aiControlStore?.refused({ action: 'ai.control.reset', actor, target: { kind: 'reset', id: input.target }, reason: input.reason, error: error.message }).catch(() => {})
      throw error
    }
    // A reset moves toward the defaults, and for a part an administrator turned off the default is
    // on. From a token, a reset that would switch such a part back on is refused: a person does it
    // on the page. (The global switch holds through every reset.)
    const reopened = principal.kind === 'agent' ? turnedOffParts(deps.aiControl?.snapshot?.(), input) : []
    if (reopened.length) {
      const why = `Only a person can switch back on what an administrator turned off (${reopened.join(', ')}). Use the AI control page.`
      await deps.aiControlStore?.refused({ action: 'ai.control.reset', actor, target: { kind: 'reset', id: input.target }, reason: input.reason, error: why, trusted: true }).catch(() => {})
      throw problem(403, 'forbidden', why, { details: { personOnly: true } })
    }
    if (!input.reason.trim()) throw problem(400, 'invalid_request', 'Say why: a reset needs a reason.', { details: { field: 'reason' } })
    if ((input.target === 'binding') !== Boolean(input.surface)) throw problem(400, 'invalid_request', 'surface goes with target binding, and target binding needs it.', { details: { field: 'surface' } })
    if ((input.target === 'prompt') !== Boolean(input.promptId)) throw problem(400, 'invalid_request', 'promptId goes with target prompt, and target prompt needs it.', { details: { field: 'promptId' } })
    return deps.aiControlOps.reset({ actor, target: input.target, surface: input.surface ?? null, promptId: input.promptId ?? null, reason: input.reason })
  },
})

// The parts an administrator turned off that this reset would switch back on.
export function turnedOffParts(snapshot, { target, surface = null }) {
  if (!['binding', 'bindings', 'all'].includes(target) || !snapshot) return []
  return Object.values(snapshot.bindings || {})
    .filter((doc) => doc.use === 'off' && (target !== 'binding' || doc.surface === surface))
    .map((doc) => doc.surface)
    .sort()
}
