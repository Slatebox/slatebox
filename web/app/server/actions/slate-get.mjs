import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { ref, shareIdInput } from './slate-schemas.mjs'
import { SELECTION_INPUT } from '../slate-read.mjs'
import { publicAction } from '../agents/suggestions.mjs'

// The one read of a slate (server/slate-read.mjs). A public slate reads without a token,
// limited per address; everything else needs a token whose account may open it.
export default defineAction({
  id: 'slates.get',
  title: 'Read a slate',
  description:
    'Read a slate you can open: every note with every key a write sets, its connectors, what you may do here (access), its address, comments, conversation starters and, on a workshop or map, the workshop with its own revision (the one workshop and map edits use) and what it takes in plain words (workshop.can). revision is the slate\'s save count: send it as expectedRevision with an edit, and the edit is refused only if a note it changes was changed since. Select notes with ids, within, groupId or q (the notes a write naming that text would change) and keys with fields; page with cursor. include=full adds the slate as the engine loads it; include=suggestions adds what agents suggested here (waiting for people to keep or discard, with their ids) and what became of each agent\'s recent edits. A public slate reads without a token.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}', operationId: 'getSlate' } },
  input: {
    type: 'object',
    properties: { shareId: shareIdInput, include: { type: 'string', enum: ['full', 'suggestions'] }, ...SELECTION_INPUT },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: ref('SlateRead'),
  load: loadSlate(false),
  tool: { name: 'get_slate', title: 'Read a slate', description: 'Read a slate\'s notes, lines, boards, comments and revision. An edit names the revision it was made on (expectedRevision).' },
  async handler(_principal, input, { deps, resource: slate, access }) {
    if (input.include !== 'suggestions' || !deps.suggestions) return deps.readSlate(slate, access, input)
    // What agents suggested here: the same list the canvas draws (suggestions.list), read with the slate.
    const { include: _suggestions, ...rest } = input
    const [body, actions, controls] = await Promise.all([
      deps.readSlate(slate, access, rest),
      deps.suggestions.list(slate._id),
      deps.suggestions.controlsOf(slate._id),
    ])
    return { ...body, suggestions: { paused: controls.paused, actions: actions.map(publicAction) } }
  },
})
