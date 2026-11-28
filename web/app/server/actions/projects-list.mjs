// The person's projects: the drives they own, then those shared with them (by name, through their
// team, or as their team's admin). With parentId: the folders in that project or folder.
import { defineAction } from './registry.mjs'
import { projectIdInput, projectOutput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.list',
  title: 'List projects',
  description:
    'List your projects (shareable drives of slates): the ones you own first, then the ones shared with you, each with your role. With parentId, list the folders in that project or folder instead.',
  toolset: 'projects',
  kind: 'read',
  scope: 'projects:read',
  principals: ['person', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/projects', operationId: 'listProjects' } },
  input: {
    type: 'object',
    properties: { parentId: { ...projectIdInput, description: 'List the folders in this project or folder.' } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: { projects: { type: 'array', items: projectOutput } },
    required: ['projects'],
  },
  tool: { name: 'list_projects', title: 'List your projects', description: 'List the person\'s projects (shared drives that hold slates and folders), owned and shared, with their role in each.' },
  async handler(principal, input, { deps }) {
    return { projects: await projectsOf(deps).list(principal, { parentId: input.parentId || null }) }
  },
})
