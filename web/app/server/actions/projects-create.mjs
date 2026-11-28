// Make a project (a drive the person owns, their team's when they are in one), or a folder in one.
import { defineAction } from './registry.mjs'
import { projectColorInput, projectDescriptionInput, projectIdInput, projectNameInput, projectOutput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.create',
  title: 'Create project',
  description:
    'Make a project: a drive of slates you own and can share like a shared drive (your team\'s when you are in one). With parentId, make a folder in that project or folder instead (an editor of it may; folders go at most 3 levels deep).',
  toolset: 'projects',
  kind: 'write',
  scope: 'projects:write',
  principals: ['person', 'agent'],
  idempotency: 'optional',
  mounts: { ddp: true, http: { method: 'POST', path: '/projects', operationId: 'createProject' } },
  input: {
    type: 'object',
    properties: {
      name: projectNameInput,
      description: projectDescriptionInput,
      color: projectColorInput,
      parentId: { ...projectIdInput, description: 'Make a folder in this project or folder.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { ...projectOutput.properties, mode: { type: 'string' } }, required: projectOutput.required },
  tool: { name: 'create_project', title: 'Make a project or folder', description: 'Make a project (a shareable drive for slates) or a folder in one, and return its link.' },
  async handler(principal, input, { deps }) {
    return projectsOf(deps).create(principal, input)
  },
})
