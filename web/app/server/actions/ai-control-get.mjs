import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'

// AI control, read side: administrators of this server only, on every surface (the app, /api/v1,
// exec and so MCP and the CLI). toolset admin: these are exec client methods and HTTP routes, but
// not typed MCP tools and not lines of the exec description, so nobody else's tool list grows
// (client-render.mjs). A token needs ai:admin:read (ai:admin holds it too).
const SURFACE = { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]{0,47}$' }
const ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }

export async function requireAIControlAdmin(principal, deps, doing = 'read AI control') {
  if (!(await deps.aiControlAdmin(principal.userId))) throw problem(403, 'forbidden', `Only an administrator of this server can ${doing}.`)
}

export const aiControlGet = defineAction({
  id: 'ai.control.get',
  title: 'AI control',
  description:
    'Returns the AI control snapshot: every surface and what it follows, providers, server connections (never keys), models, published bindings, agents, prompt heads, the global switch, and health (documents skipped because they failed their checks). Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control', operationId: 'getAIControl' } },
  tool: { name: 'get_ai_control', title: 'Read AI control', description: 'Read which AI answers each part of Slatebox on this server, where each choice comes from, and any problems. Administrators only; keys are never returned.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { generation: { type: 'integer' }, dbLayer: { type: 'string' }, surfaces: { type: 'array' }, health: { type: 'array' } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps)
    return deps.aiControl.get()
  },
})

export const aiControlEffective = defineAction({
  id: 'ai.control.effective',
  title: 'Effective AI binding',
  description:
    'Shows the binding each surface (or one) resolves to for a person (userId; none = someone not signed in), with the source of each field: a published binding, an AI settings choice, the settings file or the built-in default. usage true adds each surface\'s calls, failed calls and spend over the last 24 hours. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/effective', operationId: 'getAIControlEffective' } },
  tool: { name: 'get_ai_control_effective', title: 'Read effective AI bindings', description: 'Read which model, prompts and limits each part of Slatebox uses for one person, and where each comes from. Administrators only.' },
  input: {
    type: 'object',
    properties: { surface: SURFACE, userId: ID, plan: { type: 'string', pattern: '^[a-z0-9-]{1,32}$' }, usage: { type: 'boolean' } },
    additionalProperties: false,
  },
  output: { type: 'object', properties: { generation: { type: 'integer' }, surfaces: { type: 'array' }, usage: { type: 'object' } } },
  handler: async (principal, input, { deps }) => {
    await requireAIControlAdmin(principal, deps)
    const view = await deps.aiControl.effective({ surface: input.surface ?? null, userId: input.userId ?? null, plan: input.plan ?? null })
    if (!input.usage) return view
    return { ...view, usage: await deps.aiControlOps.usage({ hours: 24 }) }
  },
})

export const aiControlHealth = defineAction({
  id: 'ai.control.health',
  title: 'AI control health',
  description:
    'Lists AI control problems: documents skipped because they failed their checks (that surface falls back to the settings file and built-in defaults), and published prompts that fell back to their built-in text. An empty list means nothing is wrong. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/ai/control/health', operationId: 'getAIControlHealth' } },
  tool: { name: 'get_ai_control_health', title: 'Read AI control problems', description: 'Read the problems with this server\'s AI set-up: settings that were skipped and prompts that fell back to built-in text. Administrators only.' },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { generation: { type: 'integer' }, dbLayer: { type: 'string' }, health: { type: 'array' } } },
  handler: async (principal, _input, { deps }) => {
    await requireAIControlAdmin(principal, deps)
    const snap = deps.aiControl.snapshot()
    return { generation: snap.generation, dbLayer: snap.dbLayer, source: snap.source, health: deps.aiControl.health() }
  },
})

export default [aiControlGet, aiControlEffective, aiControlHealth]
