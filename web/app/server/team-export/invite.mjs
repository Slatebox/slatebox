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

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const addressQuery = (email) => ({ 'emails.address': { $regex: '^' + escapeRegex(email) + '$', $options: 'i' } })

/**
 * users: the driver's users collection. mailAvailable() → boolean. sendEnrollment(userId, email).
 * Returns invite(user, { confirmed }) → 'sent' | 'needs_consent' | 'unverified' | 'mail_disabled'
 * | 'already_invited'.
 */
export function createPlaceholderInvite({ users, mailAvailable, sendEnrollment }) {
  return async function invite(user, { confirmed = false } = {}) {
    const email = user?.importPlaceholder?.email
    if (!email) return 'needs_consent'
    if (user.importPlaceholder.emailVerified !== true && !confirmed) return 'unverified'
    if (!mailAvailable()) return 'mail_disabled'
    if (await users.findOne({ _id: { $ne: user._id }, ...addressQuery(email) }, { projection: { _id: 1 } })) return 'needs_consent'
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
