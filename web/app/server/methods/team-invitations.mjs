// One delivery per pending address. Replaying a submitted batch skips recipients
// already mailed. An explicit resend issues a fresh Meteor enrollment token.
export async function deliverTeamInvitations({ org, invites, memberIds, io }) {
  const resend = memberIds !== undefined
  if (!Array.isArray(resend ? memberIds : invites)) {
    throw io.error('invalid-invitation', 'Choose the team members to invite.')
  }
  const requested = new Map()
  if (resend) {
    for (const id of memberIds) {
      if (typeof id !== 'string' || !id) throw io.error('invalid-invitation', 'Choose a pending team member.')
      requested.set(id, null)
    }
  } else {
    for (const invite of invites) {
      const email = typeof invite?.email === 'string' && invite.email.trim().toLowerCase()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          typeof invite.firstName !== 'string' || !invite.firstName.trim() ||
          typeof invite.lastName !== 'string' || !invite.lastName.trim()) {
        throw io.error('invalid-invitation', 'Enter a name and email address for each invitation.')
      }
      requested.set(email, { email, firstName: invite.firstName.trim(), lastName: invite.lastName.trim() })
    }
  }
  if (!requested.size) return { success: true, sent: 0 }
  if (!io.mailAvailable()) throw io.error('mail-disabled', 'Enrollment email is disabled on this instance. Configure email and try again.')
  const pending = []
  for (const [key, profile] of requested) {
    const user = resend ? await io.byTeamId(org._id, key) : await io.byEmail(key)
    if (!user && !resend) {
      pending.push({ profile })
      continue
    }
    if (!resend && user?.orgId === org._id && user.teamEnrollmentSentAt) continue
    if (!user || user.orgId !== org._id || user.isAnonymous ||
        user.services?.password?.bcrypt || user.services?.password?.argon2 || user.emails?.[0]?.verified || !user.emails?.[0]?.address) {
      throw io.error('invalid-invitation', 'This address is unavailable for a new enrollment invitation.')
    }
    pending.push({ id: user._id, email: user.emails[0].address })
  }
  for (const member of pending) {
    if (!member.id) {
      member.id = await io.create(org._id, member.profile)
      member.email = member.profile.email
    }
  }
  let sent = 0
  for (const member of pending) {
    try {
      await io.send(member.id, member.email)
      await io.markSent(org._id, member.id)
      sent++
    } catch {
      throw io.error('enrollment-delivery', 'Enrollment email failed for ' + member.email + '. The member is saved. Retry the invitations or resend from the team member list.')
    }
  }
  return { success: true, sent }
}
