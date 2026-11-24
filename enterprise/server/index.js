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
// context: { edition: 'cloud', settings, agentInvite } where agentInvite is
// settings.public.agents.invite === true (the invite feature switch, off by default).
import { connectorActions } from './actions.mjs'

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

export function register(api, context) {
  // Nothing a person can reach is added while the invite switch is off.
  if (!context?.agentInvite) return
  let service = null
  const running = () => {
    if (!service) throw Object.assign(new Error('Outside agents are starting. Try again in a moment.'), { status: 409, code: 'starting' })
    return service
  }
  // S2a: outside agents on open MCP servers (connectors.list/discover/connect/disconnect/call/keep/discard).
  api.addActions(connectorActions(running))
  api.onStartup(async () => {
    const { startConnectors } = await import('./meteor.js')
    service = startConnectors()
  })
}
