// The slates a person sees on their Slates page, for agents: their own ("mine"), or their
// team's ("team": what the Team tab lists, the rule slateFilter applies there). The query is
// built here, without Meteor, and run by the store (mount.js).
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The Mongo selector for a list, the one slateFilter builds for the Slates page:
 *   mine  the caller's own slates
 *   team  the team's other slates the caller may see: public ones, and private ones (all of
 *         them for a team admin, otherwise those shared with the caller)
 */
export function slateListSelector({ userId, scope = 'mine', orgId = null, isAdmin = false, grantedIds = [], q }) {
  const parts = []
  if (scope === 'team') {
    if (!orgId) return null
    parts.push({
      orgId,
      userId: { $ne: userId },
      $or: [
        { 'options.isPublic': true },
        isAdmin ? { 'options.isPrivate': true } : { 'options.isPrivate': true, _id: { $in: grantedIds } },
      ],
    })
  } else parts.push({ userId })
  if (q) parts.push({ 'options.name': { $regex: escapeRegex(q), $options: 'i' } })
  return parts.length === 1 ? parts[0] : { $and: parts }
}

export function visibilityOf(options = {}) {
  if (options.isPublic) return 'public'
  return options.isUnlisted ? 'unlisted' : 'private'
}

export function slateListEntry(row, userId, appOrigin) {
  const options = row.options || {}
  return {
    shareId: row.shareId,
    name: options.name || '',
    description: options.description || '',
    visibility: visibilityOf(options),
    owner: row.userId === userId ? 'you' : 'team',
    updated: row.lastSaved ? new Date(row.lastSaved).toISOString() : null,
    url: new URL(`/canvas/${row.shareId}`, appOrigin).href,
  }
}

export default defineAction({
  id: 'slates.list',
  title: 'List slates',
  description:
    'List your slates, newest first, as your Slates page shows them: your own (scope "mine"), or your team\'s that you may open (scope "team": its public slates, and its private slates shared with you, or all of them for a team admin). Filter by name with q.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/slates', operationId: 'listSlates' } },
  input: {
    type: 'object',
    properties: {
      scope: { type: 'string', enum: ['mine', 'team'], default: 'mine' },
      q: { type: 'string', minLength: 1, maxLength: 200, description: 'Part of the slate name.' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    },
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
            owner: { type: 'string', enum: ['you', 'team'] },
            updated: { type: ['string', 'null'] },
            url: { type: 'string' },
          },
          required: ['shareId', 'name', 'visibility', 'owner', 'url'],
        },
      },
    },
    required: ['slates'],
  },
  tool: { name: 'list_slates', title: 'List your slates', description: 'List the person\'s slates (diagrams, mind maps, plans, boards), or their team\'s, newest first, with each one\'s link. Filter by name.' },
  async handler(principal, input, { deps }) {
    const user = await deps.loadUser(principal.userId)
    if (!user) throw problem(404, 'not_found', 'This account no longer exists.')
    const rows = await deps.listSlates({ userId: principal.userId, orgId: user.orgId || null, scope: input.scope, q: input.q, limit: input.limit })
    const origin = deps.appOrigin()
    return { slates: rows.map((row) => slateListEntry(row, principal.userId, origin)) }
  },
})
