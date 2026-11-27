// A lease, so a job that runs on a timer in every server process (Slatebox Cloud runs several) is
// done by one of them at a time: the session checks, the session-length sweep and the daily domain
// checks. One document per job in a Mongo collection; taking it is one atomic update that matches
// only a free or expired lease, or one this process already holds. No Meteor import.
import { randomBytes } from 'node:crypto'

export const HOLDER = `${process.pid}-${randomBytes(6).toString('hex')}`

export async function takeLease(collection, name, { ttlMs, now = Date.now(), holder = HOLDER }) {
  const at = new Date(now)
  try {
    const result = await collection.updateOne(
      { _id: name, $or: [{ until: { $lt: at } }, { holder }] },
      { $set: { holder, until: new Date(now + ttlMs), takenAt: at } },
      { upsert: true },
    )
    return result.matchedCount + (result.upsertedCount || 0) > 0
  } catch (error) {
    // Another process holds it: the upsert found no free lease and collided with the held one.
    if (error?.code === 11000) return false
    throw error
  }
}
