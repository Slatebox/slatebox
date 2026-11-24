import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { actorOf, connectionInput, level, requireLevelScope, settingsOutput, useInput } from './ai-schemas.mjs'
import { agentConnectionRefusal } from './ai-connections.mjs'

// Changing where AI requests go sends people's briefs and slates somewhere new, so exec holds it
// for confirmation (confirm).
export default defineAction({
  id: 'ai.update',
  title: 'Set AI',
  description:
    'Adds or changes AI connections (a cloud provider with its key, or any OpenAI-compatible endpoint with its address, optional key and model), removes some, and chooses which connection each feature uses. level me changes yours, team your team\'s (team admins), server this server\'s (administrators; ownProviders on or off lets people use their own). Mix freely: a choice names me:<name>, team:<name>, server:<name> or builtin. Keys are stored encrypted and never returned, and a run\'s record keeps its code with the apiKey replaced. Returns the settings as ai.get does. A token needs ai:admin as well for level team or server. Own AI (levels me and team) is for self-hosted Slatebox: Slatebox Cloud refuses it, as AI there comes with Slatebox Pro credits and top-ups.',
  toolset: 'account',
  kind: 'write',
  scope: 'ai:settings',
  alsoScopes: ['ai:admin'],
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'PUT', path: '/ai', operationId: 'updateAISettings' } },
  tool: { name: 'update_ai_settings', title: 'Change AI connections and choices', description: 'Add, change or remove the AI connections Slatebox drafts with, and choose which connection each feature uses.' },
  confirm: true,
  // It can remove connections and overwrite a saved key. Every change is held (confirm); the
  // person is told it removes something when it names connections to remove.
  destructive: true,
  removes: (input) => Array.isArray(input.remove) && input.remove.length > 0,
  idempotent: true,
  // exec derives a key per call; a replay runs again (no stored answer to go stale)
  idempotency: 'optional',
  replay: 'rerun',
  successStatus: 200,
  input: {
    type: 'object',
    properties: {
      level,
      connections: { type: 'array', maxItems: 20, items: connectionInput },
      remove: { type: 'array', maxItems: 20, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' } },
      use: useInput,
      ownProviders: { type: 'string', enum: ['on', 'off'] },
    },
    required: ['level'],
    additionalProperties: false,
  },
  output: settingsOutput,
  precheck: (principal, input) => requireLevelScope(principal, input.level),
  handler: async (principal, input, { deps }) => {
    requireLevelScope(principal, input.level)
    if (principal.kind === 'agent' && input.level === 'server') await refuseAgentServerChange(principal, input, deps)
    return deps.ai.update(principal.userId, input, { actor: actorOf(principal) })
  },
})

// The server level from a token (spec 6.2, 4): the same person-only rule as ai.connections.save for
// keys, addresses and providers, and no choices or removals, because those publish the server's
// bindings (bindings.mjs syncServerUse) and only a person publishes. An agent proposes a binding
// with ai.bindings.saveDraft instead. Checked for administrators only (anyone else is refused by
// ai.update itself), and each refusal is kept in the audit trail.
async function refuseAgentServerChange(principal, input, deps) {
  if (!(await deps.aiControlAdmin?.(principal.userId))) return
  let why = null
  if (input.use && Object.keys(input.use).length) why = 'Only a person can choose which AI answers for the whole server: it publishes the server\'s bindings. Save a draft with ai.bindings.saveDraft for a person to publish.'
  else if (input.remove?.length) why = 'Only a person can remove the server\'s connections.'
  else if (input.connections?.length) why = await agentConnectionRefusal(deps, principal.userId, input.connections)
  if (!why) return
  await deps.aiControlStore?.refused({ action: 'ai.update', actor: actorOf(principal), target: { kind: 'aiSettings', id: 'server' }, error: why, trusted: true }).catch(() => {})
  throw problem(403, 'forbidden', why, { details: { personOnly: true } })
}
