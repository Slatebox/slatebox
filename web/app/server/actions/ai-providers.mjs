import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf } from './ai-schemas.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { REASON, SLUG, asProblem, providerChange, providerInput } from './ai-control-schemas.mjs'
import { PROVIDER_PRESETS } from '../ai-control/provider-presets.mjs'

// Providers: every model provider is a stored row made from a preset (Meta (Muse), OpenAI,
// DeepInfra, ... or Other with an OpenAI-compatible address). Administrators only, on every surface;
// toolset admin keeps them out of everyone else's typed tools and the exec description.

/**
 * The checks every AI control write makes before it changes anything: an administrator of this
 * server; for an agent, nothing that decides where a key goes; the write rate. A refused attempt is
 * recorded. refusal(previous) → a reason an agent may not make this write, or null.
 */
export async function guardControlWrite(principal, deps, { action, target, doing, reason = null, refusal = null }) {
  const actor = actorOf(principal)
  // trusted: past the administrator check, so the attempt's own text (its reason) is kept
  const refuse = async (error, trusted = true) => {
    await deps.aiControlStore?.refused({ action, actor, target, reason, error: error.message, trusted }).catch(() => {})
    throw error
  }
  try {
    await requireAIControlAdmin(principal, deps, doing)
  } catch (error) {
    await refuse(error, false)
  }
  if (principal.kind === 'agent' && refusal) {
    const why = await refusal()
    if (why) await refuse(problem(403, 'forbidden', why, { details: { personOnly: true } }))
  }
  try {
    deps.aiControlWriteLimit?.take(principal.userId)
  } catch (error) {
    await refuse(asProblem(error))
  }
  return actor
}

export const aiProvidersAdd = defineAction({
  id: 'ai.providers.add',
  title: 'Add AI provider',
  description:
    'Adds a model provider from a preset: meta (Meta Muse, https://api.meta.ai/v1), openai, anthropic, deepinfra, together, groq, fireworks, openrouter, mistral, xai, gemini, or other with its own OpenAI-compatible address. A named preset keeps its own address and key style. models: the preset\'s suggested model ids to add with their prices. Add its key with ai.keys.add. Only a person adds an Other provider (it chooses where keys go). Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/control/providers', operationId: 'addAIProvider' } },
  tool: { name: 'add_ai_provider', title: 'Add an AI provider', description: 'Add a model provider (Meta, OpenAI, DeepInfra, ...) from its preset. Administrators only; a person agrees first.' },
  confirm: true,
  idempotent: false,
  idempotency: 'optional',
  replay: 'stored',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { provider: providerInput, models: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 200 }, description: 'Suggested model ids of the preset to add too.' }, reason: REASON },
    required: ['provider'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { provider: { type: 'object' }, models: { type: 'array', items: { type: 'object' } }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, {
      action: 'ai.providers.add', target: { kind: 'providers', id: input.provider.id || input.provider.preset }, doing: 'add AI providers', reason: input.reason ?? null,
      refusal: async () => (PROVIDER_PRESETS[input.provider.preset]?.baseUrlLocked ? null : 'Only a person can add a provider with an address of its own.'),
    })
    try {
      return await deps.aiCatalog.addProvider({ actor, input: input.provider, models: input.models ?? [], reason: input.reason ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiProvidersSave = defineAction({
  id: 'ai.providers.save',
  title: 'Change AI provider',
  description:
    'Changes a provider\'s name, or an Other provider\'s address, key style, tool choice and extra headers (nothing secret). A new address or key style revokes the provider\'s keys, after revokeKeys true: a key is never sent to a new address. Only a person changes where keys go. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/providers', operationId: 'saveAIProvider' } },
  tool: { name: 'save_ai_provider', title: 'Change an AI provider', description: 'Rename an AI provider, or change an Other provider\'s address. Administrators only; a person agrees first.' },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { provider: providerChange, revokeKeys: { type: 'boolean', description: 'Go ahead with a change that revokes the provider\'s keys.' }, reason: REASON },
    required: ['provider'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { provider: { type: 'object' }, revokedKeys: { type: 'array', items: { type: 'string' } }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, {
      action: 'ai.providers.save', target: { kind: 'providers', id: input.provider.id }, doing: 'change AI providers', reason: input.reason ?? null,
      refusal: async () => (['baseUrl', 'auth', 'extraHeaders', 'toolChoice'].some((key) => input.provider[key] !== undefined) || input.revokeKeys ? 'Only a person can change where a provider sends its key.' : null),
    })
    try {
      return await deps.aiCatalog.saveProvider({ actor, input: input.provider, revokeKeys: Boolean(input.revokeKeys), reason: input.reason ?? null })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiProvidersArchive = defineAction({
  id: 'ai.providers.archive',
  title: 'Archive AI provider',
  description:
    'Archives a provider, so no part of Slatebox can use it. Refused while a part uses one of its models. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  // a person only: the app's page, not a token, so no HTTP route, exec method or tool
  mounts: { ddp: true },
  confirm: true,
  destructive: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: { type: 'object', properties: { id: SLUG, reason: REASON }, required: ['id', 'reason'], additionalProperties: false },
  output: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string' }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.providers.archive', target: { kind: 'providers', id: input.id }, doing: 'archive AI providers', reason: input.reason })
    try {
      return await deps.aiCatalog.archiveProvider({ actor, id: input.id, reason: input.reason })
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiProvidersAdd, aiProvidersSave, aiProvidersArchive]
