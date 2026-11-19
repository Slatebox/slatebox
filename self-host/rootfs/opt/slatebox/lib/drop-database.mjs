// Empty the Slatebox database before a backup is loaded into it. Accounts for
// the app and the relay live in MongoDB's admin database and are not touched.
import { DATABASE, fail, mongodb, mongoUrl, readSecrets } from './common.mjs'

const { MongoClient } = mongodb()
const client = new MongoClient(mongoUrl('root', readSecrets().mongoRootPassword, { database: '', authSource: 'admin' }))
try {
  await client.connect()
  await client.db(DATABASE).dropDatabase()
} catch (error) {
  fail(error)
} finally {
  await client.close().catch(() => {})
}
