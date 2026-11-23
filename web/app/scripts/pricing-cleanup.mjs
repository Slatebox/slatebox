#!/usr/bin/env node
// M3: removes the old plan and subscription fields from people and teams (PLAN_FIELDS in
// migrations.mjs), drops pricingTiers and the old AI allowance setting. Keeps customerId.
// Dry-run by default: it only counts the people and teams that carry any of those fields.
//
//   node web/app/scripts/pricing-cleanup.mjs --mongo <url> [--apply]
import { cleanup, PLAN_FIELDS } from '../server/metering/migrations.mjs'

export function mongoCleanupIo(db) {
  const anyField = { $or: PLAN_FIELDS.map(field => ({ [field]: { $exists: true } })) }
  return {
    countWithFields: collection => db.collection(collection).countDocuments(anyField),
    unsetFields: (collection, fields) => db.collection(collection).updateMany(anyField, { $unset: Object.fromEntries(fields.map(f => [f, '']) ) }),
    async dropCollection(name) {
      if ((await db.listCollections({ name }).toArray()).length) await db.collection(name).drop()
    },
    removeSettings: id => db.collection('systemSettings').deleteOne({ _id: id }),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const mongo = argv[argv.indexOf('--mongo') + 1]
  if (!argv.includes('--mongo') || !mongo) {
    console.error('Usage: node pricing-cleanup.mjs --mongo <url> [--apply]')
    process.exit(2)
  }
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongo)
  await client.connect()
  try {
    console.log(JSON.stringify(await cleanup({ io: mongoCleanupIo(client.db()), apply: argv.includes('--apply') }), null, 2))
  } finally {
    await client.close()
  }
}
