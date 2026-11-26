// The shapes the library.* actions share (server/library/core.mjs does the work).
import { INTEGRATION_AUTH, INTEGRATION_CATEGORIES, INTEGRATION_LIMITS, LIBRARY_CATEGORIES, LIBRARY_KINDS, LIBRARY_LIMITS, LIBRARY_STATUSES } from '../../imports/api/common/library-model.mjs'
import { problem } from './errors.mjs'

export const itemRef = { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9_-]+$', description: 'The item: its id or its slug (library.list items[].id or .slug).' }
export const kindInput = { type: 'string', enum: [...LIBRARY_KINDS] }
export const categoryInput = { type: 'string', enum: [...LIBRARY_CATEGORIES, ...INTEGRATION_CATEGORIES], description: `One of the categories ${LIBRARY_CATEGORIES.join(', ')}. An integration takes ${INTEGRATION_CATEGORIES.slice(0, -1).join(', ')} or ${INTEGRATION_CATEGORIES.at(-1)}.` }
// A suggested integration (kind integration): the person's connected MCP server, and what they say about it.
export const integrationInputs = {
  integrationId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$', description: 'kind integration: the connected integration to submit (integrations.list).' },
  homepage: { type: 'string', maxLength: INTEGRATION_LIMITS.homepage, description: 'kind integration: its homepage or docs (https).' },
  auth: { type: 'string', enum: [...INTEGRATION_AUTH], description: 'kind integration: how it signs people in: none, oauth or key.' },
  consent: { type: 'boolean', description: 'kind integration: the person agrees its address, name and description become public if approved.' },
}
export const versionInput = { type: 'integer', minimum: 1, description: 'A version number (item.publishedVersion by default).' }
export const cursorInput = { type: 'string', maxLength: 12, pattern: '^[0-9]+$', description: 'The next value the previous page gave.' }
export const messageInput = { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.message }
export const metaInputs = {
  title: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.title, description: 'Plain text, up to 80 characters.' },
  summary: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.summary, description: 'One line, up to 160 characters.' },
  description: { type: 'string', maxLength: LIBRARY_LIMITS.description, description: 'Plain text, up to 2,000 characters.' },
  category: categoryInput,
  synonyms: { type: 'array', maxItems: LIBRARY_LIMITS.synonyms, items: { type: 'string', minLength: 1, maxLength: LIBRARY_LIMITS.synonym }, description: 'Smart components only: words people might search for.' },
}

const counts = { type: 'object', properties: { copies: { type: 'integer' }, adds: { type: 'integer' }, branches: { type: 'integer' } } }
export const itemSummary = {
  type: 'object',
  properties: {
    id: { type: 'string' }, slug: { type: 'string' }, kind: kindInput, origin: { type: 'string', enum: ['builtin', 'user'] },
    title: { type: 'string' }, summary: { type: 'string' }, category: categoryInput, authorName: { type: 'string' },
    publishedAt: { type: 'string' }, counts, provenance: { type: 'object', description: 'branchedFrom or forkedFrom: { itemId, version, title }; madeFor: { kind: "for-you", ideaId } for a component Slatebox built for its author from an idea in For you, or { kind: "tile", tileId } for one built from their tile on the start page.' },
    url: { type: 'string' }, preview: { type: 'object', properties: { kind: kindInput, boardKind: { type: 'string' }, notes: { type: 'integer' } } },
  },
  required: ['id', 'slug', 'kind', 'origin', 'title', 'summary', 'authorName', 'counts', 'url'],
}
export const itemDetail = {
  type: 'object',
  properties: {
    ...itemSummary.properties,
    description: { type: 'string' }, synonyms: { type: 'array', items: { type: 'string' } }, license: { type: 'string' },
    categoryLocked: { type: 'boolean' }, versionCount: { type: 'integer' }, publishedVersion: { type: 'integer' }, publishedCount: { type: 'integer', description: 'How many times it has been published, when more than once (absent: once).' },
    status: { type: 'string', enum: [...LIBRARY_STATUSES], description: 'Its author and reviewers only.' },
    reviewStatus: { type: 'string', description: 'The state of the version waiting for review (its author and reviewers only).' },
    pendingVersion: { type: 'integer' }, pendingMeta: { type: 'object', description: 'An update to a published item: its proposed details, public once approved.' }, draftMeta: { type: 'object', description: 'A published item\'s saved draft details, not yet submitted (its author only).' }, sourceShareId: { type: 'string' }, reviewShareId: { type: 'string' }, lastMessage: { type: 'object' },
  },
  required: itemSummary.required,
}
export const versionOutput = {
  type: 'object',
  properties: { n: { type: 'integer' }, meta: { type: 'object' }, content: { type: 'object', description: '{ kind: component, workshop } | { kind: slate, slate } | { kind: presentation, slate, deck }' }, createdAt: { type: 'string' } },
  required: ['n', 'meta', 'content'],
}
export const statusOutput = {
  type: 'object',
  properties: { itemId: { type: 'string' }, slug: { type: 'string' }, status: { type: 'string' }, reviewStatus: { type: ['string', 'null'] }, version: { type: 'integer' } },
  required: ['itemId', 'status'],
}
export const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })

// The review actions' check, before anything is held (precheck, which the exec gate asks) or run
// (load): the caller is an administrator of this server.
export async function requireReviewer(principal, _input, { deps }) {
  if (!(await deps.library.isReviewer(principal.userId)))
    throw problem(403, 'reviewer_required', 'Only an administrator of this server reviews library submissions.')
  return null
}
