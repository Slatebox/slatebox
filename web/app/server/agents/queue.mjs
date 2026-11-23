// How many Slatebox-agent runs go at once, and how many a person starts a day.
//   - A bounded queue: at most RUN_LIMITS.instance runs on this server at once, at most
//     RUN_LIMITS.perPerson for one person (whose rights the run uses); the rest wait in order, up to
//     RUN_LIMITS.queued. A full queue refuses the run instead of piling up work.
//   - A daily cap per person (on Slatebox Cloud, where each run spends that person's Pro credits):
//     RUN_LIMITS.dailyPerPerson runs started a day, counted per UTC day.
// Settings (settings.agents.{perPerson, instance, queued, dailyPerPerson}) may lower or raise them.

export const RUN_LIMITS = Object.freeze({ perPerson: 2, instance: 4, queued: 100, dailyPerPerson: 50 })

const positive = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback)

/** The limits in force: the defaults, with any positive whole number from settings.agents. */
export function runLimits(settings) {
  const given = settings?.agents || {}
  return Object.freeze(Object.fromEntries(Object.entries(RUN_LIMITS).map(([key, value]) => [key, positive(given[key], value)])))
}

/**
 * enqueue({ key, owner, work }): 'queued' (it runs when there is room), 'already' (that key is
 * waiting or running) or 'full'. cancel(key): takes a waiting run out of the queue; true when it
 * was there. A running run stops by its own checks (the task is no longer its to work).
 */
export function createRunQueue({ perPerson = RUN_LIMITS.perPerson, instance = RUN_LIMITS.instance, queued = RUN_LIMITS.queued, log = () => {} } = {}) {
  const waiting = []
  const active = new Map()
  const byOwner = new Map()

  function start(job) {
    active.set(job.key, job.owner)
    byOwner.set(job.owner, (byOwner.get(job.owner) ?? 0) + 1)
    Promise.resolve()
      .then(job.work)
      .catch((error) => log(error))
      .finally(() => {
        active.delete(job.key)
        const left = (byOwner.get(job.owner) ?? 1) - 1
        if (left > 0) byOwner.set(job.owner, left)
        else byOwner.delete(job.owner)
        pump()
      })
  }

  function pump() {
    for (let i = 0; i < waiting.length && active.size < instance; ) {
      const job = waiting[i]
      if ((byOwner.get(job.owner) ?? 0) >= perPerson) {
        i += 1
        continue
      }
      waiting.splice(i, 1)
      start(job)
    }
  }

  function enqueue({ key, owner, work }) {
    if (active.has(key) || waiting.some((job) => job.key === key)) return 'already'
    if (waiting.length >= queued) return 'full'
    waiting.push({ key, owner: owner || 'nobody', work })
    pump()
    return 'queued'
  }

  function cancel(key) {
    const at = waiting.findIndex((job) => job.key === key)
    if (at < 0) return false
    waiting.splice(at, 1)
    return true
  }

  return { enqueue, cancel, isActive: (key) => active.has(key), isWaiting: (key) => waiting.some((job) => job.key === key), size: () => ({ active: active.size, waiting: waiting.length }) }
}

/**
 * take(userId): true and counts one run when the person is under today's cap, else false.
 * collection: a MongoDB driver collection (agentRunDays), one row per person and UTC day, kept
 * two days.
 */
export function createDailyCap({ collection, limit = RUN_LIMITS.dailyPerPerson, now = Date.now }) {
  return {
    limit,
    async take(userId) {
      const at = now()
      const _id = `${userId}:${new Date(at).toISOString().slice(0, 10)}`
      const counted = await collection.updateOne({ _id, n: { $lt: limit } }, { $inc: { n: 1 } })
      if (counted?.matchedCount) return true
      try {
        await collection.insertOne({ _id, n: 1, expiresAt: new Date(at + 2 * 24 * 3600_000) })
        return limit >= 1
      } catch (error) {
        if (error?.code !== 11000) throw error
        // Someone else's first run today landed first: count against that row.
        const again = await collection.updateOne({ _id, n: { $lt: limit } }, { $inc: { n: 1 } })
        return Boolean(again?.matchedCount)
      }
    },
    async ensureIndexes() {
      await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    },
  }
}
