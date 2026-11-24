// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The server half of Slatebox Cloud's outside agent connections. The MIT app calls register()
// once at start, on Cloud only (web/app/server/enterprise-loader.mjs), and never on self-host.
// Everything here reaches the app only through `api`:
//   api.addActions([...])   one registry action = Meteor method + /api/v1 route + exec + MCP tool
//   api.addMethods({...})   plain Meteor methods (prefer actions)
//   api.addRoute({ method, path, handler })   e.g. GET /connectors/oauth/callback
//   api.onStartup(fn)
/* eslint-disable no-console */
// context: { edition: 'cloud', settings, agentInvite } where agentInvite is
// settings.public.agents.invite === true (the invite feature switch, off by default).
import { connectorActions } from './actions.mjs'
import { signInRoutes } from './routes.mjs'

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

export function register(api, context) {
  // Nothing a person can reach is added while the invite switch is off.
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
    log: (entry) => console.log('[connectors]', JSON.stringify(entry)),
  })) api.addRoute(route)
  api.onStartup(async () => {
    const { startConnectors } = await import('./meteor.js')
    started = startConnectors()
  })
}
