// One project or folder: what it is, the caller's role, the folders in it and the way up to its drive.
import { defineAction } from './registry.mjs'
import { projectIdInput, projectOutput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.get',
  title: 'Get project',
  description:
    'Read a project or one of its folders: its name, your role, the folders directly in it, the folders above it and how many slates it holds. A drive link\'s key (linkKey, the part after /p/) opens a project shared by link.',
  toolset: 'projects',
  kind: 'read',
  scope: 'projects:read',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/projects/{projectId}', operationId: 'getProject' } },
  input: {
    type: 'object',
    properties: {
      projectId: projectIdInput,
      linkKey: { type: 'string', minLength: 16, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'The key of a link to the project (/p/<key>). Not used by tokens.' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ...projectOutput.properties,
      path: { type: 'array', items: { type: 'object', properties: { projectId: { type: 'string' }, name: { type: 'string' } }, required: ['projectId', 'name'] } },
      folders: { type: 'array', items: { type: 'object', properties: { projectId: { type: 'string' }, name: { type: 'string' }, depth: { type: 'integer' } }, required: ['projectId', 'name'] } },
      slateCount: { type: 'integer', minimum: 0 },
      ownerName: { type: 'string' },
    },
    required: [...projectOutput.required, 'path', 'folders', 'slateCount'],
  },
  tool: { name: 'get_project', title: 'Read a project', description: 'Read one of the person\'s projects or folders: its folders, its place in the project and the person\'s role.' },
  async handler(principal, input, { deps }) {
    return projectsOf(deps).get(principal, input.projectId, { linkKey: input.linkKey || null })
  },
})
