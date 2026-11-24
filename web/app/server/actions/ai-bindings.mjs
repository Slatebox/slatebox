import { defineAction } from './registry.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, asProblem } from './ai-control-schemas.mjs'
import { BINDABLE_SURFACES, PARAM_LIMITS, TOOL_MODES } from '../ai-control/bindings.mjs'
import { FAILURE_CLASSES, MAX_CHAIN } from '../ai-control/snapshot.mjs'

// Bindings (spec 1.4, 3.4): which model chain, parameters, tools and limits each part of Slatebox
// uses on this server, and whether it is on. An agent may save drafts; only a person publishes or
// rolls back (spec 4), so those two are the app's page only (no HTTP route, exec method or tool).
// Administrators only, on every surface.

const SURFACE = { type: 'string', enum: [...BINDABLE_SURFACES], description: 'The part of Slatebox, for example agent.slatebox or shape.' }
const SCOPE = { type: 'object', properties: { level: { type: 'string', enum: ['server'] } }, required: ['level'], additionalProperties: false, description: 'Only server in this build.' }
const NOTE = { type: 'string', maxLength: 200, description: 'A short note kept with the version.' }

export const bindingInput = {
  type: 'object',
  properties: {
    surface: SURFACE,
    scope: SCOPE,
    enabled: { type: 'boolean', description: 'false turns this part off for everyone; people see disabledMessage.' },
    disabledMessage: { type: ['string', 'null'], maxLength: 300, description: 'What people see while it is off.' },
    chain: {
      type: 'array',
      maxItems: MAX_CHAIN,
      description: 'The primary model, then fallbacks. Each entry names a model from the model list (model) or a connection with its own model (connection: server:<name>, or builtin for the built-in AI). Empty: follow what it follows.',
      items: {
        type: 'object',
        properties: {
          model: { type: 'string', maxLength: 260 },
          connection: { type: 'string', maxLength: 60 },
          on: { type: 'array', items: { type: 'string', enum: [...FAILURE_CLASSES] }, description: 'A fallback is tried when the previous model failed this way: infra (5xx, 429, timeout), shape (answers it could not use), context (too long), any.' },
        },
        additionalProperties: false,
      },
    },
    onTrip: { type: ['string', 'null'], enum: ['fallback', 'report', null], description: 'When the chain keeps failing on a server: fallback uses the settings file and built-in AI for 10 minutes; report keeps the chain and says so. Unset: fallback only for a chain of two or more that lists the built-in AI.' },
    params: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(PARAM_LIMITS).map(([key, l]) => [key, { type: [l.whole ? 'integer' : 'number', 'null'], minimum: l.min, maximum: l.max }])),
      additionalProperties: false,
      description: 'timeoutMs, maxTokens (only lowers the call site\'s), infraRetries, shapeRetries, temperature. null or absent: the built-in value.',
    },
    prompts: { type: 'object', additionalProperties: { type: 'string', maxLength: 120 }, description: 'slot: prompt id, or id@version to pin one.' },
    tools: {
      type: 'object',
      properties: {
        mode: { type: ['string', 'null'], enum: [...TOOL_MODES, null] },
        allow: { type: ['array', 'null'], maxItems: 30, items: { type: 'string', maxLength: 64 } },
      },
      additionalProperties: false,
      description: 'allow: the only tools sent and accepted back; mode forced, auto or none (none only where the part needs no tools).',
    },
    limits: {
      type: 'object',
      properties: { estimate: { type: ['integer', 'null'], minimum: 1 }, ceiling: { type: ['integer', 'null'], minimum: 1 } },
      additionalProperties: false,
      description: 'Micro-dollars per request; can only lower the built-in values.',
    },
  },
  required: ['surface'],
  additionalProperties: false,
}

export const aiBindingsList = defineAction({
  id: 'ai.bindings.list',
  title: 'AI bindings',
  description:
    'Lists every part of Slatebox that can be bound on this server, with its published binding (model chain, parameters, tools, limits, on/off), its versions newest first with author and note, and why a binding was skipped if it no longer passes its checks. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/bindings', operationId: 'listAIBindings' } },
  tool: { name: 'list_ai_bindings', title: 'List AI bindings', description: 'List which model chain, parameters, tools and limits each part of Slatebox uses, with versions. Administrators only.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { generation: { type: 'integer' }, surfaces: { type: 'array', items: { type: 'object' } } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI bindings')
    return deps.aiBindings.list()
  },
})

export const aiBindingsSaveDraft = defineAction({
  id: 'ai.bindings.saveDraft',
  title: 'Save AI binding draft',
  description:
    'Saves a draft binding for one part of Slatebox: its model chain (primary, then fallbacks with the failures each is tried for), parameters, allowed tools, limits and on/off. Changes nothing live: a person publishes it. An agent\'s draft is marked as a suggestion. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/bindings/draft', operationId: 'saveAIBindingDraft' } },
  tool: { name: 'save_ai_binding_draft', title: 'Save an AI binding draft', description: 'Save a draft of which models, parameters and tools a part of Slatebox uses. Changes nothing live. Administrators only.' },
  idempotent: false,
  // a retry with the same key gets the version it saved, not a second draft
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: { type: 'object', properties: { binding: bindingInput, note: NOTE }, required: ['binding'], additionalProperties: false },
  output: { type: 'object', properties: { bindingId: { type: 'string' }, version: { type: 'integer' }, status: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.bindings.saveDraft', target: { kind: 'binding', id: `${input.binding.surface}|server` }, doing: 'change AI bindings' })
    try {
      return await deps.aiBindings.saveDraft({ actor, input: input.binding, note: input.note ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiBindingsPublish = defineAction({
  id: 'ai.bindings.publish',
  title: 'Publish AI binding',
  description:
    'Publishes a binding: a saved draft (version) or one sent with the call. It is checked first (models and connections exist and are on, they can do what the part needs, limits only tighten); every server picks it up within seconds. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  // a person only (spec 4): the app's page, not a token
  mounts: { ddp: true },
  confirm: true,
  idempotent: false,
  successStatus: 200,
  input: {
    type: 'object',
    properties: { surface: SURFACE, version: { type: 'integer', minimum: 1 }, binding: bindingInput, note: NOTE, reason: REASON },
    required: ['reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { bindingId: { type: 'string' }, version: { type: 'integer' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const surface = input.binding?.surface ?? input.surface
    const actor = await guardControlWrite(principal, deps, { action: 'ai.bindings.publish', target: { kind: 'binding', id: `${surface}|server` }, doing: 'publish AI bindings', reason: input.reason })
    try {
      if (!input.binding && !(input.surface && input.version)) throw asProblem({ name: 'ModelError', status: 400, message: 'Send a binding, or the surface and version of a draft.' })
      const { binding: _b, ...out } = await deps.aiBindings.publish({ actor, surface, version: input.version ?? null, input: input.binding ?? null, reason: input.reason, note: input.note ?? null })
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiBindingsRollback = defineAction({
  id: 'ai.bindings.rollback',
  title: 'Roll back AI binding',
  description:
    'Publishes an earlier version of a binding again, as a new version. Refused, with the reason, when that version names a model or connection that is gone or turned off; return the part to the built-in AI with ai.control.reset instead. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  idempotent: false,
  successStatus: 200,
  input: {
    type: 'object',
    properties: { surface: SURFACE, toVersion: { type: 'integer', minimum: 1 }, reason: REASON },
    required: ['surface', 'toVersion', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { bindingId: { type: 'string' }, version: { type: 'integer' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.bindings.rollback', target: { kind: 'binding', id: `${input.surface}|server` }, doing: 'roll back AI bindings', reason: input.reason })
    try {
      const { binding: _b, ...out } = await deps.aiBindings.rollback({ actor, surface: input.surface, toVersion: input.toVersion, reason: input.reason })
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiBindingsList, aiBindingsSaveDraft, aiBindingsPublish, aiBindingsRollback]
