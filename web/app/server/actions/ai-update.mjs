import { defineAction } from './registry.mjs'
import { connectionInput, level, requireLevelScope, settingsOutput, useInput } from './ai-schemas.mjs'

// Changing where AI requests go sends people's briefs and slates somewhere new, so exec holds it
// for confirmation (confirm).
export default defineAction({
  id: 'ai.update',
  title: 'Set AI',
  description:
    'Adds or changes AI connections (a cloud provider with its key, or any OpenAI-compatible endpoint with its address, optional key and model), removes some, and chooses which connection each feature uses. level me changes yours, team your team\'s (team admins), server this server\'s (administrators; ownProviders on or off lets people use their own). Mix freely: a choice names me:<name>, team:<name>, server:<name> or builtin. Keys are stored encrypted and never returned, and a run\'s record keeps its code with the apiKey replaced; still, send a key through this route, the CLI or the update_ai_settings tool rather than building it inside an exec script. Returns the settings as ai.get does. A token needs ai:admin as well for level team or server. Own AI (levels me and team) is for self-hosted Slatebox: Slatebox Cloud refuses it, as AI there comes with Slatebox Pro credits and top-ups.',
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
  cli: { command: 'ai-set' },
  precheck: (principal, input) => requireLevelScope(principal, input.level),
  handler: (principal, input, { deps }) => {
    requireLevelScope(principal, input.level)
    return deps.ai.update(principal.userId, input)
  },
})
