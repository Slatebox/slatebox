// Delete a folder (empty, or its contents move up) or a whole project (its owner only): the
// owner's slates in it are deleted and everyone else's go back to them. Held in a script for the
// person to agree; mode "preview" counts what would happen.
import { defineAction } from './registry.mjs'
import { projectIdInput, projectsOf } from './project-schemas.mjs'

export default defineAction({
  id: 'projects.delete',
  title: 'Delete project',
  description:
    'Delete a folder, or a whole project. A folder that holds slates or folders moves them to moveContentsTo (its parent by default) first; a manager deletes only empty folders, the owner any. Deleting a project (its owner only) deletes the slates its owner owns in it, with their sharing and comments, and gives every other slate back to its owner. This cannot be undone. mode "preview" says how many slates would be deleted and given back without changing anything.',
  toolset: 'projects',
  kind: 'write',
  scope: 'projects:write',
  principals: ['person', 'agent'],
  destructive: true,
  modes: ['save', 'preview'],
  idempotency: 'optional',
  successStatus: 200,
  mounts: { ddp: true, http: { method: 'DELETE', path: '/projects/{projectId}', operationId: 'deleteProject' } },
  input: {
    type: 'object',
    properties: {
      projectId: projectIdInput,
      moveContentsTo: { ...projectIdInput, description: 'For a folder: where its slates and folders go (its parent by default).' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      projectId: { type: 'string' },
      deleted: { type: 'boolean' },
      folders: { type: 'integer' },
      deletedSlates: { type: 'integer', description: 'Slates of the project\'s owner that are (or would be) deleted.' },
      returnedSlates: { type: 'integer', description: 'Slates of other people that go (or would go) back to them.' },
      movedSlates: { type: 'integer', description: 'For a folder: slates moved to where its contents went.' },
      mode: { type: 'string' },
    },
    required: ['projectId', 'deleted', 'deletedSlates', 'returnedSlates'],
  },
  tool: { name: 'delete_project', title: 'Delete a project or folder', description: 'Delete a folder, or a whole project the person owns (its owner\'s slates are deleted; everyone else\'s go back to them). This cannot be undone.' },
  async handler(principal, input, { deps, mode }) {
    return projectsOf(deps).remove(principal, input.projectId, { moveContentsTo: input.moveContentsTo || null, preview: mode === 'preview' })
  },
})
