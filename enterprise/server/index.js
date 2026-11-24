// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The server half of outside agent connections. The MIT app calls register() once at start where
// enterprise code is unlocked (web/app/server/enterprise-loader.mjs): on Slatebox Cloud, and on a
// self-hosted install with a license key from Slatebox LLC. A locked install never calls it.
// Everything here reaches the app only through `api`:
//   api.addActions([...])   one registry action = Meteor method + /api/v1 route + exec + MCP tool
//   api.addMethods({...})   plain Meteor methods (prefer actions)
//   api.addRoute({ method, path, handler })   e.g. GET /connectors/oauth/callback
//   api.onStartup(fn)
/* eslint-disable no-console */
// context: { edition, settings, unlocked, via: 'cloud'|'license', features, agentInvite } where
// agentInvite is true unless the server-side kill switch settings.connectors.off is set.
import { connectorActions } from './actions.mjs'
import { signInRoutes } from './routes.mjs'

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

export function register(api, context) {
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
  api.onStartup(async () => {
    const { startConnectors } = await import('./meteor.js')
    started = startConnectors()
  })
}
