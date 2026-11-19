// Prepare the bundled MongoDB: a single-member replica set (the app follows the
// oplog for live updates) and three accounts with this installation's
// passwords. Safe to run at every start and after an interrupted first start.
import { DATABASE, MONGO_PORT, Plain, REPLICA_SET, fail, mongodb, readSecrets, sleep } from './common.mjs'

const { MongoClient } = mongodb()
const secrets = readSecrets()
const host = `127.0.0.1:${MONGO_PORT}`

async function connect(authenticated) {
  const client = new MongoClient(`mongodb://${host}/`, {
    directConnection: true,
    serverSelectionTimeoutMS: 3000,
    ...(authenticated ? { auth: { username: 'root', password: secrets.mongoRootPassword }, authSource: 'admin' } : {}),
  })
  await client.connect()
  return client
}

async function waitForServer() {
  const deadline = Date.now() + 180_000
  for (;;) {
    let client
    try {
      client = await connect(false)
      await client.db('admin').command({ hello: 1 })
      return
    } catch (error) {
      if (Date.now() > deadline) throw new Plain('MongoDB did not start accepting connections within three minutes.')
      await sleep(500)
    } finally {
      await client?.close().catch(() => {})
    }
  }
}

async function waitForPrimary(admin) {
  const deadline = Date.now() + 120_000
  while (!(await admin.command({ hello: 1 })).isWritablePrimary) {
    if (Date.now() > deadline) throw new Plain('MongoDB did not become writable within two minutes.')
    await sleep(250)
  }
}

async function initiate(admin) {
  try {
    await admin.command({ replSetInitiate: { _id: REPLICA_SET, members: [{ _id: 0, host }] } })
  } catch (error) {
    if (error.codeName !== 'AlreadyInitialized') throw error
  }
}

async function main() {
  await waitForServer()

  let client
  try {
    client = await connect(true)
  } catch (error) {
    if (error.codeName !== 'AuthenticationFailed') throw error
    // No accounts yet: MongoDB lets a loopback connection initialise the
    // replica set and create the first administrator.
    const first = await connect(false)
    try {
      const admin = first.db('admin')
      await initiate(admin)
      await waitForPrimary(admin)
      await admin.command({ createUser: 'root', pwd: secrets.mongoRootPassword, roles: ['root'] })
    } catch (inner) {
      if (inner.codeName === 'Unauthorized') {
        throw new Plain(
          'The database does not accept this installation\'s secrets. /data/db and /data/secrets must come from the same installation.')
      }
      throw inner
    } finally {
      await first.close().catch(() => {})
    }
    client = await connect(true)
  }

  try {
    const admin = client.db('admin')
    await initiate(admin)
    await waitForPrimary(admin)

    const app = client.db(DATABASE)
    const hasUser = async name => (await app.command({ usersInfo: name })).users.length > 0
    if (!await hasUser('app')) {
      await app.command({
        createUser: 'app', pwd: secrets.mongoAppPassword,
        roles: [{ role: 'readWrite', db: DATABASE }, { role: 'read', db: 'local' }],
      })
    }
    // The relay only ever looks up an organisation's key.
    if (!(await app.command({ rolesInfo: 'slateboxRelay' })).roles.length) {
      await app.command({
        createRole: 'slateboxRelay',
        privileges: [{ resource: { db: DATABASE, collection: 'organizations' }, actions: ['find', 'update'] }],
        roles: [],
      })
    }
    if (!await hasUser('relay')) {
      await app.command({ createUser: 'relay', pwd: secrets.mongoRelayPassword, roles: ['slateboxRelay'] })
    }
  } finally {
    await client.close().catch(() => {})
  }
  process.stdout.write('Database ready.\n')
}

main().catch(fail)
