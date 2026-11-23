// mongosh runs this in a one-shot container on the private Compose network.
const admin = db.getSiblingDB('admin')
if (!admin.auth('root', process.env.MONGO_ROOT_PASSWORD).ok) throw new Error('Mongo authentication failed')
let status
try { status = admin.runCommand({ replSetGetStatus: 1 }) }
catch (err) { if (err.codeName !== 'NotYetInitialized') throw err; status = err }
if (status.codeName === 'NotYetInitialized') {
  const initialized = admin.runCommand({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] },
  })
  if (!initialized.ok) throw new Error('Replica set initialization failed')
} else if (!status.ok) throw new Error('Cannot inspect replica set')
let primary = false
for (let attempt = 0; attempt < 90; attempt++) {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary) { primary = true; break }
  sleep(1000)
}
if (!primary) throw new Error('Replica set did not elect a primary')

const app = db.getSiblingDB('slatebox')
if (!app.getUser('app')) app.createUser({
  user: 'app', pwd: process.env.APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'slatebox' }, { role: 'read', db: 'local' }],
})
if (!app.getRole('slateboxRelay')) app.createRole({
  role: 'slateboxRelay',
  privileges: [{ resource: { db: 'slatebox', collection: 'organizations' }, actions: ['find', 'update'] }],
  roles: [],
})
if (!app.getUser('relay')) app.createUser({
  user: 'relay', pwd: process.env.RELAY_PASSWORD, roles: ['slateboxRelay'],
})
print('Slatebox replica set and application users are ready.')
