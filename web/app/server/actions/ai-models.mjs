import { defineAction } from './registry.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, SLUG, asProblem, modelInput } from './ai-control-schemas.mjs'

// The model registry (spec 1.3): the models each connection serves, what they can do and what they
// cost. Metering reads these prices first, from the next call, with no restart. Administrators only.

export const aiModelsSave = defineAction({
  id: 'ai.models.save',
  title: 'Save AI models',
  description:
    'Adds or changes models: the connection that serves each (server:<name> or builtin:<provider>), what it can do (tools, vision, json, images, reasoning), its context and output limits, and its prices in dollars per million input and output tokens (or per image). Metering charges these prices from the next call; a model with no price is charged at the dearest known rate and shown as unpriced. status disabled keeps a model out of bindings. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/models', operationId: 'saveAIModels' } },
  tool: { name: 'save_ai_models', title: 'Save AI models', description: 'Add or change AI models with what they can do and their prices. Administrators only; a person agrees first.' },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { models: { type: 'array', minItems: 1, maxItems: 50, items: modelInput }, reason: REASON },
    required: ['models'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { models: { type: 'array', items: { type: 'object' } }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.models.save', target: { kind: 'models', id: input.models.map((m) => `${m.connection}:${m.model}`).join(',').slice(0, 200) }, doing: 'change AI models', reason: input.reason ?? null })
    try {
      const { userId: _u, ...out } = await deps.aiCatalog.saveModels({ userId: principal.userId, actor, models: input.models, reason: input.reason ?? null })
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiModelsDiscover = defineAction({
  id: 'ai.models.discover',
  title: 'Find AI models',
  description:
    'Lists the models a server connection reports (GET <address>/models, OpenAI-compatible providers only), to fill in the model registry. Writes nothing; the key goes only to the connection\'s own address, with no redirects. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/models/discover', operationId: 'discoverAIModels' } },
  tool: { name: 'discover_ai_models', title: 'Find AI models', description: 'List the models an AI connection reports. Writes nothing. Administrators only.' },
  // it reaches the connection's address (with the key, which never leaves the server)
  openWorld: true,
  input: { type: 'object', properties: { connection: SLUG }, required: ['connection'], additionalProperties: false },
  output: { type: 'object', properties: { connection: { type: 'string' }, ok: { type: 'boolean' }, models: { type: 'array', items: { type: 'object' } }, message: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'list a connection\'s models')
    try {
      return await deps.ai.discoverModels(principal.userId, { name: input.connection })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiModelsSave, aiModelsDiscover]
