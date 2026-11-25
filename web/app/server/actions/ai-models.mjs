import { defineAction } from './registry.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, SLUG, asProblem, modelInput } from './ai-control-schemas.mjs'

// The models each provider serves, what they can do and what they cost. Metering reads these
// prices first, from the next call, with no restart. Administrators only.
const MODEL_ID = { type: 'string', minLength: 3, maxLength: 260, description: 'A model\'s id: <provider>:<model>, for example meta:muse-ember-1.0.' }

export const aiModelsSave = defineAction({
  id: 'ai.models.save',
  title: 'Save AI models',
  description:
    'Adds or changes models: the provider that serves each, its id and name, what it can do (tools, vision, json, images, reasoning), its longest answer, and its prices in dollars per million input and output tokens (or per image). Metering charges these prices from the next call; a model with no price is charged at the dearest known rate and shown as unpriced. status disabled keeps a model out of the parts of Slatebox. Administrators only.',
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
    const actor = await guardControlWrite(principal, deps, { action: 'ai.models.save', target: { kind: 'models', id: input.models.map((m) => `${m.provider}:${m.model}`).join(',').slice(0, 200) }, doing: 'change AI models', reason: input.reason ?? null })
    try {
      return await deps.aiCatalog.saveModels({ actor, models: input.models, reason: input.reason ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiModelsRemove = defineAction({
  id: 'ai.models.remove',
  title: 'Remove AI model',
  description: 'Removes a model. Refused while a part of Slatebox uses it (the answer names the parts). Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  confirm: true,
  destructive: true,
  removes: () => true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: MODEL_ID, reason: REASON }, required: ['id', 'reason'], additionalProperties: false },
  output: { type: 'object', properties: { removed: { type: 'string' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.models.remove', target: { kind: 'models', id: input.id }, doing: 'remove AI models', reason: input.reason })
    try {
      return await deps.aiCatalog.removeModel({ actor, id: input.id, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiModelsDiscover = defineAction({
  id: 'ai.models.discover',
  title: 'Find AI models',
  description:
    'Lists the models a provider reports (GET <address>/models, OpenAI-compatible providers), with its active key, to fill in the models. Writes nothing; the key goes only to the provider\'s own address, with no redirects. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/models/discover', operationId: 'discoverAIModels' } },
  tool: { name: 'discover_ai_models', title: 'Find AI models', description: 'List the models an AI provider reports. Writes nothing. Administrators only.' },
  openWorld: true,
  input: { type: 'object', properties: { provider: SLUG }, required: ['provider'], additionalProperties: false },
  output: { type: 'object', properties: { provider: { type: 'string' }, ok: { type: 'boolean' }, models: { type: 'array', items: { type: 'object' } }, message: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'list a provider\'s models')
    try {
      return await deps.aiCatalog.discoverModels({ provider: input.provider })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiModelsTest = defineAction({
  id: 'ai.models.test',
  title: 'Test AI model',
  description: 'Sends one short request to a model with its provider\'s active key: whether it answers and calls tools. Writes nothing. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/models/test', operationId: 'testAIModel' } },
  tool: { name: 'test_ai_model', title: 'Test an AI model', description: 'Send one short request to an AI model to see that it answers. Administrators only.' },
  readOnly: true,
  openWorld: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: MODEL_ID }, required: ['id'], additionalProperties: false },
  output: { type: 'object', properties: { id: { type: 'string' }, ok: { type: 'boolean' }, tools: { type: 'string' }, message: { type: 'string' } } },
  handler: async (principal, input, { deps }) => {
    await guardControlWrite(principal, deps, { action: 'ai.models.test', target: { kind: 'models', id: input.id }, doing: 'test AI models' })
    try {
      return await deps.aiCatalog.testModel({ id: input.id })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiModelsSave, aiModelsRemove, aiModelsDiscover, aiModelsTest]
