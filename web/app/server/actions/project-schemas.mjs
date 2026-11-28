// The shapes the projects actions share (server/actions/projects-*.mjs): a project's id, what a
// caller sees of a project, and who a project is shared with.
import { GRANTABLE_ROLES, LINK_ROLES, PROJECT_COLORS, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX } from '../../imports/api/common/project-roles.mjs'

export const projectIdInput = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9_-]+$',
  description: 'A project (a drive) or one of its folders.',
}

export const projectNameInput = { type: 'string', minLength: 1, maxLength: PROJECT_NAME_MAX }
export const projectDescriptionInput = { type: 'string', maxLength: PROJECT_DESCRIPTION_MAX }
export const projectColorInput = { type: ['integer', 'null'], minimum: 0, maximum: PROJECT_COLORS - 1, description: 'A palette index for the project\'s dot.' }

const ROLE = { type: 'string', enum: ['owner', 'manager', 'editor', 'commenter', 'viewer'] }

export const projectOutput = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
    kind: { type: 'string', enum: ['drive', 'folder'], description: 'A drive is a project; a folder sits in one.' },
    driveId: { type: 'string', description: 'The project this folder is in (the project itself for a drive).' },
    parentId: { type: ['string', 'null'] },
    depth: { type: 'integer', minimum: 0, maximum: 3 },
    name: { type: 'string' },
    description: { type: 'string' },
    color: { type: ['integer', 'null'] },
    ownerId: { type: 'string' },
    orgId: { type: ['string', 'null'] },
    role: { ...ROLE, description: 'Your role in the project.' },
    recipesPaused: { type: 'boolean' },
    created: { type: ['string', 'null'] },
    updated: { type: ['string', 'null'] },
    url: { type: 'string' },
  },
  required: ['projectId', 'kind', 'driveId', 'name', 'role'],
}

export const projectAccessOutput = {
  type: 'object',
  properties: {
    projectId: { type: 'string' },
    owner: { type: 'object', properties: { userId: { type: 'string' }, name: { type: 'string' } }, required: ['userId'] },
    link: {
      type: 'object',
      properties: { role: { type: 'string', enum: LINK_ROLES }, url: { type: ['string', 'null'] } },
      required: ['role', 'url'],
    },
    grants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['user', 'team'] },
          role: { type: 'string', enum: GRANTABLE_ROLES },
          userId: { type: ['string', 'null'] },
          orgId: { type: ['string', 'null'] },
          email: { type: ['string', 'null'], description: 'For an invitation to an address with no account yet.' },
          pending: { type: 'boolean' },
          name: { type: 'string' },
          granted: { type: ['string', 'null'] },
        },
        required: ['kind', 'role'],
      },
    },
    sharingRevision: { type: 'integer' },
  },
  required: ['projectId', 'owner', 'link', 'grants'],
}

// What the projects actions read from their dependencies: the projects core (server/projects/core.mjs).
export const projectsOf = (deps) => {
  if (!deps.projects) throw new Error('projects: the actions need deps.projects (server/projects/meteor.js)')
  return deps.projects
}
