// The shape library: shapes a person keeps (private) or shares with their team. Pure over a
// Mongo-like collection (findOne, find().sort().limit().toArray(), insertOne, updateOne,
// deleteOne, countDocuments) so it runs without Meteor. Every path is validated and normalised
// by slateboxjs/shapes on the way in; notes keep their own copy, so removing a shape never
// changes a slate.
import { cleanShapeName, prepareShape } from 'slateboxjs/shapes'
import { ShapeProblem, cleanDescribe } from './shape-core.mjs'

export const LIMITS = Object.freeze({ perPerson: 500, perTeam: 2000, list: 100, withPaths: 24 })
const VISIBILITY = ['private', 'team']
const SOURCES = ['generated', 'drawn', 'imported']
const ID = /^[A-Za-z0-9_-]{1,64}$/

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// What a person may read: their own shapes, and their team's shared ones.
export function visibleTo(principal) {
  const or = [{ ownerId: principal.userId }]
  if (principal.teamId) or.push({ teamId: principal.teamId, visibility: 'team' })
  return { $or: or }
}

export function publicShape(doc, { withPath = true } = {}) {
  return {
    id: doc._id,
    name: doc.name,
    aspect: doc.aspect,
    fillRule: doc.fillRule,
    textBox: doc.textBox ?? null,
    visibility: doc.visibility,
    mine: undefined,
    ...(withPath ? { d: doc.d } : {}),
    describe: doc.describe ?? undefined,
    uses: doc.uses ?? 0,
    usedAt: doc.usedAt ?? null,
  }
}

const shown = (doc, principal, options) => ({ ...publicShape(doc, options), mine: doc.ownerId === principal.userId })

export function createShapeLibrary({ collection, newId, now = () => new Date() }) {
  async function get(principal, id) {
    if (typeof id !== 'string' || !ID.test(id)) return null
    return collection.findOne({ $and: [{ _id: id }, visibleTo(principal)] })
  }

  return {
    get,

    // → { shapes: [...] } newest-used first. scope: mine | team | all. q matches the name.
    async list(principal, { q, scope = 'all', limit = 48 } = {}) {
      const max = Math.max(1, Math.min(LIMITS.list, Number.isInteger(limit) ? limit : 48))
      const parts = [visibleTo(principal)]
      if (scope === 'mine') parts.push({ ownerId: principal.userId })
      if (scope === 'team') parts.push({ visibility: 'team', teamId: principal.teamId ?? '__none__' })
      if (typeof q === 'string' && q.trim()) parts.push({ name: { $regex: escapeRegex(q.trim().slice(0, 60)), $options: 'i' } })
      const docs = await collection.find({ $and: parts }).sort({ usedAt: -1, createdAt: -1 }).limit(max).toArray()
      const withPath = max <= LIMITS.withPaths || docs.length <= LIMITS.withPaths
      return { shapes: docs.map((doc) => shown(doc, principal, { withPath })) }
    },

    // Save a shape (validated) for the person, private unless shared with the team.
    async save(principal, input) {
      if (!principal?.userId || principal.isAnonymous) throw new ShapeProblem('sign_in', 'Sign in to keep shapes.', 401)
      const visibility = input.visibility ?? 'private'
      if (!VISIBILITY.includes(visibility)) throw new ShapeProblem('invalid_request', 'visibility must be private or team.')
      if (visibility === 'team' && !principal.teamId) throw new ShapeProblem('no_team', 'Join a team to share shapes with it.', 409)
      const prepared = prepareShape({ name: input.name, d: input.d, fillRule: input.fillRule })
      if (!prepared.ok) throw new ShapeProblem(prepared.code, prepared.message, 422)
      // The same outline saved again is the same library entry.
      const existing = await collection.findOne({ ownerId: principal.userId, d: prepared.shape.d })
      if (existing) {
        await collection.updateOne({ _id: existing._id }, { $set: { usedAt: now() } })
        return shown({ ...existing, usedAt: now() }, principal)
      }
      if ((await collection.countDocuments({ ownerId: principal.userId })) >= LIMITS.perPerson)
        throw new ShapeProblem('limit', `You have ${LIMITS.perPerson} shapes: remove some to keep more.`, 409)
      if (visibility === 'team' && (await collection.countDocuments({ teamId: principal.teamId, visibility: 'team' })) >= LIMITS.perTeam)
        throw new ShapeProblem('limit', `Your team has ${LIMITS.perTeam} shapes: remove some to share more.`, 409)
      const at = now()
      const doc = {
        _id: newId(),
        name: prepared.shape.name,
        describe: cleanDescribe(input.describe ?? '') ?? null,
        d: prepared.shape.d,
        fillRule: prepared.shape.fillRule,
        aspect: prepared.shape.aspect,
        textBox: prepared.shape.textBox,
        ownerId: principal.userId,
        teamId: principal.teamId ?? null,
        visibility,
        source: SOURCES.includes(input.source) ? input.source : 'generated',
        model: typeof input.model === 'string' ? input.model.slice(0, 120) : null,
        createdAt: at,
        usedAt: at,
        uses: 0,
      }
      await collection.insertOne(doc)
      return shown(doc, principal)
    },

    // Rename, or share with / unshare from the team. Owner only.
    async update(principal, id, { name, visibility } = {}) {
      const doc = await get(principal, id)
      if (!doc) throw new ShapeProblem('not_found', 'That shape is not in your library.', 404)
      if (doc.ownerId !== principal.userId) throw new ShapeProblem('forbidden', 'Only the person who saved a shape can change it.', 403)
      const set = {}
      if (name !== undefined) {
        const clean = cleanShapeName(name)
        if (!clean) throw new ShapeProblem('invalid_request', 'A shape name is 1 to 60 characters.')
        set.name = clean
      }
      if (visibility !== undefined) {
        if (!VISIBILITY.includes(visibility)) throw new ShapeProblem('invalid_request', 'visibility must be private or team.')
        if (visibility === 'team' && !principal.teamId) throw new ShapeProblem('no_team', 'Join a team to share shapes with it.', 409)
        set.visibility = visibility
        set.teamId = visibility === 'team' ? principal.teamId : doc.teamId ?? null
      }
      if (Object.keys(set).length) await collection.updateOne({ _id: doc._id }, { $set: set })
      return shown({ ...doc, ...set }, principal)
    },

    // The owner, or a team admin for a team shape. → the removed shape (for an undo).
    async remove(principal, id) {
      const doc = await get(principal, id)
      if (!doc) throw new ShapeProblem('not_found', 'That shape is not in your library.', 404)
      const admin = doc.visibility === 'team' && principal.teamAdmin && principal.teamId === doc.teamId
      if (doc.ownerId !== principal.userId && !admin)
        throw new ShapeProblem('forbidden', 'Only the person who saved a shape, or a team admin, can remove it.', 403)
      await collection.deleteOne({ _id: doc._id })
      return shown(doc, principal)
    },

    // A shape was put on notes: newest-used first next time.
    async used(principal, id, count = 1) {
      if (typeof id !== 'string' || !ID.test(id)) return
      await collection.updateOne({ $and: [{ _id: id }, visibleTo(principal)] }, { $set: { usedAt: now() }, $inc: { uses: count } })
    },
  }
}
