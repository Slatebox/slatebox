/* eslint-disable no-console */
// The Meteor side of server/enterprise-loader.mjs. Imported near the top of server/main.js, before
// any module builds the action registry, so enterprise actions join the one registry.
//
// '/enterprise/server' is web/app/enterprise/server: a copy of (or, in local development, a link
// to) the repository's enterprise/ directory (scripts/enterprise-stage.mjs). Cloud and self-host
// images both carry it; it is required only where it is unlocked (Slatebox Cloud, or a self-hosted
// install with a license key: server/enterprise-license.mjs).
import { Meteor } from 'meteor/meteor'
import app from './expressApp'
import { enterpriseHost, loadEnterprise } from './enterprise-loader.mjs'
import { licenseStatusFor } from './enterprise-license-status.mjs'
import { Permissions } from '../imports/api/common/models'
import CONSTANTS from '../imports/api/common/constants'

const result = loadEnterprise({
  settings: Meteor.settings,
  host: enterpriseHost,
  load: () => require('/enterprise/server'),
  log: (text) => console.warn('[enterprise]', text),
})

// What every browser is told before it loads (Meteor sends settings.public as it stands): whether
// enterprise code runs here, how, and which of its features are on. The browser loads the
// enterprise chunk only when it does (client/enterprise.js); the server checks every call anyway.
Meteor.settings.public = Meteor.settings.public || {}
Meteor.settings.public.enterprise = result.loaded
  ? { unlocked: true, via: result.access.via, features: result.features }
  : { unlocked: false }

if (result.loaded) {
  if (Object.keys(enterpriseHost.methods).length) Meteor.methods(enterpriseHost.methods)
  for (const { method, path, handler } of enterpriseHost.routes) app[method.toLowerCase()](path, handler)
  for (const fn of enterpriseHost.startups) Meteor.startup(fn)
  const how = result.access.via === 'cloud' ? 'Cloud edition' : `licensed to ${result.access.license?.licensee || 'this install'}`
  console.log(
    `[enterprise] ${how}: ${result.name} registered ${enterpriseHost.actions.length} actions, ` +
      `${Object.keys(enterpriseHost.methods).length} methods, ${enterpriseHost.routes.length} routes` +
      (result.features.length ? '' : ' (invited agents are switched off: settings.connectors.off)')
  )
  if (result.access.reason === 'grace') console.warn('[enterprise]', result.access.words)
} else if (result.reason === 'locked') {
  console.log('[enterprise]', result.access.words)
}

// Admin tools › Enterprise features: the license state for this server's administrators (the
// platform administrator claim). A plain method, not a registry action, on purpose: it is the admin
// page's own read of the server's settings, with nothing a token or an agent should reach (like
// agents.control's exception, written down here where it is defined).
Meteor.methods({
  async 'enterprise.licenseStatus'() {
    const userId = Meteor.userId()
    const admin = Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))
    if (!admin) throw new Meteor.Error('denied', 'Only an administrator can see this server\'s license.')
    return licenseStatusFor({ settings: Meteor.settings, env: process.env, running: result })
  },
})

export default result
