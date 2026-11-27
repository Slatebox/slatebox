import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { Organizations } from '../../imports/api/common/models'
import { enrollAccount, firstNameOf, logoUrlFor, resetPassword, verifyEmail } from './templates.mjs'

/**
 * The logo's address for this instance's emails: settings.email.logoUrl when set (a self-hosted
 * instance whose own address its recipients can't reach), else templates.mjs logoUrlFor.
 */
export const emailLogoUrl = () => {
  const configured = Meteor.settings.email?.logoUrl
  if (typeof configured === 'string' && /^https:\/\/\S+$/i.test(configured.trim())) return configured.trim()
  return logoUrlFor(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl())
}

export default async function setup() {
  // eslint-disable-next-line no-undef
  if (Meteor.settings.mailGun?.server) process.env.MAIL_URL = Meteor.settings.mailGun.server
  Accounts.emailTemplates.siteName = 'Slatebox'
  // A self-hosted instance sends from its operator's own address (mailFrom),
  // one its mail service accepts.
  Accounts.emailTemplates.from = Meteor.settings.mailFrom || 'Slatebox <info@slatebox.com>'
  // A link to verify an email address works for 3 days (Meteor 3.6's default, set here so it is a
  // decision, not an accident; before 3.6 the links never expired). An expired link shows its error on
  // /verify-email with a resend.
  Accounts.config({ emailVerificationTokenExpirationInDays: 3 })

  // The team an invitation is for: its name, else its subdomain.
  async function teamNameOf(user) {
    if (!user.orgId) return ''
    const org = await Organizations.findOneAsync(user.orgId)
    return (org && (org.name || org.subdomain)) || ''
  }

  // Each email's subject, HTML and text come from one render (templates.mjs).
  const accountEmail = {
    verifyEmail: async (user, url) => verifyEmail({ firstName: firstNameOf(user), url, logoUrl: emailLogoUrl() }),
    resetPassword: async (user, url) => resetPassword({ firstName: firstNameOf(user), url, logoUrl: emailLogoUrl() }),
    // only org admins send enrollment emails
    enrollAccount: async (user, url) => enrollAccount({
      firstName: firstNameOf(user), teamName: await teamNameOf(user), url, logoUrl: emailLogoUrl(),
    }),
  }
  // Accounts asks for the subject, then the text, then the HTML of one email: render it once
  // (one team lookup) and hand out its parts. The render is keyed by user and URL (the URL holds
  // the one-time token) and dropped after a minute.
  const renders = new Map()
  const renderOnce = (type, render, user, url) => {
    const key = `${type}\n${user?._id}\n${url}`
    const now = Date.now()
    for (const [k, entry] of renders) if (entry.at < now - 60_000) renders.delete(k)
    if (!renders.has(key)) {
      const pending = render(user, url)
      pending.catch(() => renders.delete(key))
      renders.set(key, { at: now, pending })
    }
    return renders.get(key).pending
  }
  for (const [type, render] of Object.entries(accountEmail)) {
    for (const part of ['subject', 'html', 'text']) {
      Accounts.emailTemplates[type][part] = async (user, url) => (await renderOnce(type, render, user, url))[part]
    }
  }

  // strips the # from the genned urls
  Accounts.urls.resetPassword = (token) =>
    Meteor.absoluteUrl(`reset-password/${token}`)
  Accounts.urls.verifyEmail = (token) =>
    Meteor.absoluteUrl(`verify-email/${token}`)
  Accounts.urls.enrollAccount = (token) =>
    Meteor.absoluteUrl(`enroll-account/${token}`)
}
