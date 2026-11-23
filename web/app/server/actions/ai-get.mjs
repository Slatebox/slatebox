import { defineAction } from './registry.mjs'
import { settingsOutput } from './ai-schemas.mjs'

export default defineAction({
  id: 'ai.get',
  title: 'Read AI settings',
  description:
    'The AI connections you, your team and this server have (never their keys), which one each feature uses (chat, generation, presentation, vision, images, shape, and the default), and which connection serves each feature for you now (effective), with what it cannot do. ownProviders false means this server uses only the AI its operator set up.',
  toolset: 'account',
  kind: 'read',
  scope: 'ai:settings',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai', operationId: 'getAISettings' } },
  tool: { name: 'get_ai_settings', title: 'Read your AI settings', description: 'Read which AI connections the person, their team and this server have, and which one each Slatebox feature uses. Keys are never returned.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: settingsOutput,
  cli: { command: 'ai' },
  handler: (principal, _input, { deps }) => deps.ai.view(principal.userId),
})
