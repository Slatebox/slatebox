import { defineAction } from './registry.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, asProblem } from './ai-control-schemas.mjs'
import { PROMPT_IDS } from '../ai-control/prompts/index.mjs'
import { BINDABLE_SURFACES } from '../ai-control/bindings.mjs'
import { MAX_BODY } from '../ai-control/lint.mjs'

// Prompts (spec 1.6, 3.6, 4): the text each part of Slatebox sends its model, versioned. An agent may
// read, render, test and save drafts (marked as suggestions); only a person publishes or rolls back,
// so those two are the app's page only (no HTTP route, exec method or tool). Administrators only,
// on every surface. Like the other AI control actions they are exec client methods and HTTP routes
// but not lines of the exec description (toolset admin).

const ID = { type: 'string', enum: [...PROMPT_IDS], description: 'The prompt, for example shape.system.' }
const BODY = { type: 'string', minLength: 1, maxLength: MAX_BODY, description: 'The text. Values go in as {{name}}; {{#flag}}…{{/flag}} keeps text only when the flag is set, {{^flag}}…{{/flag}} only when it is not.' }
const WRAP = { type: 'object', additionalProperties: { type: 'string', enum: ['none', 'data'] }, description: 'Per value: data encloses it in a <data> block so it reads as data, not instructions.' }
const SAMPLE = { type: 'string', maxLength: 40, description: 'A built-in sample (ai.prompts.get lists them). Default: the first.' }
const VERSION = { type: 'integer', minimum: 0, description: 'A saved version; 0 is the built-in text.' }

export const aiPromptsList = defineAction({
  id: 'ai.prompts.list',
  title: 'AI prompts',
  description: 'Lists every prompt Slatebox sends its models, by part of Slatebox: the version served now and where it comes from (built in, published or pinned by a binding), the published and previous versions, and any draft or suggestion. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/prompts', operationId: 'listAIPrompts' } },
  tool: { name: 'list_ai_prompts', title: 'List AI prompts', description: 'List the prompts each part of Slatebox sends its model, with the version served now. Administrators only.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { surfaces: { type: 'array', items: { type: 'object' } } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI prompts')
    return deps.aiPrompts.list()
  },
})

export const aiPromptsGet = defineAction({
  id: 'ai.prompts.get',
  title: 'AI prompt',
  description: 'Returns one prompt: the built-in text (version 0), the text served now and where it comes from, every saved version newest first with its author, note and eval results, the values it may use, and the samples a test run can send. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/prompts/{id}', operationId: 'getAIPrompt' } },
  tool: { name: 'get_ai_prompt', title: 'Read an AI prompt', description: 'Read one prompt: its built-in text, the text served now and its versions. Administrators only.' },
  input: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  output: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'object' }, live: { type: 'object' }, versions: { type: 'array', items: { type: 'object' } } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI prompts')
    try {
      return await deps.aiPrompts.get({ id: input.id })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiPromptsSaveDraft = defineAction({
  id: 'ai.prompts.saveDraft',
  title: 'Save AI prompt draft',
  description: 'Saves a new draft version of a prompt. Changes nothing live: a person publishes it after its checks pass. An agent\'s draft is marked as a suggestion. Returns the version and its lint findings. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/prompts/draft', operationId: 'saveAIPromptDraft' } },
  tool: { name: 'save_ai_prompt_draft', title: 'Save an AI prompt draft', description: 'Save a draft of a prompt a part of Slatebox sends its model. Changes nothing live. Administrators only.' },
  idempotent: false,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { id: ID, body: BODY, wrap: WRAP, note: { type: 'string', maxLength: 200, description: 'A short note kept with the version.' } },
    required: ['id', 'body'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'integer' }, status: { type: 'string' }, origin: { type: 'string' }, lint: { type: 'object' } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.prompts.saveDraft', target: { kind: 'prompt', id: input.id }, doing: 'change AI prompts' })
    try {
      return await deps.aiPrompts.saveDraft({ actor, id: input.id, body: input.body, wrap: input.wrap ?? null, note: input.note ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiPromptsRender = defineAction({
  id: 'ai.prompts.render',
  title: 'Render AI prompt',
  description: 'Renders a prompt version (or text sent with the call) into the request a built-in sample sends, and reports its lint findings. No model is called. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/prompts/{id}/render', operationId: 'renderAIPrompt' } },
  tool: { name: 'render_ai_prompt', title: 'Render an AI prompt', description: 'Show the request a prompt version makes with a sample, and its lint findings. No model is called. Administrators only.' },
  input: { type: 'object', properties: { id: ID, version: VERSION, body: BODY, wrap: WRAP, sample: SAMPLE }, required: ['id'], additionalProperties: false },
  output: { type: 'object', properties: { sample: { type: ['string', 'null'] }, rendered: { type: ['object', 'null'] }, lint: { type: 'object' } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps, 'read AI prompts')
    try {
      return await deps.aiPrompts.render({ id: input.id, version: input.version ?? null, body: input.body ?? null, wrap: input.wrap ?? null, sample: input.sample ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiPromptsTest = defineAction({
  id: 'ai.prompts.test',
  title: 'Test AI prompt',
  description: 'Sends a prompt version (or text sent with the call) with a built-in sample through a part of Slatebox\'s binding (default: the prompt\'s own). Returns the request sent, the raw answer, whether that part could use it, the model, latency and cost. The answer is shown, never applied. Metered to the caller; 30 an hour per administrator. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/prompts/test', operationId: 'testAIPrompt' } },
  tool: { name: 'test_ai_prompt', title: 'Test an AI prompt', description: 'Send a prompt version with a sample to a model and see the answer and whether it can be used. Nothing is applied. Administrators only.' },
  idempotent: false,
  // a retry with the same key gets the answer it had, not a second model call
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { id: ID, version: VERSION, body: BODY, wrap: WRAP, sample: SAMPLE, surface: { type: 'string', enum: [...BINDABLE_SURFACES], description: 'Whose binding (model chain) to test against.' } },
    required: ['id'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { rendered: { type: 'object' }, answer: { type: 'object' }, parses: { type: 'object' }, latencyMs: { type: 'integer' }, model: { type: ['string', 'null'] }, costMicros: { type: 'integer' } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.prompts.test', target: { kind: 'prompt', id: input.id }, doing: 'test AI prompts' })
    try {
      return await deps.aiPrompts.test({ actor, id: input.id, version: input.version ?? null, body: input.body ?? null, wrap: input.wrap ?? null, sample: input.sample ?? null, surface: input.surface ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiPromptsPublish = defineAction({
  id: 'ai.prompts.publish',
  title: 'Publish AI prompt',
  description: 'Publishes a saved version of a prompt: its lint must pass, then the part\'s eval cases run on its binding\'s primary model. A failed case blocks the publish unless override is true, which the change history records. Every server serves it within seconds. Needs a reason. A person only. Administrators only.',
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
    properties: { id: ID, version: { type: 'integer', minimum: 1 }, reason: REASON, override: { type: 'boolean', description: 'Publish although eval cases failed (recorded with the reason).' } },
    required: ['id', 'version', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'integer' }, previous: { type: 'integer' }, generation: { type: ['integer', 'null'] }, evalRun: { type: 'object' } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.prompts.publish', target: { kind: 'prompt', id: input.id }, doing: 'publish AI prompts', reason: input.reason })
    try {
      return await deps.aiPrompts.publish({ actor, id: input.id, version: input.version, reason: input.reason, override: Boolean(input.override) })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiPromptsRollback = defineAction({
  id: 'ai.prompts.rollback',
  title: 'Roll back AI prompt',
  description: 'Serves an earlier version of a prompt again, or its built-in text (toVersion 0). An earlier version is checked as a publish is. Needs a reason. A person only. Administrators only.',
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
    properties: { id: ID, toVersion: VERSION, reason: REASON },
    required: ['id', 'toVersion', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'integer' }, previous: { type: 'integer' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.prompts.rollback', target: { kind: 'prompt', id: input.id }, doing: 'roll back AI prompts', reason: input.reason })
    try {
      return await deps.aiPrompts.rollback({ actor, id: input.id, toVersion: input.toVersion, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiPromptsList, aiPromptsGet, aiPromptsSaveDraft, aiPromptsRender, aiPromptsTest, aiPromptsPublish, aiPromptsRollback]
