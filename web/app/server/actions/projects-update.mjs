// Rename a project or folder, change its description or dot, move a folder within its project, or
// pause the project's recipes.
import { defineAction } from './registry.mjs'
import { projectColorInput, projectDescriptionInput, projectIdInput, projectNameInput, projectOutput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.update',
  title: 'Update project',
  description:
    'Rename a project or folder, change its description or color, move a folder to another folder of the same project (parentId), or pause and resume the recipes that keep the project\'s slates up to date (recipesPaused, a whole project only). A project is renamed by its owner and managers; a folder by its editors; folders are moved by managers.',
  toolset: 'projects',
  kind: 'write',
  scope: 'projects:write',
  principals: ['person', 'agent'],
  idempotency: 'optional',
  mounts: { ddp: true, http: { method: 'PATCH', path: '/projects/{projectId}', operationId: 'updateProject' } },
  input: {
    type: 'object',
    properties: {
      projectId: projectIdInput,
      name: projectNameInput,
      description: projectDescriptionInput,
      color: projectColorInput,
      parentId: { ...projectIdInput, description: 'Move this folder into that folder (or the project itself).' },
      recipesPaused: { type: 'boolean', description: 'Pause (true) or resume (false) every recipe in the project.' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { ...projectOutput.properties, mode: { type: 'string' } }, required: projectOutput.required },
  tool: { name: 'update_project', title: 'Rename or reorganize a project', description: 'Rename a project or folder, move a folder within its project, or pause its recipes.' },
  async handler(principal, input, { deps }) {
    const { projectId, ...patch } = input
    return projectsOf(deps).update(principal, projectId, patch)
  },
})
