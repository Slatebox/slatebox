// The one shape service: generate (AI, metered), the library, and turning what a person, the
// chat or an agent names ("lib:<id>", a candidate id, a library name, a built-in name) into the
// value the operation contract stores. Meteor-free: server/shapes/meteor.js supplies the stores,
// the model request and the meter. The presentation styles use the same service.
import { CANDIDATE_TTL_MS, DRAWINGS_PER_HOUR, GENERATION_TTL_MS, ShapeProblem, generateShapes } from './shape-core.mjs'
import { createShapeLibrary } from './shape-library.mjs'

const BUILTIN_DEFAULT = Object.freeze([
  'rectangle', 'roundedrectangle', 'ellipse', 'circle', 'star', 'triangle', 'pentagon', 'hexagon',
  'octagon', 'trapezium', 'parallelogram', 'rarrow', 'larrow', 'diamond', 'stickynote',
])

/**
 * deps: { shapes (collection), generations (collection), request, run, model?, newId, now?, builtins?,
 *         drawingsPerHour?, icons? (createIconSearch: The Noun Project's icons as shapes) }
 */
export function createShapeService(deps) {
  const now = deps.now || (() => new Date())
  const library = createShapeLibrary({ collection: deps.shapes, newId: deps.newId, now })
  const builtins = deps.builtins || BUILTIN_DEFAULT

  const cache = deps.generations && {
    get: (key) => deps.generations.findOne({ key, createdAt: { $gte: new Date(now().getTime() - GENERATION_TTL_MS) } }, { sort: { createdAt: -1 } }),
    put: (doc) => deps.generations.insertOne(doc),
  }

  // The hourly drawing limit, kept in the store every pod shares, so it holds for every
  // surface (canvas, chat, exec, MCP, HTTP) and across pods.
  const perHour = deps.drawingsPerHour ?? DRAWINGS_PER_HOUR
  const allowDrawing = deps.generations
    ? async (principal) =>
      (await deps.generations.countDocuments({ userId: principal.userId, createdAt: { $gte: new Date(now().getTime() - 60 * 60 * 1000) } })) < perHour
    : null
  const drawDeps = { request: deps.request, run: deps.run, cache, model: deps.model, newId: deps.newId, now, allowDrawing }

  async function findCandidate(principal, candidateId) {
    if (!deps.generations || typeof candidateId !== 'string') return null
    const doc = await deps.generations.findOne({
      'candidates.candidateId': candidateId,
      createdAt: { $gte: new Date(now().getTime() - CANDIDATE_TTL_MS) },
      $or: [{ userId: principal.userId }, ...(principal.teamId ? [{ teamId: principal.teamId }] : [])],
    })
    if (!doc) return null
    const candidate = doc.candidates.find((c) => c.candidateId === candidateId)
    return candidate ? { candidate, describe: doc.describe, model: doc.model } : null
  }

  /**
   * What `shape` names → { builtin: 'ellipse' } | { custom: { name, d, fillRule, ref }, libraryId }
   * A candidate is saved to the person's library when it is used (save: true).
   */
  async function resolve(principal, shape, { save = true } = {}) {
    if (typeof shape !== 'string' || !shape.trim() || shape.length > 120)
      throw new ShapeProblem('invalid_request', 'Name a shape: a built-in name, lib:<id>, a library name or a candidateId.')
    const value = shape.trim()
    const builtin = builtins.find((name) => name.toLowerCase() === value.toLowerCase())
    if (builtin) return { builtin }
    let doc = null
    if (value.startsWith('lib:')) doc = await library.get(principal, value.slice(4))
    else {
      const found = await findCandidate(principal, value)
      if (found) {
        const { candidate, describe, model } = found
        const saved = save
          ? await library.save(principal, { name: candidate.name, d: candidate.d, fillRule: candidate.fillRule, describe, model, source: 'generated' })
          : { id: null, ...candidate }
        return {
          custom: { name: candidate.name, d: candidate.d, fillRule: candidate.fillRule, aspect: candidate.aspect, ...(saved.id ? { ref: { id: saved.id, name: candidate.name } } : {}) },
          libraryId: saved.id,
        }
      }
      // A library name: exact first, then the newest whose name contains it.
      const { shapes } = await library.list(principal, { q: value, limit: 24 })
      const exact = shapes.find((s) => s.name.toLowerCase() === value.toLowerCase())
      const pick = exact || shapes[0]
      if (pick) doc = await library.get(principal, pick.id)
    }
    if (!doc)
      throw new ShapeProblem('not_found', `There is no shape called ${value.slice(0, 60)} here. shapes.list names your shapes; shapes.generate draws new ones.`, 404)
    return { custom: { name: doc.name, d: doc.d, fillRule: doc.fillRule, aspect: doc.aspect, ref: { id: doc._id, name: doc.name } }, libraryId: doc._id }
  }

  const icons = deps.icons || {
    configured: false,
    search: async () => { throw new ShapeProblem('icons_not_set_up', 'Icon search is not set up on this server. Create a shape with AI instead.', 503) },
  }

  return {
    library,
    resolve,
    icons,
    generate: (principal, input) => generateShapes({ principal, ...input }, drawDeps),
    /**
     * Find a shape by words, or draw one (count 1) when the library has none. Used by the chat
     * ("make these notes rockets"). → { shape: 'lib:<id>', name, generated }
     */
    async findOrGenerate(principal, describe) {
      const { shapes } = await library.list(principal, { q: describe, limit: 24 })
      const words = String(describe).toLowerCase().trim()
      const singular = words.replace(/(es|s)$/, '')
      const hit = shapes.find((s) => [words, singular].includes(s.name.toLowerCase())) ||
        shapes.find((s) => s.name.toLowerCase().includes(singular))
      if (hit) return { shape: `lib:${hit.id}`, name: hit.name, generated: false }
      const { candidates } = await generateShapes({ principal, describe, count: 1 }, drawDeps)
      const saved = await library.save(principal, { ...candidates[0], describe, source: 'generated' })
      return { shape: `lib:${saved.id}`, name: saved.name, generated: true }
    },
  }
}

/**
 * An update_nodes plan that puts `resolved` on the notes. keepProportions sets each note's height
 * from its width and the shape's proportions.
 */
export function shapePlan(resolved, ids, { nodes = [], keepProportions = true } = {}) {
  if (resolved.builtin) {
    return { message: `Changed the shape to ${resolved.builtin}.`, operations: [{ kind: 'update_nodes', target: { ids }, changes: { shape: resolved.builtin } }] }
  }
  const aspect = resolved.custom.aspect
  const operations = []
  if (keepProportions && aspect > 0) {
    for (const id of ids) {
      const node = nodes.find((n) => n?.options?.id === id)
      const width = Number(node?.options?.width) || 180
      const height = Math.max(20, Math.min(5000, Math.round(width / Math.min(10, Math.max(0.1, aspect)))))
      operations.push({ kind: 'update_nodes', target: { ids: [id] }, changes: { shape: strip(resolved.custom), height } })
    }
  } else {
    operations.push({ kind: 'update_nodes', target: { ids }, changes: { shape: strip(resolved.custom) } })
  }
  return { message: `Made ${ids.length === 1 ? 'the note' : `${ids.length} notes`} ${resolved.custom.name}.`, operations }
}

const strip = ({ name, d, fillRule, ref }) => ({ name, d, fillRule, ...(ref ? { ref } : {}) })
