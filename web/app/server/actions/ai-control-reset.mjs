import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf } from './ai-schemas.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { USE_SURFACES } from '../ai-control/catalogue.mjs'

// Break-glass (spec 2.4). It returns things to the settings file and built-in defaults; it can
// never send a request anywhere new. From a script it is held for the person to agree (confirm),
// so `slatebox exec 'ai.control.reset({target:"all", reason:"…"})'` works when the page does not.
export default defineAction({
  id: 'ai.control.reset',
  title: 'Reset AI control',
  description:
    'Returns AI configuration to the settings file and built-in defaults. target use clears the feature choices an administrator made for the server in the app (keys: only those; connections stay); dbLayer switches AI control\'s own documents off at runtime, so every surface resolves from the AI settings, the settings file and code; all does both. Needs a reason, which the audit trail keeps. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/reset', operationId: 'resetAIControl' } },
  tool: { name: 'reset_ai_control', title: 'Reset AI control', description: 'Return this server\'s AI choices to the settings file and built-in defaults, or switch AI control\'s own settings off. Needs a reason; a person agrees first. Administrators only.' },
  confirm: true,
  destructive: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      target: { type: 'string', enum: ['use', 'dbLayer', 'all'] },
      keys: { type: 'array', minItems: 1, maxItems: USE_SURFACES.length, items: { type: 'string', enum: USE_SURFACES.map((s) => s.id) }, description: 'For target use: only these feature choices.' },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
    },
    required: ['target', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { target: { type: 'string' }, cleared: { type: 'array', items: { type: 'string' } }, dbLayer: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    const actor = actorOf(principal)
    try {
      await requireAIControlAdmin(principal, deps, 'reset AI control')
    } catch (error) {
      await deps.aiControlStore?.refused({ action: 'ai.control.reset', actor, target: { kind: 'reset', id: input.target }, reason: input.reason, error: error.message }).catch(() => {})
      throw error
    }
    if (!input.reason.trim()) throw problem(400, 'invalid_request', 'Say why: a reset needs a reason.', { details: { field: 'reason' } })
    if (input.keys && input.target === 'dbLayer') throw problem(400, 'invalid_request', 'keys go with target use or all.', { details: { field: 'keys' } })
    return deps.aiControlOps.reset({ userId: principal.userId, actor, target: input.target, keys: input.keys ?? null, reason: input.reason })
  },
})
