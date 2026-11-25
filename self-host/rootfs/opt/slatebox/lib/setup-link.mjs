// The one-time setup link of a new Slatebox. Nobody can sign up until its first admin exists; the
// person who opens this link creates that account (the server administrator and the owner of the
// first team). It runs inside the container with the app's own database connection and prints
// only the link. Making a new link replaces the one before. The link is single use, expires in 24
// hours, and only its SHA-256 is kept (the app's side: web/app/server/self-host-setup/core.mjs).
//
//   node setup-link.mjs            the link, on stdout
//   node setup-link.mjs --json     {"url": "...", "expiresAt": "..."}
//   node setup-link.mjs --check    {"setUp": true|false, "linkExpiresAt": "..."|null}; makes nothing
//
// Exit 3 when the server is already set up (there is no link to make).
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Plain, fail, mongodb } from './common.mjs'

export const SETUP_ID = 'selfHostSetup'
export const COLLECTION = 'systemSettings'
export const SETUP_TTL_MS = 24 * 60 * 60 * 1000
export const ALREADY_SET_UP = 3

export const hashSetupToken = token => createHash('sha256').update(String(token)).digest('hex')

/** A new link's token and the record that replaces any earlier link. */
export function newLink(now = Date.now()) {
  const token = randomBytes(32).toString('base64url')
  return { token, record: { tokenHash: hashSetupToken(token), createdAt: new Date(now), expiresAt: new Date(now + SETUP_TTL_MS) } }
}

/** Set up: a first admin was made through a link, or the install had accounts before links existed. */
export async function setupState(db, now = Date.now()) {
  const doc = await db.collection(COLLECTION).findOne({ _id: SETUP_ID })
  const registered = doc?.completedAt ? null : await db.collection('users').findOne({ isAnonymous: { $ne: true } }, { projection: { _id: 1 } })
  const live = !doc?.completedAt && doc?.tokenHash && doc.expiresAt instanceof Date && doc.expiresAt.getTime() > now && !doc.claimedAt
  return { setUp: Boolean(doc?.completedAt || registered), linkExpiresAt: live ? doc.expiresAt.toISOString() : null }
}

export async function makeLink(db, publicUrl, now = Date.now()) {
  const { token, record } = newLink(now)
  // Only while nobody is set up: a link can never be made over a finished setup.
  const result = await db.collection(COLLECTION).updateOne(
    { _id: SETUP_ID, completedAt: { $exists: false } },
    { $set: record, $unset: { claimedAt: '', teamName: '' } },
    { upsert: true },
  ).catch(error => {
    if (error?.code === 11000) return { matchedCount: 0, upsertedCount: 0 }
    throw error
  })
  if (!result.matchedCount && !result.upsertedCount) return null
  return { url: `${String(publicUrl).replace(/\/$/, '')}/setup/${token}`, expiresAt: record.expiresAt.toISOString() }
}

async function main(args) {
  const { MongoClient } = mongodb()
  const client = new MongoClient(process.env.MONGO_URL)
  try {
    await client.connect()
    const db = client.db()
    const state = await setupState(db)
    if (args.includes('--check')) {
      process.stdout.write(`${JSON.stringify(state)}\n`)
      return
    }
    const already = 'This Slatebox is already set up. Its administrator invites people from the Team page; for a lost password: slatebox password-link EMAIL'
    if (state.setUp) {
      process.stderr.write(`${already}\n`)
      process.exitCode = ALREADY_SET_UP
      return
    }
    if (!process.env.SLATEBOX_PUBLIC_URL) throw new Plain('Slatebox is still starting. Try again in a moment.')
    const link = await makeLink(db, process.env.SLATEBOX_PUBLIC_URL)
    if (!link) {
      process.stderr.write(`${already}\n`)
      process.exitCode = ALREADY_SET_UP
      return
    }
    process.stdout.write(args.includes('--json') ? `${JSON.stringify(link)}\n` : `${link.url}\n`)
    if (!args.includes('--json')) {
      process.stderr.write('Open this link to create the first account: the server administrator and the owner of the first team.\n' +
        'It works once, expires in 24 hours, and stops working when a new link is made. Give it to nobody else.\n')
    }
  } finally {
    await client.close().catch(() => {})
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch(fail)
}
