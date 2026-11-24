import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { requireAIControlAdmin } from './ai-control-get.mjs'
import { guardControlWrite } from './ai-providers.mjs'
import { REASON, SLUG, asProblem, serverConnectionInput } from './ai-control-schemas.mjs'
import { agentRefusal } from '../ai-control/key-policy.mjs'
import { BUILTIN_PROVIDERS } from '../ai-control/providers.mjs'
import { bindingsUsing } from '../ai-control/models.mjs'
import { connectionType } from '../methods/ai/connections.mjs'

// The server's connections (spec 1.2, 3.2): an endpoint and its key, kept in providerKeys with the
// key sealed under the server's key-encryption key. No action returns a key, a cipher or anything
// opened from one. Administrators only; toolset admin.

// A change to the server's connections moves the AI control generation, so every pod reloads its
// snapshot (which lists the server's connections) within one poll; this pod at once.
async function moveGeneration(deps, actor) {
  try {
    await deps.aiControlStore?.bump(actor)
    await deps.aiControl?.refresh?.({ force: true })
  } catch (error) {
    console.warn(`ai-control: the generation did not move after a connection change: ${error.message}`)
  }
}

export const aiConnectionsList = defineAction({
  id: 'ai.connections.list',
  title: 'AI connections',
  description:
    'Lists the server\'s AI connections: the settings file\'s (read-only) and the ones saved in the app, including the services beside the models (Stability, Google picture search, Noun Project, Deepgram). For each: its provider, address, model, where its key lives (sealed, an environment variable, the settings file or none), which key it is (a fingerprint, never the key), its last test and whether it is turned off. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/connections', operationId: 'listAIConnections' } },
  tool: { name: 'list_ai_connections', title: 'List AI connections', description: 'List this server\'s AI connections and which key each uses, never the key itself. Administrators only.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { connections: { type: 'array', items: { type: 'object' } }, keysAvailable: { type: 'boolean' } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps)
    return deps.ai.serverConnections(principal.userId)
  },
})

export const aiConnectionsSave = defineAction({
  id: 'ai.connections.save',
  title: 'Save AI connections',
  description:
    'Adds or changes server connections: a provider, address, model and key. A key is sealed with the server\'s key and never returned; keyRef env reads it from an environment variable named SLATEBOX_AI_KEY_… for each request; rotate {graceHours} keeps the old key working for 1 or 24 hours. status disabled keeps a connection but sends nothing to it. Also connects the services beside the models (stability, google-cse with its search engine ID as model, nounproject as key:secret, deepgram). Only a person sends a key, names an environment variable or changes an address or provider; an agent may save a keyless connection to a provider with a fixed address. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai/control/connections', operationId: 'saveAIConnections' } },
  tool: { name: 'save_ai_connections', title: 'Save AI connections', description: 'Add or change this server\'s AI connections and their keys. Keys are stored encrypted and never returned. Administrators only; a person agrees first.' },
  confirm: true,
  // it can overwrite a saved key
  destructive: true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: { connections: { type: 'array', minItems: 1, maxItems: 20, items: serverConnectionInput }, reason: REASON },
    required: ['connections'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { connections: { type: 'array', items: { type: 'string' } }, fingerprints: { type: 'object' } } },
  handler: async (principal, input, { deps }) => {
    const names = input.connections.map((c) => c.name).join(',')
    const actor = await guardControlWrite(principal, deps, {
      action: 'ai.connections.save', target: { kind: 'connection', id: names }, doing: 'change the server\'s AI connections', reason: input.reason ?? null,
      refusal: async () => {
        const { connections } = await deps.ai.serverConnections(principal.userId)
        for (const connection of input.connections) {
          const previous = connections.find((c) => c.name === connection.name && c.editable)
          const provider = connectionType(connection.type ?? previous?.provider) || BUILTIN_PROVIDERS[connection.type] || null
          const why = agentRefusal('connection', connection, previous ? { provider: previous.provider, baseUrl: previous.baseUrl } : null, { provider })
          if (why) return `${connection.name}: ${why}`
        }
        return null
      },
    })
    try {
      const out = await deps.ai.saveServerConnections(principal.userId, input.connections, { actor, reason: input.reason ?? null })
      await moveGeneration(deps, actor)
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export const aiConnectionsRemove = defineAction({
  id: 'ai.connections.remove',
  title: 'Remove AI connections',
  description:
    'Removes server connections saved in the app, with their keys. Choices that name one are cleared, so those features use the settings file or the built-in AI. Refused while a published binding uses one, unless force lists those bindings. Needs a reason. A person only. Administrators only.',
  toolset: 'admin',
  kind: 'write',
  scope: 'ai:admin',
  principals: ['person'],
  // a person only (spec 4): the app's page, not a token, so no HTTP route, exec method or tool
  mounts: { ddp: true },
  confirm: true,
  destructive: true,
  removes: () => true,
  idempotent: true,
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      names: { type: 'array', minItems: 1, maxItems: 20, items: SLUG },
      force: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 200 }, description: 'Bindings that may fall back because their connection goes.' },
      reason: REASON,
    },
    required: ['names', 'reason'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { removed: { type: 'array', items: { type: 'string' } }, clearedChoices: { type: 'array', items: { type: 'string' } } } },
  handler: async (principal, input, { deps }) => {
    const actor = await guardControlWrite(principal, deps, { action: 'ai.connections.remove', target: { kind: 'connection', id: input.names.join(',') }, doing: 'remove the server\'s AI connections', reason: input.reason })
    if (!input.reason.trim()) throw problem(400, 'invalid_request', 'Say why: removing a connection needs a reason.', { details: { field: 'reason' } })
    try {
      const out = await deps.ai.removeServerConnections(principal.userId, {
        names: input.names, force: input.force ?? [], reason: input.reason, actor,
        inUse: async (names) => bindingsUsing(deps.aiControl.snapshot(), names),
      })
      await moveGeneration(deps, actor)
      return out
    } catch (error) {
      throw asProblem(error)
    }
  },
})

export default [aiConnectionsList, aiConnectionsSave, aiConnectionsRemove]
