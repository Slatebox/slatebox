import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf } from './ai-schemas.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { REASON, SLUG, asProblem, providerInput } from './ai-control-schemas.mjs'
import { agentRefusal } from '../ai-control/key-policy.mjs'

// Providers (spec 1.1): vendor templates as data. A vendor that speaks one of the wire protocols
// needs no deploy. Administrators only, on every surface; toolset admin keeps them out of everyone
// else's typed tools and the exec description.

/**
 * The checks every AI control write makes before it changes anything: an administrator of this
 * server; for an agent, nothing that decides where a key goes (spec 6.2); the write rate. A refused
 * attempt is recorded (spec 6.6). refusal(previous) → a reason an agent may not make this write, or null.
 */
export async function guardControlWrite(principal, deps, { action, target, doing, reason = null, refusal = null }) {
  const actor = actorOf(principal)
  const refuse = async (error) => {
    await deps.aiControlStore?.refused({ action, actor, target, reason, error: error.message }).catch(() => {})
    throw error
  }
  try {
    await requireAIControlAdmin(principal, deps, doing)
  } catch (error) {
    await refuse(error)
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

export const aiProvidersSave = defineAction({
  id: 'ai.providers.save',
  title: 'Save AI provider',
  description:
    'Adds or changes a provider template: its wire protocol (openai-chat, anthropic-messages or openai-images), address, how the key is sent (bearer, a header, a query parameter or none), extra headers (nothing secret) and what its models can usually do. Built-in providers cannot be changed. Changing an address removes the keys of the connections that use it, after dropKeys true; a key is never sent to a new address. Only a person sets an address, key style or headers. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/providers', operationId: 'saveAIProvider' } },
  tool: { name: 'save_ai_provider', title: 'Save an AI provider', description: 'Add or change an AI provider template (wire protocol, address, key style). Administrators only; a person agrees first.' },
  confirm: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { provider: providerInput, dropKeys: { type: 'boolean', description: 'Go ahead with an address change that removes connections\' keys.' }, reason: REASON },
    required: ['provider'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { provider: { type: 'object' }, droppedKeys: { type: 'array', items: { type: 'string' } }, generation: { type: ['integer', 'null'] } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, {
      action: 'ai.providers.save', target: { kind: 'providers', id: input.provider.id }, doing: 'change AI providers', reason: input.reason ?? null,
      refusal: async () => agentRefusal('provider', input.provider, await deps.aiCatalog.readProvider(input.provider.id)),
    })
    if (input.dropKeys && principal.kind === 'agent') throw problem(403, 'forbidden', 'Only a person can remove connections\' keys.')
    try {
      const { userId: _u, ...out } = await deps.aiCatalog.saveProvider({ userId: principal.userId, actor, input: input.provider, dropKeys: Boolean(input.dropKeys), reason: input.reason ?? null })
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiProvidersArchive = defineAction({
  id: 'ai.providers.archive',
  title: 'Archive AI provider',
  description:
    'Archives a provider an administrator added, so no new connection can use it. Refused while any connection uses it, and for built-in providers. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  // a person only (spec 4): the app's page, not a token, so no HTTP route, exec method or tool
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

export default [aiProvidersSave, aiProvidersArchive]
