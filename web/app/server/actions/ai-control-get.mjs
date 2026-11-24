import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'

// AI control, read side. Signed-in administrators only, over the Meteor method for now: the HTTP,
// exec, MCP and CLI mounts arrive with the admin toolset and the ai:admin:read scope, so these
// add nothing to the tool list or the exec description until then.
const SURFACE = { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]{0,47}$' }
const ID = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' }

async function requireAdmin(principal, deps) {
  if (!(await deps.aiControlAdmin(principal.userId))) throw problem(403, 'forbidden', 'Only an administrator of this server can read AI control.')
}

export const aiControlGet = defineAction({
  id: 'ai.control.get',
  title: 'AI control',
  description:
    'Returns the AI control snapshot: every surface and what it follows, providers, server connections (never keys), models, published bindings, agents, prompt heads, the global switch, and health (documents skipped because they failed their checks). Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { generation: { type: 'integer' }, dbLayer: { type: 'string' }, surfaces: { type: 'array' }, health: { type: 'array' } } },
  handler: async (principal, _input, { deps }) => {
    await requireAdmin(principal, deps)
    return deps.aiControl.get()
  },
})

export const aiControlEffective = defineAction({
  id: 'ai.control.effective',
  title: 'Effective AI binding',
  description:
    'Shows the binding each surface (or one) resolves to for a person (userId; none = someone not signed in), with the source of each field: a published binding, an AI settings choice, the settings file or the built-in default. Administrators only.',
  toolset: 'admin',
  kind: 'read',
  scope: 'ai:admin',
  principals: ['person'],
  mounts: { ddp: true },
  input: {
    type: 'object',
    properties: { surface: SURFACE, userId: ID, plan: { type: 'string', pattern: '^[a-z0-9-]{1,32}$' } },
    additionalProperties: false,
  },
  output: { type: 'object', properties: { generation: { type: 'integer' }, surfaces: { type: 'array' } } },
  handler: async (principal, input, { deps }) => {
    await requireAdmin(principal, deps)
    return deps.aiControl.effective({ surface: input.surface ?? null, userId: input.userId ?? null, plan: input.plan ?? null })
  },
})

export default [aiControlGet, aiControlEffective]
