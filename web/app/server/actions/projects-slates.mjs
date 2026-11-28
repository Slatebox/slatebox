// The slates in a project, newest first: whoever owns them, for anyone with a role in the project.
import { defineAction } from './registry.mjs'
import { projectIdInput, projectsOf } from './project-schemas.mjs'
import { visibilityOf } from './slate-list.mjs'

export default defineAction({
  id: 'projects.slates',
  title: 'List project slates',
  description:
    'List the slates in a project or folder, newest first, with each one\'s link: the folder\'s own and, unless nested is false, those in its folders too. Anyone with a role in the project may, a drive link\'s holder too (linkKey, the part after /p/). Filter by name with q.',
  toolset: 'projects',
  kind: 'read',
  scope: 'projects:read',
  principals: ['person', 'guest', 'agent'],
  mounts: { ddp: true, http: { method: 'GET', path: '/projects/{projectId}/slates', operationId: 'listProjectSlates' } },
  input: {
    type: 'object',
    properties: {
      projectId: projectIdInput,
      nested: { type: 'boolean', default: true, description: 'Include the slates in its folders.' },
      q: { type: 'string', minLength: 1, maxLength: 200, description: 'Part of the slate name.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      linkKey: { type: 'string', minLength: 16, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'The key of a link to the project (/p/<key>). Not used by tokens.' },
    },
    required: ['projectId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      slates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            shareId: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
            owner: { type: 'string', enum: ['you', 'someone'] },
            projectId: { type: 'string' },
            updated: { type: ['string', 'null'] },
            url: { type: 'string' },
          },
          required: ['shareId', 'name', 'owner', 'projectId', 'url'],
        },
      },
    },
    required: ['slates'],
  },
  tool: { name: 'list_project_slates', title: 'List the slates in a project', description: 'List the slates in one of the person\'s projects or folders, newest first, with each one\'s link.' },
  async handler(principal, input, { deps }) {
    const rows = await projectsOf(deps).listSlates(principal, input.projectId, { nested: input.nested !== false, limit: input.limit ?? 50, q: input.q, linkKey: input.linkKey || null })
    const origin = deps.appOrigin()
    return {
      slates: rows.map((row) => ({
        shareId: row.shareId,
        name: row.options?.name || '',
        description: row.options?.description || '',
        visibility: visibilityOf(row.options),
        owner: row.userId === principal.userId ? 'you' : 'someone',
        projectId: row.projectId,
        updated: row.lastSaved ? new Date(row.lastSaved).toISOString() : null,
        url: new URL(`/canvas/${row.shareId}`, origin).href,
      })),
    }
  },
})
