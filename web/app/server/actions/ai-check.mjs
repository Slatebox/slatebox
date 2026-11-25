import { defineAction } from './registry.mjs'
import { connectionInput, requireLevelScope } from './ai-schemas.mjs'

// Test connection. It changes nothing (readOnly), but it reaches an outside address (openWorld)
// and may carry a key, so it is a POST.
export default defineAction({
  id: 'ai.check',
  title: 'Test AI',
  description:
    'Tests your own or your team\'s saved connection (name) or one not yet saved (connection), on a self-hosted server: whether Slatebox can reach it, whether it accepts the key, which models it lists, whether the model answers and whether it calls tools (which conversation, drafts and presentations need). Saves nothing. A saved key is only sent to the address it was saved for. A token needs ai:admin as well for level team. The server\'s keys are tested with ai.keys.test. A model on the host is at host.docker.internal, not localhost.',
  toolset: 'account',
  kind: 'write',
  scope: 'ai:settings',
  alsoScopes: ['ai:admin'],
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'POST', path: '/ai/check', operationId: 'checkAIConnection' } },
  tool: { name: 'check_ai_connection', title: 'Test a model connection', description: 'Test whether Slatebox can reach a model connection (a provider key, or an OpenAI-compatible endpoint) before the Slatebox agent drafts with it.' },
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
      level: { type: 'string', enum: ['me', 'team'], description: 'me (yours) or team (team admins).' },
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
    return deps.ai.check(principal.userId, input)
  },
})
