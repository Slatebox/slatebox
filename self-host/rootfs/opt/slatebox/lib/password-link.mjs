// Make a one-time link with which a person sets a new password, for an
// administrator to pass on. Without mail it is the way to recover an account;
// with mail it works the same. It runs inside the container with the app's own
// database connection (bundled or MONGO_URL) and prints only the link.
//
//   node password-link.mjs EMAIL      (MONGO_URL and the public address in the environment)
import { randomBytes } from 'node:crypto'
import { Plain, fail, mongodb } from './common.mjs'

const email = (process.argv[2] || '').trim()
const { MongoClient } = mongodb()
const client = new MongoClient(process.env.MONGO_URL)
try {
  if (!email) throw new Plain('Name the account: docker exec slatebox slatebox password-link person@example.com')
  await client.connect()
  const users = client.db().collection('users')
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = await users.find(
    { 'emails.address': { $regex: `^${escaped}$`, $options: 'i' } },
    { projection: { emails: 1 } },
  ).limit(2).toArray()
  if (matches.length !== 1) {
    throw new Plain(matches.length ? `More than one account uses ${email}.` : `No account uses ${email}.`)
  }
  const [user] = matches
  const address = user.emails.find(entry => entry.address.toLowerCase() === email.toLowerCase()).address
  // The same record Meteor's own "forgot password" mail creates, so the app's
  // reset page accepts it, expires it and removes it after one use.
  const token = randomBytes(32).toString('base64url')
  await users.updateOne({ _id: user._id }, {
    $set: { 'services.password.reset': { token, email: address, when: new Date(), reason: 'reset' } },
  })
  process.stdout.write(`${process.env.SLATEBOX_PUBLIC_URL}/reset-password/${token}\n`)
  process.stderr.write(`Give this link to ${address} only. It sets a new password once, and expires in three days or when another link is made.\n`)
} catch (error) {
  fail(error)
} finally {
  await client.close().catch(() => {})
}
