// Put a slate in a project or folder, move it to another, or take it out (projectId null). The
// slate's owner may (as an editor of where it goes); a manager tidies their own project. Moving a
// slate into a project lets the project's people open it, so a script holds the move for a yes.
import { defineAction } from './registry.mjs'
import { projectsOf } from './project-schemas.mjs'
import { shareIdInput } from './slate-schemas.mjs'

export default defineAction({
  id: 'projects.moveSlate',
  title: 'Move slate to project',
  description:
    'Put a slate in a project or folder, move it to another one, or take it out of its project (projectId null), back to its owner\'s slates. The slate\'s owner may move it into any project they can edit; a manager of its project may move any slate within that project or give it back to its owner. Everyone in a project can open its slates at their role there.',
  toolset: 'projects',
  kind: 'write',
  scope: 'projects:write',
  principals: ['person', 'agent'],
  // who can open the slate changes with its project
  confirm: true,
  idempotency: 'optional',
  successStatus: 200,
  mounts: { ddp: true, http: { method: 'POST', path: '/slates/{shareId}/project', operationId: 'moveSlateToProject' } },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      projectId: { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'The project or folder it goes in; null takes it out of its project.' },
    },
    required: ['shareId', 'projectId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { shareId: { type: 'string' }, projectId: { type: ['string', 'null'] }, moved: { type: 'boolean' }, mode: { type: 'string' } },
    required: ['shareId', 'projectId', 'moved'],
  },
  tool: { name: 'move_slate_to_project', title: 'Move a slate into a project', description: 'Put one of the person\'s slates in a project or folder, move it between them, or take it out of its project.' },
  async handler(principal, input, { deps }) {
    return projectsOf(deps).moveSlate(principal, input.shareId, input.projectId)
  },
})
