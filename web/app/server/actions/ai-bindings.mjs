import { defineAction } from './registry.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { asProblem } from './ai-control-schemas.mjs'
import { BINDABLE_SURFACES, BINDING_CHOICES } from '../ai-control/bindings.mjs'

// Bindings: one simple choice per part of Slatebox: a provider's model, "Use the default", or
// turned off. The default ("Everything not set") is Meta Muse Ember until an administrator picks
// another. A plain Save; every changed row is one line in the change history. Administrators only.

const SURFACE = { type: 'string', enum: [...BINDABLE_SURFACES], description: 'The part of Slatebox, for example shape or agent.slatebox; default is everything not set.' }

export const aiBindingsList = defineAction({
  id: 'ai.bindings.list',
  title: 'AI bindings',
  description:
    'Lists every part of Slatebox that can be bound, with its choice (a model, use the default, or turned off) and what it resolves to now (provider, model and where that comes from). Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/bindings', operationId: 'listAIBindings' } },
  tool: { name: 'list_ai_bindings', title: 'List AI bindings', description: 'List which model each part of Slatebox uses. Administrators only.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { generation: { type: 'integer' }, surfaces: { type: 'array', items: { type: 'object' } }, skipped: { type: 'array', items: { type: 'object' } } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI bindings')
    return deps.aiBindings.list()
  },
})

export const aiBindingsSet = defineAction({
  id: 'ai.bindings.set',
  title: 'Set AI bindings',
  description:
    'Sets which model each named part of Slatebox uses: use model (a model id from the Models list, <provider>:<model>), default (the default model), or off (that part answers "turned off by your administrator"). A model that cannot do what the part needs is refused. Only the rows that change are written, each with its own line in the change history; note is optional. Every server picks it up within seconds. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/bindings', operationId: 'setAIBindings' } },
  tool: { name: 'set_ai_bindings', title: 'Set AI bindings', description: 'Choose which model each part of Slatebox uses. Administrators only; a person agrees first.' },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: BINDABLE_SURFACES.length,
        items: {
          type: 'object',
          properties: {
            surface: SURFACE,
            use: { type: 'string', enum: [...BINDING_CHOICES] },
            model: { type: 'string', maxLength: 260, description: 'With use model: <provider>:<model>.' },
            voice: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$', description: 'A voice part with use model: one of the model\'s voices. Left out: the provider\'s own default voice.' },
          },
          required: ['surface', 'use'],
          additionalProperties: false,
        },
      },
      note: { type: 'string', maxLength: 500, description: 'Optional, kept in the change history.' },
    },
    required: ['changes'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { changed: { type: 'array', items: { type: 'string' } }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.bindings.set', target: { kind: 'binding', id: input.changes.map((c) => c.surface).join(',').slice(0, 200) }, doing: 'change AI bindings', reason: input.note ?? null })
    try {
      return await deps.aiBindings.set({ actor, changes: input.changes, note: input.note ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiBindingsList, aiBindingsSet]
