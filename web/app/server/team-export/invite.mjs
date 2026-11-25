// Inviting an imported person: their placeholder gets the address the archive gave and an
// enrollment email, so they can claim it. Runs without Meteor (tested in scripts/team-export.test.mjs).
//
// - An address that any account here already uses, in any letter case, is never given to a
//   placeholder: that person has to agree to move (needs_consent). Meteor finds accounts by
//   address without regard to case and finds none when two accounts share one, so a second
//   account with "alice@acme.test" beside "Alice@Acme.test" would lock the first person out.
// - The address is written, then checked again the way Meteor checks a new account's address:
//   if another account took it meanwhile, the write is undone.
// - An address the source had not verified is invited only when the administrator confirmed
//   that one address (confirmed: true).
// - With askToJoin, the account that already has the address is asked to join instead: a
//   one-time invitation (14 days) it accepts while signed in (import-core acceptJoin). Its token
//   is kept on the placeholder by hash only. Nobody joins a team without accepting.
import { createHash, randomBytes } from 'node:crypto'

export const JOIN_DAYS = 14
export const hashJoinToken = (token) => createHash('sha256').update(String(token)).digest('hex')

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const addressQuery = (email) => ({ 'emails.address': { $regex: '^' + escapeRegex(email) + '$', $options: 'i' } })

/**
 * users: the driver's users collection. mailAvailable() → boolean. sendEnrollment(userId, email).
 * askToJoin({ placeholder, account, email, token }) (optional): emails the account that already has
 * the address an invitation to join, with the link that carries token.
 * Returns invite(user, { confirmed }) → 'sent' | 'asked' | 'needs_consent' | 'unverified' |
 * 'mail_disabled' | 'already_invited'.
 */
export function createPlaceholderInvite({ users, mailAvailable, sendEnrollment, askToJoin = null, now = Date.now, random = randomBytes }) {
  async function ask(user, account, email) {
    const join = user.importPlaceholder.join
    if (join && join.userId === account._id && new Date(join.expiresAt).valueOf() > now()) return 'already_invited'
    const token = random(32).toString('base64url')
    await users.updateOne(
      { _id: user._id },
      { $set: { 'importPlaceholder.join': { userId: account._id, tokenHash: hashJoinToken(token), expiresAt: new Date(now() + JOIN_DAYS * 86400000), askedAt: new Date(now()) } } }
    )
    await askToJoin({ placeholder: user, account, email, token })
    return 'asked'
  }
  return async function invite(user, { confirmed = false } = {}) {
    const email = user?.importPlaceholder?.email
    if (!email) return 'needs_consent'
    if (user.importPlaceholder.emailVerified !== true && !confirmed) return 'unverified'
    if (!mailAvailable()) return 'mail_disabled'
    const others = await users.find({ _id: { $ne: user._id }, ...addressQuery(email) }, { projection: { _id: 1, isAnonymous: 1, importPlaceholder: 1 } }).toArray()
    if (others.length) {
      // One account has it: that person is asked to join. Two (letter case), or a placeholder: nobody is.
      const account = others.length === 1 && !others[0].isAnonymous && !others[0].importPlaceholder ? others[0] : null
      return askToJoin && account ? ask(user, account, email) : 'needs_consent'
    }
    const written = await users.updateOne({ _id: user._id, emails: { $size: 0 } }, { $set: { emails: [{ address: email, verified: false }] } })
    if (!written.matchedCount) return 'already_invited'
    if ((await users.countDocuments(addressQuery(email))) > 1) {
      await users.updateOne({ _id: user._id }, { $set: { emails: [] } })
      return 'needs_consent'
    }
    await sendEnrollment(user._id, email)
    return 'sent'
  }
}
