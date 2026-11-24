import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf, connectionInput, level, requireLevelScope } from './ai-schemas.mjs'
import { agentConnectionRefusal } from './ai-connections.mjs'

// Test connection. It changes nothing (readOnly), but it reaches an outside address (openWorld)
// and may carry a key, so it is a POST.
export default defineAction({
  id: 'ai.check',
  title: 'Test AI',
  description:
    'Tests a saved connection (name) or one not yet saved (connection): whether Slatebox can reach it, whether it accepts the key, which models it lists where it lists them, whether the model answers and whether it calls tools (which conversation, drafts and presentations need). Saves nothing. A saved key is only sent to the address it was saved for. A token needs ai:admin as well for level team or server. On a self-hosted server a model on the host is at host.docker.internal, not localhost.',
  toolset: 'account',
  kind: 'write',
  scope: 'ai:settings',
  alsoScopes: ['ai:admin'],
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/check', operationId: 'checkAIConnection' } },
  tool: { name: 'check_ai_connection', title: 'Test an AI connection', description: 'Test whether Slatebox can reach an AI connection (a provider key, or an OpenAI-compatible endpoint) before it is used for drafting.' },
  readOnly: true,
  openWorld: true,
  idempotent: true,
  // exec derives a key per call; a replay runs again (no stored answer to go stale)
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      level,
      name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' },
      connection: connectionInput,
    },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      reachable: { type: 'boolean' },
      models: { type: ['array', 'null'], items: { type: 'string' } },
      modelListed: { type: ['boolean', 'null'] },
      chat: { type: 'string', enum: ['ok', 'failed'] },
      tools: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      message: { type: 'string' },
    },
    required: ['ok', 'reachable', 'tools', 'message'],
  },
  precheck: (principal, input) => requireLevelScope(principal, input.level),
  handler: async (principal, input, { deps }) => {
    requireLevelScope(principal, input.level)
    // From a token, an unsaved server connection is tested only where an agent could save it (a
    // provider's fixed address, no key): otherwise a test would reach any address the server can,
    // private ones included, and send it a key (spec 6.2). A saved one is tested by name.
    if (principal.kind === 'agent' && input.level === 'server' && input.connection && await deps.aiControlAdmin?.(principal.userId)) {
      const why = await agentConnectionRefusal(deps, principal.userId, [{ name: input.connection.name ?? 'test', ...input.connection }])
      if (why) {
        await deps.aiControlStore?.refused({ action: 'ai.check', actor: actorOf(principal), target: { kind: 'connection', id: String(input.connection.name ?? 'unsaved') }, error: why, trusted: true }).catch(() => {})
        throw problem(403, 'forbidden', `${why} Test a saved connection by its name instead.`, { details: { personOnly: true } })
      }
    }
    return deps.ai.check(principal.userId, input)
  },
})
