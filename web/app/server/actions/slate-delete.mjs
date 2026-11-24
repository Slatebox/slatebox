// Delete a slate, for agents: the rule the Slates page's Delete follows (slates.remove). Only
// the slate's owner may. Deleting takes the slate's sharing, comments and messages with it. In an exec script it is held for the person to agree.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'

export default defineAction({
  id: 'slates.delete',
  title: 'Delete slate',
  description:
    'Delete one of your own slates, with its sharing, comments and messages. Only the slate\'s owner can. This cannot be undone.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:delete',
  principals: ['agent'],
  destructive: true,
  // A retried delete answers what the first one did.
  idempotency: 'optional',
  mounts: { http: { method: 'DELETE', path: '/slates/{shareId}', operationId: 'deleteSlate' } },
  input: { type: 'object', properties: { shareId: shareIdInput }, required: ['shareId'], additionalProperties: false },
  output: {
    type: 'object',
    properties: { shareId: { type: 'string' }, deleted: { type: 'boolean' } },
    required: ['shareId', 'deleted'],
  },
  successStatus: 200,
  async load(principal, input, ctx) {
    const slate = await loadSlate(true)(principal, input, ctx)
    if (!ctx.access?.isOwner) throw problem(403, 'forbidden', 'Only the slate\'s owner can delete it.')
    return slate
  },
  tool: { name: 'delete_slate', title: 'Delete a slate', description: 'Delete one of the person\'s own slates. This cannot be undone.' },
  async handler(_principal, input, { deps, resource: slate }) {
    await deps.deleteSlate(slate)
    return { shareId: input.shareId, deleted: true }
  },
})
