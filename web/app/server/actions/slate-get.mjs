import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { ref, shareIdInput } from './slate-schemas.mjs'
import { SELECTION_INPUT } from '../slate-read.mjs'

// The one read of a slate (server/slate-read.mjs). A public slate reads without a token,
// limited per address; everything else needs a token whose account may open it.
export default defineAction({
  id: 'slates.get',
  title: 'Read a slate',
  description:
    'Read a slate you can open: every note with every key a write sets, its connectors, what you may do here (access), its address, comments, conversation starters and, on a workshop or map, the workshop with its own revision (the one workshop and map edits use) and what it takes in plain words (workshop.can). revision is the slate\'s save count: send it as expectedRevision with an edit, and the edit is refused only if a note it changes was changed since. Select notes with ids, within, groupId or q (the notes a write naming that text would change) and keys with fields; page with cursor. include=full adds the slate as the engine loads it. A public slate reads without a token.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}', operationId: 'getSlate' } },
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, include: { type: 'string', enum: ['full'] }, ...SELECTION_INPUT },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: ref('SlateRead'),
  load: loadSlate(false),
  tool: { name: 'get_slate', title: 'Read a slate', description: 'Read a slate\'s notes, lines, boards, comments and revision. Read before editing: an edit names the revision it was made on.' },
  cli: { command: 'read' },
  handler(_principal, input, { deps, resource: slate, access }) {
    return deps.readSlate(slate, access, input)
  },
})
