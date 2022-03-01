import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { Organizations } from '../../imports/api/common/models'

export default function setup() {
  // eslint-disable-next-line no-undef
  process.env.MAIL_URL = Meteor.settings.mailGun.server
  Accounts.emailTemplates.siteName = 'Slatebox'
  Accounts.emailTemplates.from = 'Slatebox <info@slatebox.com>'

  function compileEmail(user, url, type, asText) {
    let userName = user.emails[0].address
      ? ` ${user.emails[0].address.split('@')[0]}`
      : ''
    if (user.profile && user.profile.firstName) {
      userName = ` ${user.profile.firstName} ${user.profile.lastName}`
    }
    let org = null
    let name = ''
    if (user.orgId) {
      org = Organizations.findOne(user.orgId)
      name = org && org.name ? org.name : org.subdomain
    }

    let welcomeMessage = `Hi${userName}, welcome to Slatebox.`
    if (type === 'forgot') {
      welcomeMessage = `Hi${userName}, reset your password`
    }

    let header = `<div style="width:800px;margin-right:auto;margin-left:auto;">
        <div style="clear:both;height:90px;">
          <div style="float:left;width:40%;padding:10px;">
            <img src="https://assets.slatebox.com/images/slatebox_logo_email.png" alt="Slatebox - Visual Team Collaboration"/>
          </div>
          <div style="padding:10px;float:left;font-family:Helvetica;color:#333;font-size:16pt;line-height:35px;width:55%">${welcomeMessage}</div>
        </div>`

    if (asText) {
      header = `${welcomeMessage}\n\n`
    }

    const footer = ''
    // let footer = `<div style="padding:3px;margin:3px;">
    //       <a href="https://twitter.com/intent/user?screenname=slatebox">
    //         twitter
    //       </a>
    //       &nbsp;&nbsp;
    //       <a href="https://fb.me/slatebox">
    //         facebook
    //       </a>
    //     </div>
    //   </div>`;

    // if (asText) {
    //   footer = "";
    // }

    let body = ''

    switch (type) {
      case 'verify':
        if (asText) {
          body = `Yay for joining Slatebox! Please verify your email below.\n\n
              Click here to verify your email: ${url}\n
              Once verified, you'll be able to access all the Slatebox features.\n
              We're excited to see what you create!`
        } else {
          body = `<div style="padding:3px;margin:3px;font-family:Helvetica;font-size:13pt;">
            <h2>Yay for joining Slatebox! Please verify your email below.</h2>
            <p><a href="${url}">Click here to verify your email</a>. Once verified, you'll be able to access all the Slatebox features.</p>
            <p>We're excited to see what you create!</p>
          </div>`
        }
        break
      // case "enrollAdmin":
      //   if (asText) {
      //     body = `Your new Slatebox ${name} team is ready!\n\n
      //         Thanks for signing up! Slatebox is super easy to start using. The next step is to set a password for your new administrator account, and after you create the password and log in, then you can start inviting users.\n\n
      //         Click here to set the password on your administrator account: ${url}.\n
      //         Once created, you'll be able to log in and start sending invites.\n
      //         We're excited to see what you create!`;
      //   } else {
      //     body = `<div style="padding:3px;margin:3px;font-family:Helvetica;font-size:13pt;">
      //         <h2>Your new Slatebox ${name} team is ready!</h2>
      //         <p>Thanks for signing up! Slatebox is super easy to start using. The next step is to set a password for your new administrator account, and after you create the password and log in, then you can start inviting users.</p>
      //         <p><a href="${url}">Click here to set the password on your administrator account</a>. Once created, you'll be able to log in and start sending invites.</p>
      //         <p>We're excited to see what you create!</p>
      //       </div>`;
      //     }
      //   break;
      case 'enrollInvite':
        if (asText) {
          body = `Hooray! You've been invited to join the ${name} team.\n\n
                Slatebox is built for real-time visual collaboration with your team. Build a "slate" and easily share your creations.\n\n
                Click here to join ${name} and start building: ${url}\n
                We're excited to see what you make!`
        } else {
          body = `<div style="padding:3px;margin:3px;font-family:Helvetica;font-size:13pt;">
                <h2>Hooray! You've been invited to join the ${name} team.</h2>
                <p>Slatebox is built for real-time visual collaboration with your team. Build a "slate" and easily share your creations.</p>
                <p><a href="${url}">Click here to join ${name} and start building!</a>.</p>
                <p>We're excited to see what you make!</p>
              </div>`
        }
        break
      case 'forgot':
        if (asText) {
          body = `Hi ${userName}, forget your password? No problem.\n\n
          Click here to reset your password: ${url}`
        } else {
          body = `<div style="padding:3px;margin:3px;font-family:Helvetica;font-size:13pt;">
              <h2>Hi ${userName}, forget your password? No problem.</h2>
              <p><a href="${url}">Click here to reset your password</a>.</p>
            </div>`
        }
        break
      default:
        break
    }

    const ret = `${header}${body}${footer}`
    return ret
  }

  Accounts.emailTemplates.verifyEmail.subject = (user) => 'Welcome to Slatebox!'

  Accounts.emailTemplates.verifyEmail.html = (user, url) =>
    compileEmail(user, url, 'verify')

  Accounts.emailTemplates.verifyEmail.text = (user, url) =>
    compileEmail(user, url, 'verify', true)

  Accounts.emailTemplates.resetPassword.html = (user, url) =>
    compileEmail(user, url, 'forgot')

  Accounts.emailTemplates.resetPassword.text = (user, url) =>
    compileEmail(user, url, 'forgot', true)

  // only org admins send enrollment emails
  Accounts.emailTemplates.enrollAccount.subject = (user) =>
    'Welcome to Slatebox!'

  Accounts.emailTemplates.enrollAccount.text = (user, url) =>
    compileEmail(user, url, 'enrollInvite', true)

  Accounts.emailTemplates.enrollAccount.html = (user, url) =>
    compileEmail(user, url, 'enrollInvite')

  // strips the # from the genned urls
  Accounts.urls.resetPassword = (token) =>
    Meteor.absoluteUrl(`reset-password/${token}`)
  Accounts.urls.verifyEmail = (token) =>
    Meteor.absoluteUrl(`verify-email/${token}`)
  Accounts.urls.enrollAccount = (token) =>
    Meteor.absoluteUrl(`enroll-account/${token}`)
}
