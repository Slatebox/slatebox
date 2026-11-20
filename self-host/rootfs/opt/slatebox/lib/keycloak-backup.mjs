// Keycloak's data in a Slatebox backup. A backup is one mongodump archive of the slatebox
// database, so Keycloak's H2 database travels inside it: an online H2 backup (BACKUP TO, which
// H2 makes consistent while Keycloak runs) is stored in the GridFS bucket below for the length
// of the dump, together with the single sign-on secrets that unlock it.
//
//   node keycloak-backup.mjs save      put Keycloak's database and secrets into the slatebox database
//   node keycloak-backup.mjs drop      take them out again
//   node keycloak-backup.mjs restore   after a restore: put Keycloak's database from the
//                                      restored data in place (Keycloak is stopped), take over its
//                                      secrets, and drop the copy. Exit 3 when the backup has none.
import { spawnSync } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import {
  DATABASE, KEYCLOAK_DATA, KEYCLOAK_HOME, Plain, SECRETS_FILE, SSO_SECRET_NAMES, TMP_DIR, fail, mongodb, mongoUrl, readSecrets, writePrivate,
} from './common.mjs'
import { KEYCLOAK_DB_USER, keycloakDbUrl } from './sso.mjs'

const BUCKET = 'selfhost_keycloak'
const FILE = 'keycloak-h2.zip'
const H2_DIR = join(KEYCLOAK_DATA, 'h2')
const java = '/opt/java/openjdk/bin/java'
const h2Jar = () => {
  const dir = join(KEYCLOAK_HOME, 'lib/lib/main')
  const jar = readdirSync(dir).find(name => /^com\.h2database\.h2-.*\.jar$/.test(name))
  if (!jar) throw new Plain('The H2 library is missing from Keycloak.')
  return join(dir, jar)
}

function h2(tool, args) {
  const result = spawnSync(java, ['-Dh2.bindAddress=127.0.0.1', '-cp', h2Jar(), tool, ...args], { encoding: 'utf8' })
  if (result.status !== 0) throw new Plain(`Keycloak's database could not be ${tool.endsWith('Restore') ? 'restored' : 'saved'} (${(result.stderr || '').split('\n')[0]}).`)
}

async function withBucket(work) {
  const { GridFSBucket, MongoClient } = mongodb()
  const client = new MongoClient(mongoUrl('root', readSecrets().mongoRootPassword, { database: '', authSource: 'admin' }))
  try {
    await client.connect()
    return await work(new GridFSBucket(client.db(DATABASE), { bucketName: BUCKET }))
  } finally {
    await client.close().catch(() => {})
  }
}

async function drop() {
  await withBucket(async bucket => {
    for (const file of await bucket.find({}).toArray()) await bucket.delete(file._id)
  })
}

async function save() {
  if (!existsSync(join(H2_DIR, 'keycloakdb.mv.db'))) return
  const secrets = readSecrets()
  const zip = join(TMP_DIR, `keycloak-${process.pid}.zip`)
  try {
    h2('org.h2.tools.Shell', ['-url', keycloakDbUrl(), '-user', KEYCLOAK_DB_USER, '-password', secrets.keycloakDbPassword, '-sql', `BACKUP TO '${zip}'`])
    await drop()
    const kept = Object.fromEntries(SSO_SECRET_NAMES.map(name => [name, secrets[name]]))
    await withBucket(bucket => pipeline(createReadStream(zip), bucket.openUploadStream(FILE, { metadata: { secrets: kept } })))
  } finally {
    rmSync(zip, { force: true })
  }
}

async function restore() {
  const zip = join(TMP_DIR, `keycloak-restore-${process.pid}.zip`)
  const previous = join(TMP_DIR, `keycloak-before-${process.pid}`)
  try {
    const found = await withBucket(async bucket => {
      const [file] = await bucket.find({ filename: FILE }).sort({ uploadDate: -1 }).limit(1).toArray()
      if (!file) return null
      await pipeline(bucket.openDownloadStream(file._id), createWriteStream(zip, { mode: 0o600 }))
      return file
    })
    if (!found) return 3
    mkdirSync(KEYCLOAK_DATA, { recursive: true, mode: 0o700 })
    if (existsSync(H2_DIR)) renameSync(H2_DIR, previous)
    try {
      mkdirSync(H2_DIR, { mode: 0o700 })
      h2('org.h2.tools.Restore', ['-file', zip, '-dir', H2_DIR, '-db', 'keycloakdb'])
    } catch (error) {
      rmSync(H2_DIR, { recursive: true, force: true })
      if (existsSync(previous)) renameSync(previous, H2_DIR)
      throw error
    }
    // The restored database opens only with the secrets it was made with.
    const secrets = { ...readSecrets(), ...found.metadata?.secrets }
    writePrivate(SECRETS_FILE, JSON.stringify(secrets, null, 2) + '\n')
    rmSync(previous, { recursive: true, force: true })
    await drop()
    return 0
  } finally {
    rmSync(zip, { force: true })
  }
}

const command = process.argv[2]
const run = { save, drop, restore }[command]
if (!run) fail(new Plain('Usage: keycloak-backup.mjs save | drop | restore'))
run().then(code => process.exit(code || 0), fail)
