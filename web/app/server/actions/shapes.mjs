// Custom shapes for agents and exec: draw shapes from a description (the AI feature `shape`,
// counted like any AI use), list the shape library, find The Noun Project's icons as shapes, and
// put a shape on notes. Applying goes through slates.applyOperations' canvas path (applyToCanvas),
// so revisions, permissions, presence and the save core are the same as any other edit.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { applyToCanvas } from './slate-operations.mjs'
import { shapePlan } from '../shapes/shape-service.mjs'

const shapeOut = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    candidateId: { type: 'string' },
    name: { type: 'string' },
    d: { type: 'string', description: 'The outline: one SVG path in a 0..100 box.' },
    fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] },
    aspect: { type: 'number', description: 'Width / height.' },
    textBox: { type: ['object', 'null'], description: 'Where a label sits, in 0..1 of the box.' },
    visibility: { type: 'string', enum: ['private', 'team'] },
    mine: { type: 'boolean' },
    credit: { type: 'object', properties: { text: { type: 'string' }, url: { type: ['string', 'null'] } }, description: 'For an icon from The Noun Project: the credit to show with it.' },
  },
}

// Who asks: the person behind the token, with their team.
async function shapePrincipal(principal, deps) {
  const user = principal.userId ? await deps.loadUser(principal.userId) : null
  if (!user || user.isAnonymous) throw problem(401, 'sign_in', 'Sign in to use shapes.')
  return { userId: user._id, teamId: user.orgId ?? null, isAnonymous: false }
}

const service = (deps) => {
  if (!deps.shapes) throw problem(503, 'unavailable', 'Shapes are not available on this server.')
  return deps.shapes
}

export const shapesGenerate = defineAction({
  id: 'shapes.generate',
  title: 'Draw shapes',
  description:
    'Draw 1 to 4 outlines for notes from a description ("a rocket", "a speech bubble with the tail on the left"), using the AI feature shape (counted like other AI use). Each candidate is one checked SVG path: shapes.apply takes its candidateId (good for 30 days), and an applyOperations update_nodes or add_nodes plan takes {name, d, fillRule} as the shape. The same description again returns the same candidates at no cost unless fresh is true. At most 20 drawings per person per hour.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/shapes/generate', operationId: 'generateShapes' } },
  // Not read-only and not idempotent: it spends AI (Pro credits or top-ups on Cloud, the
  // operator's or the person's own key on a self-host) and fresh draws anew, so a client that
  // approves read-only tools by itself still asks. It changes no slate (changesNoSlate) and
  // reaches the AI provider (openWorld); a preview run draws too.
  changesNoSlate: true,
  openWorld: true,
  modes: ['save', 'preview'],
  idempotency: 'optional',
  input: {
    type: 'object',
    properties: {
      describe: { type: 'string', minLength: 1, maxLength: 200, description: 'The shape, in plain words.' },
      count: { type: 'integer', minimum: 1, maximum: 4, default: 3 },
      fresh: { type: 'boolean', default: false, description: 'Draw new ones instead of returning the last ones for this description.' },
    },
    required: ['describe'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      requestId: { type: 'string' },
      candidates: { type: 'array', items: shapeOut },
      cached: { type: 'boolean' },
    },
    required: ['candidates'],
  },
  tool: { name: 'generate_shape', title: 'Draw a custom shape', description: 'Draw custom outlines for notes from a description, such as a rocket or a speech bubble.' },
  async handler(principal, input, { deps }) {
    const who = await shapePrincipal(principal, deps)
    const { requestId, candidates, cached } = await service(deps).generate(who, { describe: input.describe, count: input.count ?? 3, fresh: Boolean(input.fresh) })
    return { requestId, candidates, cached }
  },
})

export const shapesList = defineAction({
  id: 'shapes.list',
  title: 'List shapes',
  description:
    'The shapes in your library and your team\'s (newest used first): id, name, proportions, visibility, and the outline when 24 or fewer come back. shapes.apply takes one as shape "lib:<id>".',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/shapes', operationId: 'listShapes' } },
  input: {
    type: 'object',
    properties: {
      q: { type: 'string', maxLength: 60, description: 'Words in the shape name.' },
      scope: { type: 'string', enum: ['mine', 'team', 'all'], default: 'all' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
    },
    additionalProperties: false,
  },
  output: { type: 'object', properties: { shapes: { type: 'array', items: shapeOut } }, required: ['shapes'] },
  tool: { name: 'list_shapes', title: 'List custom shapes', description: 'List the custom note shapes saved by the person and their team.' },
  async handler(principal, input, { deps }) {
    const who = await shapePrincipal(principal, deps)
    return service(deps).library.list(who, { q: input.q, scope: input.scope ?? 'all', limit: input.limit ?? 24 })
  },
})

export const shapesSearchIcons = defineAction({
  id: 'shapes.searchIcons',
  title: 'Find icons',
  description:
    'Search The Noun Project\'s icons by words. Each result is one checked outline in a 0..100 box (icons that cannot be one outline are left out) with credit: the text and link The Noun Project asks to show with the icon. An applyOperations update_nodes or add_nodes plan takes {name, d, fillRule} as the shape. Not counted as AI use. Answers 503 icons_not_set_up on a server without a Noun Project key.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent'],
  mounts: { http: { method: 'GET', path: '/shapes/icons', operationId: 'searchIcons' } },
  // It asks The Noun Project (an outside service) and changes nothing.
  openWorld: true,
  input: {
    type: 'object',
    properties: {
      q: { type: 'string', minLength: 1, maxLength: 100, description: 'Words for the icon, such as songbird.' },
      limit: { type: 'integer', minimum: 1, maximum: 24, default: 12 },
    },
    required: ['q'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      icons: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            iconId: { type: 'string' },
            name: { type: 'string' },
            d: { type: 'string', description: 'The outline: one SVG path in a 0..100 box.' },
            fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] },
            aspect: { type: 'number', description: 'Width / height.' },
            textBox: { type: ['object', 'null'], description: 'Where a label sits, in 0..1 of the box.' },
            credit: { type: 'object', properties: { text: { type: 'string' }, url: { type: 'string' } } },
            license: { type: ['string', 'null'] },
          },
        },
      },
      hasMore: { type: 'boolean' },
      credit: { type: 'object', properties: { text: { type: 'string' }, url: { type: 'string' } } },
    },
    required: ['icons'],
  },
  tool: { name: 'search_icons', title: 'Search icons', description: 'Search The Noun Project for icons to use as note shapes, each with the credit to show.' },
  async handler(principal, input, { deps }) {
    const who = await shapePrincipal(principal, deps)
    const { icons, hasMore, credit } = await service(deps).icons.search(who, { q: input.q, limit: input.limit ?? 12 })
    return { icons, hasMore, credit }
  },
})

export const shapesApply = defineAction({
  id: 'shapes.apply',
  title: 'Shape notes',
  description:
    'Give notes a shape: a built-in name (ellipse, star), "lib:<id>" or a name from shapes.list, or a candidateId from shapes.generate (saved to your library). Each note keeps its width and takes the shape\'s proportions. One save; mode "preview" saves nothing.',
  toolset: 'slates',
  kind: 'write',
  scope: 'slates:write',
  principals: ['agent'],
  mounts: { http: { method: 'POST', path: '/slates/{shareId}/shape', operationId: 'applyShape' } },
  modes: ['save', 'preview'],
  idempotency: 'optional',
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      ids: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'string', minLength: 1, maxLength: 128 }, description: 'The notes.' },
      shape: { type: 'string', minLength: 1, maxLength: 120 },
      expectedRevision: { type: 'integer', minimum: 0, description: 'The revision you read; the current one when left out.' },
    },
    required: ['shareId', 'ids', 'shape'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      mode: { type: 'string' },
      shareId: { type: 'string' },
      revision: { type: 'integer' },
      message: { type: 'string' },
      shape: { type: 'object', properties: { name: { type: 'string' }, id: { type: ['string', 'null'] } } },
      report: { type: 'object' },
    },
    required: ['ok', 'shareId', 'message'],
  },
  load: loadSlate(true),
  tool: { name: 'apply_shape', title: 'Give notes a shape', description: 'Give notes on a slate a built-in or custom shape, such as one from the shape library or one just drawn.' },
  async handler(principal, input, ctx) {
    const { deps, resource: slate } = ctx
    const who = await shapePrincipal(principal, deps)
    const resolved = await service(deps).resolve(who, input.shape, { save: ctx.mode !== 'preview' })
    const known = new Set((slate.nodes || []).map((node) => node?.options?.id))
    const missing = input.ids.filter((id) => !known.has(id))
    if (missing.length) throw problem(409, 'no_match', `No note on the slate has the id ${missing.slice(0, 3).join(', ')}.`)
    const plan = shapePlan(resolved, input.ids, { nodes: slate.nodes })
    const result = await applyToCanvas(principal, {
      shareId: input.shareId,
      plan,
      userMessage: `Shape: ${input.shape}`.slice(0, 200),
      expectedRevision: input.expectedRevision ?? slate.revision ?? 0,
    }, ctx)
    if (ctx.mode !== 'preview' && resolved.libraryId) await service(deps).library.used(who, resolved.libraryId, input.ids.length)
    const name = resolved.builtin || resolved.custom.name
    return {
      status: result.status,
      body: { ok: true, mode: ctx.mode, shareId: result.body.shareId, revision: result.body.revision, message: result.body.message, shape: { name, id: resolved.libraryId ?? null }, report: result.body.report },
    }
  },
})

export default [shapesGenerate, shapesList, shapesSearchIcons, shapesApply]
