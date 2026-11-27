// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The server half of outside agent connections. The MIT app calls register() once at start where
// enterprise code runs (web/app/server/enterprise-loader.mjs): on Slatebox Cloud, and on every
// self-hosted install whose build carries this code. Integrations are free on both.
// Everything here reaches the app only through `api`:
//   api.addActions([...])   one registry action = Meteor method + /api/v1 route + exec + MCP tool
//   api.addMethods({...})   plain Meteor methods (prefer actions)
//   api.addRoute({ method, path, handler })   e.g. GET /connectors/oauth/callback
//   api.onStartup(fn)
/* eslint-disable no-console */
// context: { edition, settings, unlocked, via: 'cloud'|'self-host', features, agentInvite, isUnlocked }
// where agentInvite is true unless the server-side kill switch settings.connectors.off is set, and
// isUnlocked() says whether enterprise code may still run (Cloud's key, checked hourly; always true
// on a self-hosted install; actions, methods and routes are already guarded by the app).
import { connectorActions, integrationActions } from './actions.mjs'
import { galleryActions } from './gallery-admin.mjs'
import { integrationAppActions } from './integration-apps.mjs'
import { googleActions } from './google/actions.mjs'
import { slackActions } from './slack/actions.mjs'
import { slackRoutes } from './slack/routes.mjs'
import { signInRoutes } from './routes.mjs'
import { registerTeamAddresses } from '../team-addresses/index.mjs'

// library.cloud: a self-hosted install receives Slatebox Cloud's approved Community integrations (cloud-library.mjs).
export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite', 'library.cloud'] })

export function register(api, context) {
  // Team addresses (<name>.slatebox.team) answer on Slatebox Cloud only, whatever the invited
  // agents' kill switch says; elsewhere their routes answer 404 (../team-addresses/index.mjs).
  registerTeamAddresses(api, context)
  // Nothing a person can reach is added while the kill switch is on.
  if (!context?.agentInvite) return
  let started = null
  const starting = () => Object.assign(new Error('Outside agents are starting. Try again in a moment.'), { status: 409, code: 'starting' })
  const running = () => {
    if (!started) throw starting()
    return started.service
  }
  // Outside agents: open servers (S2a) and servers that need sign-in (S2b):
  // connectors.list/discover/signIn/signInStatus/useKey/connect/disconnect/call. Keeping and
  // discarding what they suggest is the app's own suggestions.decide.
  api.addActions(connectorActions(running))
  // Integrations: connect once, invite onto any slate, standing rules (integrations.*).
  api.addActions(integrationActions(running))
  // Google, native: connect once, save to Drive, export to Docs and Slides, bring files in (google.*).
  api.addActions(googleActions(() => {
    if (!started) throw starting()
    return started.google
  }))
  // Slack, native on its Web API: connect in one click (slack.connect, slack.status). Its agent is asked
  // like any (connectors.call); its changes wait on cards.
  api.addActions(slackActions(() => {
    if (!started) throw starting()
    return started.slack
  }))
  // /admin/ai › Gallery: the invite gallery's cards, order and recipes (aiAgents, audited), the
  // Community cards (suggested integrations approved in the library's review queue) among them.
  api.addActions(galleryActions(() => {
    if (!started) throw starting()
    return started.findGallery
  }, async () => (started ? started.configured() : null), async () => (started ? started.community() : [])))
  // /admin/ai › Integration apps: the OAuth client id and secret of each vendor with no automatic
  // registration, entered by an administrator (the secret sealed, never returned; audited).
  api.addActions(integrationAppActions(() => {
    if (!started) throw starting()
    return started.integrationApps
  }))
  // Sign-in's own addresses: the client document, the popup's start and the fixed callback.
  for (const route of signInRoutes({
    signIn: () => {
      if (!started) throw starting()
      return started.signIn
    },
    origin: () => (started ? started.origin() : ''),
    userFor: async (req) => (started ? started.userFor(req) : null),
    log: (entry) => console.log('[connectors]', JSON.stringify(entry)),
  })) api.addRoute(route)
  // What Slack calls (signed by its signing secret, checked first): events, the Send to slate
  // shortcut and /slatebox (slack/routes.mjs).
  for (const route of slackRoutes({
    slack: () => {
      if (!started) throw starting()
      return started.slack
    },
    events: { claim: (id, expiresAt) => (started ? started.slackEvents.claim(id, expiresAt) : Promise.resolve(false)) },
    log: (entry) => console.log('[slack]', JSON.stringify(entry)),
  })) api.addRoute(route)
  api.onStartup(async () => {
    const { startConnectors } = await import('./meteor.js')
    started = startConnectors({ via: context.via, isUnlocked: context.isUnlocked || (() => true) })
  })
}
