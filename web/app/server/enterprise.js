/* eslint-disable no-console */
// The Meteor side of server/enterprise-loader.mjs. Imported near the top of server/main.js, before
// any module builds the action registry, so enterprise actions join the one registry.
//
// '/enterprise/server' is web/app/enterprise/server: a copy of (or, in local development, a link
// to) the repository's enterprise/ directory (scripts/enterprise-stage.mjs). Cloud and self-host
// images both carry it. It runs on every self-hosted install with no key (integrations are free
// everywhere, owner 2026-11-26), and on Slatebox Cloud by Cloud's own key
// (server/enterprise-license.mjs). A build without it still starts, without integrations.
import express from 'express'
import { Meteor } from 'meteor/meteor'
import app from './expressApp'
import { enterpriseHost, loadEnterprise } from './enterprise-loader.mjs'
import { enterpriseAccess } from './enterprise-license.mjs'
import { enterpriseStatusFor } from './enterprise-status.mjs'
import { Permissions } from '../imports/api/common/models'
import CONSTANTS from '../imports/api/common/constants'

const access = (now) => enterpriseAccess({ settings: Meteor.settings, env: process.env, now })
const load = () => require('/enterprise/server')
const log = (text) => console.warn('[enterprise]', text)

// Enterprise routes go through one router mounted now, so they come before anything the app mounts
// after this file.
const routes = express.Router()
app.use(routes)

const result = loadEnterprise({ settings: Meteor.settings, host: enterpriseHost, load, log, access })

// What every browser is told before it loads: whether enterprise code runs here, as which edition,
// and which of its features are on. The browser loads the enterprise chunk only when it does
// (client/enterprise.js); the server checks every call anyway.
Meteor.settings.public = Meteor.settings.public || {}
Meteor.settings.public.enterprise = result.loaded ? { unlocked: true, via: result.access.via, features: result.features } : { unlocked: false }

if (result.loaded) {
  if (Object.keys(enterpriseHost.methods).length) Meteor.methods(enterpriseHost.methods)
  for (const { method, path, handler } of enterpriseHost.routes) routes[method.toLowerCase()](path, handler)
  for (const fn of enterpriseHost.startups) Meteor.startup(fn)?.catch?.((error) => console.error('[enterprise] startup', error))
  console.log(
    `[enterprise] ${result.access.via === 'cloud' ? 'Cloud edition' : 'self-hosted'}: ${result.name} registered ${enterpriseHost.actions.length} actions, ` +
      `${Object.keys(enterpriseHost.methods).length} methods, ${enterpriseHost.routes.length} routes` +
      (result.features.length ? '' : ' (invited agents are switched off: settings.connectors.off)')
  )
  if (result.access.reason === 'grace') console.warn('[enterprise]', result.access.words)
} else if (result.reason === 'locked') {
  console.log('[enterprise]', result.access.words)
}

// Admin tools › Integrations: whether integrations run on this server, for its administrators (the
// platform administrator claim). A plain method, not a registry action, on purpose: it is the admin
// page's own read of the server's state, with nothing a token or an agent should reach (like
// agents.control's exception, written down here where it is defined).
Meteor.methods({
  async 'enterprise.status'() {
    const userId = Meteor.userId()
    const admin = Boolean(userId && (await Permissions.findOneAsync({ userId, claimId: CONSTANTS.claims.uberMensch._id }, { fields: { _id: 1 } })))
    if (!admin) throw new Meteor.Error('denied', 'Only an administrator can see whether integrations run on this server.')
    return enterpriseStatusFor({ settings: Meteor.settings, running: result })
  },
})
