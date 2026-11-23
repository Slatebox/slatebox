/* eslint-disable no-console */
// The Meteor side of server/enterprise-loader.mjs. Imported near the top of server/main.js, before
// any module builds the action registry, so enterprise actions join the one registry.
//
// '/enterprise/server' is web/app/enterprise/server: on Cloud builds and in local development a
// copy of (or link to) the repository's enterprise/ directory (scripts/enterprise-stage.mjs); in a
// self-host image a stub with no enterprise code. It is required only when the edition is Cloud.
import { Meteor } from 'meteor/meteor'
import app from './expressApp'
import { enterpriseHost, loadEnterprise } from './enterprise-loader.mjs'

const result = loadEnterprise({
  settings: Meteor.settings,
  host: enterpriseHost,
  load: () => require('/enterprise/server'),
  log: (text) => console.warn('[enterprise]', text),
})

if (result.loaded) {
  if (Object.keys(enterpriseHost.methods).length) Meteor.methods(enterpriseHost.methods)
  for (const { method, path, handler } of enterpriseHost.routes) app[method.toLowerCase()](path, handler)
  for (const fn of enterpriseHost.startups) Meteor.startup(fn)
  console.log(
    `[enterprise] Cloud edition: ${result.name} registered ${enterpriseHost.actions.length} actions, ` +
      `${Object.keys(enterpriseHost.methods).length} methods, ${enterpriseHost.routes.length} routes`
  )
}

export default result
