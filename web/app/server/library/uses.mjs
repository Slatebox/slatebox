// The library's counters, kept in one collection (libraryCounters) over any MongoDB driver collection:
//   - a daily allowance per person and action (submit, save a draft, branch, copy, comment), reserved
//     atomically so parallel requests can't beat it;
//   - "used by": each signed-in person counts once per item and kind of use (copies, adds, branches),
//     so the popular order and "Used N times" can't be pumped by repeating a copy or by throwaway guests.
// Pure over injected collections: tested in scripts/library-limits.test.mjs.
import { LIBRARY_LIMITS, libraryError } from '../../imports/api/common/library-model.mjs'

const DAY = 86400000
const LIMIT_WORDS = {
  submit: (n) => `You can submit ${n} items a day. Try again tomorrow.`,
  saveDraft: (n) => `You can save to the library ${n} times a day. Try again tomorrow.`,
  branch: (n) => `You can start ${n} smart components a day. Try again tomorrow.`,
  fork: (n) => `You can copy ${n} library items a day. Try again tomorrow.`,
  comment: (n) => `You can write ${n} messages a day in library threads. Try again tomorrow.`,
}

/**
 * Take one of today's allowance for `action` (LIBRARY_LIMITS.perDay), or throw a 429 when it is spent.
 * One counter document per person, action and day: the guarded $inc with upsert is atomic (a second
 * insert of the same _id fails with a duplicate key once the guard stops matching).
 */
export async function spendAllowance({ counters, userId, action, now = Date.now }) {
  const max = LIBRARY_LIMITS.perDay[action]
  if (!counters || !max || !userId) return
  const day = new Date(now()).toISOString().slice(0, 10)
  const _id = `limit:${action}:${userId}:${day}`
  try {
    const result = await counters.updateOne(
      { _id, n: { $lt: max } },
      { $inc: { n: 1 }, $setOnInsert: { kind: 'limit', action, userId, day, expiresAt: new Date(now() + 2 * DAY) } },
      { upsert: true },
    )
    if (!result || (!result.matchedCount && !result.upsertedCount && !result.upsertedId)) throw Object.assign(new Error('spent'), { code: 11000 })
  } catch (error) {
    if (error?.code === 11000) throw libraryError(429, action === 'submit' ? 'submit_limit' : 'library_limit', LIMIT_WORDS[action](max))
    throw error
  }
}

/**
 * Count one use of an item: once per signed-in person, item and field. Guests are never counted.
 * → whether it counted.
 */
export async function countUse({ items, counters, itemId, field, userId, guest = false }) {
  if (!itemId || !userId || guest) return false
  if (counters) {
    try {
      await counters.insertOne({ _id: `use:${field}:${itemId}:${userId}`, kind: 'use', itemId, field, userId })
    } catch (error) {
      if (error?.code === 11000) return false
      throw error
    }
  }
  await items.updateOne({ _id: itemId }, { $inc: { [`counts.${field}`]: 1, popularity: 1 } })
  return true
}
