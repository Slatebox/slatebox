import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { Organizations } from '../../imports/api/common/models'
import { enrollAccount, firstNameOf, logoUrlFor, resetPassword, verifyEmail } from './templates.mjs'

/** The logo's address for this instance's emails (templates.mjs logoUrlFor). */
export const emailLogoUrl = () => logoUrlFor(Meteor.settings.public?.baseUrl || Meteor.absoluteUrl())

export default async function setup() {
  // eslint-disable-next-line no-undef
  if (Meteor.settings.mailGun?.server) process.env.MAIL_URL = Meteor.settings.mailGun.server
  Accounts.emailTemplates.siteName = 'Slatebox'
  // A self-hosted instance sends from its operator's own address (mailFrom),
  // one its mail service accepts.
  Accounts.emailTemplates.from = Meteor.settings.mailFrom || 'Slatebox <info@slatebox.com>'

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
  for (const [type, render] of Object.entries(accountEmail)) {
    Accounts.emailTemplates[type].subject = async (user, url) => (await render(user, url)).subject
    Accounts.emailTemplates[type].html = async (user, url) => (await render(user, url)).html
    Accounts.emailTemplates[type].text = async (user, url) => (await render(user, url)).text
  }

  // strips the # from the genned urls
  Accounts.urls.resetPassword = (token) =>
    Meteor.absoluteUrl(`reset-password/${token}`)
  Accounts.urls.verifyEmail = (token) =>
    Meteor.absoluteUrl(`verify-email/${token}`)
  Accounts.urls.enrollAccount = (token) =>
    Meteor.absoluteUrl(`enroll-account/${token}`)
}
