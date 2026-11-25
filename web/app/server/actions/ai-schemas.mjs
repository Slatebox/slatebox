import { problem } from './errors.mjs'
import { lacksScopeText } from './registry.mjs'
import { USE_SURFACES } from '../ai-control/catalogue.mjs'

// The AI settings as every surface sends and reads them (ai.get, ai.update, ai.check).
const ref = {
  type: ['string', 'null'],
  maxLength: 48,
  description: 'me:<name> or team:<name> for a connection, builtin for this server\'s model (Admin → AI control), null to clear.',
}

// One property per surface of the catalogue (ai-control/catalogue.mjs): default, the features and
// their parts (chat.route, workshop, agent.slatebox, ...). An unset part follows its parent.
export const useInput = {
  type: 'object',
  properties: Object.fromEntries(USE_SURFACES.map((s) => [s.id, ref])),
  additionalProperties: false,
  description: 'Which connection each feature uses. An unset feature follows the one it belongs to (workshop follows chat), and default serves every feature not named.',
}

export const connectionInput = {
  type: 'object',
  properties: {
    name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$', description: 'Your name for it, for example desk-model.' },
    type: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$', description: 'The provider: openai-compatible (any host or local server: Ollama, llama.cpp, vLLM, LM Studio and others), a named one (meta, openai, anthropic, deepinfra, together, groq, fireworks, openrouter, mistral, xai, gemini), or one an administrator added.' },
    baseUrl: { type: 'string', maxLength: 500, description: 'For openai-compatible: the address up to /v1, for example http://host.docker.internal:11434/v1.' },
    model: { type: 'string', maxLength: 200, description: 'The model name the endpoint serves.' },
    apiKey: { type: 'string', maxLength: 400, writeOnly: true, description: 'Stored encrypted and never shown again. Leave it out to keep the saved key; send an empty string to remove it.' },
    capabilities: {
      type: 'object',
      properties: { tools: { type: 'boolean' }, vision: { type: 'boolean' }, images: { type: 'boolean' } },
      additionalProperties: false,
      description: 'What the model can do, where you know it. Unset means try it; making images needs images: true.',
    },
    maxTokens: { type: 'integer', minimum: 256, maximum: 200000 },
    toolChoice: { type: 'string', enum: ['auto', 'named', 'required'], description: 'How the endpoint takes a forced tool call: named (the function by name), required (any tool, for an endpoint with no named form) or auto (the model decides, for an endpoint that refuses the others).' },
  },
  required: ['name', 'type'],
  additionalProperties: false,
}

// Who made a change, as the AI control audit trail records it (spec 1.8): the account, whether a
// person (the app) or an agent (a token) made it, the token, and the way in: ddp (the app), exec
// (a script; MCP and the CLI run through it), or http (/api/v1).
export function actorOf(principal) {
  const agent = principal?.kind === 'agent'
  let via = agent ? 'http' : 'ddp'
  if (principal?.runId) via = 'exec'
  return { userId: principal?.userId ?? null, principal: agent ? 'agent' : 'person', ...(principal?.tokenId && { tokenId: principal.tokenId }), via }
}

// A token with ai:settings reads, changes and tests its owner's own AI. Changing or testing a
// team's or the server's AI (which redirects other people's requests) needs ai:admin as well.
export function requireLevelScope(principal, level) {
  if (principal.kind !== 'agent' || !level || level === 'me') return
  if (!principal.scopes?.includes('ai:admin')) {
    throw problem(403, 'insufficient_scope', lacksScopeText(principal, 'ai:admin', `, which changing or testing the ${level}'s AI needs`), { details: { requiredScope: 'ai:admin' } })
  }
}

export const level = { type: 'string', enum: ['me', 'team', 'server'], description: 'me (yours), team (team admins) or server (administrators).' }

export const settingsOutput = {
  type: 'object',
  properties: {
    features: { type: 'array', items: { type: 'object' } },
    surfaces: { type: 'array', items: { type: 'object' }, description: 'Every feature and part a choice may name, with the one it follows while unset.' },
    useKeys: { type: 'array', items: { type: 'string' } },
    ownProviders: { type: 'boolean' },
    keysAvailable: { type: 'boolean' },
    hosted: { type: 'boolean' },
    mine: { type: ['object', 'null'] },
    team: { type: ['object', 'null'] },
    server: { type: 'object' },
    effective: { type: 'object' },
  },
  required: ['features', 'ownProviders', 'server', 'effective'],
}
