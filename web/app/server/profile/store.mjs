// About you's store: a person's facts (personalFacts) and their switches (personalSettings), over
// MongoDB driver collections, so the same code runs under Meteor (server/profile/meteor.js) and in
// the tests with stand-ins. Every call takes the person's own id; nothing here reads or writes
// another person's facts. The rules (kinds, bounds, same-fact, cap, the first-slate fact) are
// imports/api/common/personal-facts.mjs.
//
//   personalFacts     { _id, userId, kind, text, key, source { type, ref?, label? }, confidence,
//                       hidden, createdAt, updatedAt }   key: the same-fact key (unique per kind)
//   personalSettings  { _id: userId, userId, on, sources { [sourceKey]: boolean },
//                       derived { 'first-slate': { state: 'hidden'|'removed', job } }, updatedAt }
import {
  FIRST_SLATE_FACT_ID,
  FactError,
  LIMITS,
  MAX_SOURCE_SWITCHES,
  SOURCE_KEY_PATTERN,
  factKey,
  firstSlateFact,
  normalizeFact,
  normalizeSource,
  personalizationOn,
  planAdditions,
  profileDownload,
  promptLines,
  sourceOn,
  tidyText,
} from '../../imports/api/common/personal-facts.mjs'

const DUPLICATE_KEY = 11000

/** The indexes the store reads by (server/profile/meteor.js creates them at start). */
export const PROFILE_INDEXES = Object.freeze([
  // the list, and every write's "is it theirs" check
  { collection: 'facts', key: { userId: 1, kind: 1, updatedAt: -1 } },
  // one fact per kind and same-fact key: two adds racing still keep one
  { collection: 'facts', key: { userId: 1, kind: 1, key: 1 }, options: { unique: true } },
  // clear by source
  { collection: 'facts', key: { userId: 1, 'source.type': 1 } },
  // settings are kept under the person's id (_id), and found by userId too
  { collection: 'settings', key: { userId: 1 }, options: { unique: true } },
])

export async function ensureProfileIndexes({ facts, settings }) {
  const by = { facts, settings }
  for (const index of PROFILE_INDEXES) await by[index.collection].createIndex(index.key, index.options || {})
}

export function createProfileStore({ facts, settings, users, newId, now = Date.now }) {
  const readSettings = async (userId) => (await settings.findOne({ _id: userId })) || null
  const readStart = async (userId) => (await users.findOne({ _id: userId }, { projection: { 'profile.start': 1 } }))?.profile?.start ?? null
  const stored = async (userId) => (await facts.find({ userId }).toArray()).map((doc) => ({ ...doc, id: doc._id }))
  const derivedOf = (doc) => doc?.derived?.[FIRST_SLATE_FACT_ID] || null

  async function writeSettings(userId, set) {
    await settings.updateOne(
      { _id: userId },
      { $set: { ...set, updatedAt: new Date(now()) }, $setOnInsert: { userId } },
      { upsert: true }
    )
    return readSettings(userId)
  }

  // The first-slate fact's choice (hidden or removed), kept with the answer it was made on.
  async function chooseDerived(userId, state) {
    const start = await readStart(userId)
    const fact = firstSlateFact(start, null)
    if (!fact) throw new FactError('not_found', 'That fact is not in your profile.', 404)
    await writeSettings(userId, { [`derived.${FIRST_SLATE_FACT_ID}`]: state ? { state, job: start.job } : null })
    return firstSlateFact(start, state ? { state, job: start.job } : null)
  }

  async function find(userId, id) {
    const doc = await facts.findOne({ _id: id, userId })
    if (!doc) throw new FactError('not_found', 'That fact is not in your profile.', 404)
    return { ...doc, id: doc._id }
  }

  async function insert(userId, fact) {
    const doc = { _id: newId(), userId, ...fact }
    await facts.insertOne(doc)
    return { ...doc, id: doc._id }
  }

  // The cap is checked before an insert, so two adds racing at the cap could both pass it. After
  // inserting, the facts past the cap (oldest first, then by id, the same order for every caller)
  // are taken back, so exactly the later ones lose. → the ids taken back
  async function keepCap(userId, insertedIds) {
    if (!insertedIds.length) return []
    const all = await facts.find({ userId }, { projection: { _id: 1, createdAt: 1 } }).toArray()
    if (all.length <= LIMITS.perPerson) return []
    const order = all.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a._id).localeCompare(String(b._id)))
    const over = new Set(order.slice(LIMITS.perPerson).map((doc) => doc._id))
    const back = insertedIds.filter((id) => over.has(id))
    for (const id of back) await facts.deleteOne({ _id: id, userId })
    return back
  }

  // Facts from a source are only ever kept for a saved account: never a guest's, never no one's.
  async function requireMember(userId) {
    const user = userId ? await users.findOne({ _id: userId }, { projection: { _id: 1, isAnonymous: 1 } }) : null
    if (!user || user.isAnonymous) throw new FactError('registration_required', 'About you is for saved accounts.', 403)
  }

  const store = {
    /** Everything About you holds for this person: their settings, their facts and the first-slate fact. */
    async list(userId) {
      const [doc, own, start] = await Promise.all([readSettings(userId), stored(userId), readStart(userId)])
      const derived = firstSlateFact(start, derivedOf(doc))
      return { settings: doc, facts: derived ? [...own, derived] : own }
    },

    /**
     * A fact the person (or an agent they connected) wrote. The same fact again answers the one
     * they have (added: false). Past the cap it is refused: remove something first.
     */
    async add(userId, input, { label } = {}) {
      const fact = normalizeFact({ kind: input.kind, text: input.text }, { source: { type: 'typed', ...(label && { label }) }, now: now() })
      const own = await stored(userId)
      const same = own.find((have) => have.kind === fact.kind && (have.key ?? factKey(have.text)) === fact.key)
      if (same) return { fact: same, added: false }
      if (own.length >= LIMITS.perPerson)
        throw new FactError('profile_full', `About you keeps up to ${LIMITS.perPerson} facts. Remove some to add more.`, 409)
      try {
        const made = await insert(userId, fact)
        if ((await keepCap(userId, [made.id])).length)
          throw new FactError('profile_full', `About you keeps up to ${LIMITS.perPerson} facts. Remove some to add more.`, 409)
        return { fact: made, added: true }
      } catch (error) {
        if (error?.code !== DUPLICATE_KEY) throw error
        const again = await facts.findOne({ userId, kind: fact.kind, key: fact.key })
        return { fact: { ...again, id: again._id }, added: false }
      }
    },

    /**
     * New words or a new kind for a fact. The first-slate fact becomes one of their own (their
     * words now), and the answer's fact is put away.
     */
    async update(userId, id, change) {
      if (id === FIRST_SLATE_FACT_ID) {
        const start = await readStart(userId)
        const was = firstSlateFact(start, null)
        if (!was) throw new FactError('not_found', 'That fact is not in your profile.', 404)
        const { fact } = await store.add(userId, { kind: change.kind ?? was.kind, text: change.text ?? was.text })
        await chooseDerived(userId, 'removed')
        return fact
      }
      const have = await find(userId, id)
      const next = normalizeFact({ kind: change.kind ?? have.kind, text: change.text ?? have.text }, { source: have.source, now: now() })
      const clash = await facts.findOne({ userId, kind: next.kind, key: next.key })
      if (clash && clash._id !== id) throw new FactError('duplicate', 'You already have that one.', 409)
      // their own words now: as sure as can be
      const set = { kind: next.kind, text: next.text, key: next.key, confidence: 1, updatedAt: next.updatedAt }
      try {
        await facts.updateOne({ _id: id, userId }, { $set: set })
      } catch (error) {
        if (error?.code === DUPLICATE_KEY) throw new FactError('duplicate', 'You already have that one.', 409)
        throw error
      }
      return { ...have, ...set }
    },

    /** Hidden: kept, shown to them, never used. */
    async setHidden(userId, id, hidden) {
      if (id === FIRST_SLATE_FACT_ID) return chooseDerived(userId, hidden ? 'hidden' : null)
      const have = await find(userId, id)
      const updatedAt = new Date(now())
      await facts.updateOne({ _id: id, userId }, { $set: { hidden: Boolean(hidden), updatedAt } })
      return { ...have, hidden: Boolean(hidden), updatedAt }
    },

    async remove(userId, id) {
      if (id === FIRST_SLATE_FACT_ID) {
        await chooseDerived(userId, 'removed')
        return true
      }
      const { deletedCount } = await facts.deleteOne({ _id: id, userId })
      if (!deletedCount) throw new FactError('not_found', 'That fact is not in your profile.', 404)
      return true
    },

    /** Removes every fact, or those from one kind of source. The first-slate fact is put away too. */
    async clear(userId, { sourceType } = {}) {
      const { deletedCount } = await facts.deleteMany({ userId, ...(sourceType && { 'source.type': sourceType }) })
      let removed = deletedCount || 0
      if (!sourceType || sourceType === 'first-slate') {
        const doc = await readSettings(userId)
        const start = await readStart(userId)
        if (firstSlateFact(start, derivedOf(doc))) {
          await chooseDerived(userId, 'removed')
          removed += 1
        }
      }
      return removed
    },

    getSettings: readSettings,

    /** Turns personalization on or off, and sources on or off (only the sources named change). */
    async setSettings(userId, { on, sources } = {}) {
      const set = {}
      if (typeof on === 'boolean') set.on = on
      const named = Object.entries(sources || {})
      const pattern = new RegExp(SOURCE_KEY_PATTERN)
      const bad = named.find(([key]) => !pattern.test(key))
      if (bad) throw new FactError('invalid_source', `${bad[0]} is not a source.`)
      if (named.length) {
        const have = Object.keys((await readSettings(userId))?.sources || {})
        const total = new Set([...have, ...named.map(([key]) => key)]).size
        if (total > MAX_SOURCE_SWITCHES)
          throw new FactError('too_many_sources', `About you keeps switches for up to ${MAX_SOURCE_SWITCHES} sources.`, 409)
      }
      for (const [key, value] of named) set[`sources.${key}`] = Boolean(value)
      if (!Object.keys(set).length) return readSettings(userId)
      return writeSettings(userId, set)
    },

    /**
     * For later slices (the interview, connected tools, uploads): facts from a source, kept when
     * personalization is on and that source's switch is on. The same fact again is skipped, and
     * nothing past the cap is kept. → { added, same, overCap, invalid }
     */
    async addFrom(userId, source, incoming) {
      const from = normalizeSource(source)
      if (from.type === 'first-slate') throw new FactError('invalid_source', 'The first-slate fact is read from the first slate, never stored.')
      await requireMember(userId)
      const doc = await readSettings(userId)
      if (!personalizationOn(doc)) throw new FactError('personalization_off', 'Personalization is off.', 403)
      if (!sourceOn(doc, from)) throw new FactError('source_off', 'That source is switched off for personalization.', 403)
      const list = Array.isArray(incoming) ? incoming.slice(0, LIMITS.perAdd) : []
      let invalid = (Array.isArray(incoming) ? incoming.length : 0) - list.length
      const ready = []
      for (const item of list) {
        try {
          ready.push(normalizeFact({ kind: item?.kind, text: tidyText(item?.text, LIMITS.text), confidence: item?.confidence, source: from }, { now: now() }))
        } catch {
          invalid += 1
        }
      }
      const plan = planAdditions(await stored(userId), ready)
      const inserted = []
      let same = plan.same
      for (const fact of plan.add) {
        try {
          inserted.push((await insert(userId, fact)).id)
        } catch (error) {
          if (error?.code !== DUPLICATE_KEY) throw error
          same += 1
        }
      }
      const back = await keepCap(userId, inserted)
      return { added: inserted.length - back.length, same, overCap: plan.overCap + back.length, invalid }
    },

    /** For later model calls: visible facts from sources that are on, compact and bounded; '' when off. */
    async forPrompt(userId) {
      const { settings: doc, facts: all } = await store.list(userId)
      return promptLines(all, doc)
    },

    async download(userId) {
      const { settings: doc, facts: all } = await store.list(userId)
      return profileDownload({ facts: all, settings: doc, now: now() })
    },

    /** The account is going: every fact and setting of theirs. */
    async removeAll(userId) {
      await facts.deleteMany({ userId })
      await settings.deleteOne({ _id: userId })
    },
  }
  return store
}
