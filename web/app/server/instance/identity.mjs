// Who this instance is. The id belongs to the installation: a self-hosted instance writes it
// with its other secrets at first start (settings instance.id), so a backup restored into a
// new container starts under a new id. The lineage belongs to the database: it is the first id
// the database ever ran under and survives every restore, so a copy is recognisable as one.
// An install whose settings name no id keeps one generated id in its database instead.
import { randomUUID } from 'node:crypto'

const RECORD = 'instance'
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/

export async function resolveInstanceIdentity({ collection, configuredId, generateId = randomUUID, now = Date.now }) {
  if (configuredId !== undefined && configuredId !== null && (typeof configuredId !== 'string' || !ID_PATTERN.test(configuredId)))
    throw new Error('Set instance.id to 8–64 letters, digits and hyphens, or leave it out.')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await collection.findOne({ _id: RECORD })
    if (!record) {
      const id = configuredId || generateId()
      try {
        await collection.insertOne({
          _id: RECORD,
          lineage: id,
          currentId: id,
          ...(configuredId ? {} : { generatedId: id }),
          ids: [{ id, since: now() }],
        })
        return { id, lineage: id }
      } catch (error) {
        if (error?.code === 11000) continue // another process started first; read its record
        throw error
      }
    }
    const id = configuredId || record.generatedId || generateId()
    if (record.currentId !== id) {
      // Started under a new id: a restore or a copy. Keep the lineage; remember each id.
      await collection.updateOne(
        { _id: RECORD },
        {
          $set: {
            currentId: id,
            ...(configuredId || record.generatedId ? {} : { generatedId: id }),
            ids: [...(record.ids || []), { id, since: now() }],
          },
        }
      )
    }
    return { id, lineage: record.lineage }
  }
  throw new Error('The instance identity could not be read.')
}
