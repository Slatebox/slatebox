// Who a project is shared with: its owner, the people and teams it names (with invitations to
// addresses that have no account yet) and its link. A manager of the project may read it.
import { defineAction } from './registry.mjs'
import { projectAccessOutput, projectIdInput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.access',
  title: 'Get project sharing',
  description:
    'Who can open a project: its owner, each person and team it is shared with and their role, invitations to addresses with no account yet, and the link\'s role and address. The project\'s owner and managers may read it.',
  toolset: 'projects',
  kind: 'read',
  scope: 'projects:share',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/projects/{projectId}/access', operationId: 'getProjectAccess' } },
  input: { type: 'object', properties: { projectId: projectIdInput }, required: ['projectId'], additionalProperties: false },
  output: projectAccessOutput,
  tool: { name: 'get_project_sharing', title: 'See who a project is shared with', description: 'See who can open one of the person\'s projects, with each person\'s and team\'s role and the link\'s.' },
  async handler(principal, input, { deps }) {
    return projectsOf(deps).getAccess(principal, input.projectId)
  },
})
