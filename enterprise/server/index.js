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

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

// eslint-disable-next-line no-unused-vars
export function register(api, context) {
  // Outside agent connections (the MCP client, connectors and their OAuth callback) register
  // here as their slices land. Each one checks context.agentInvite before it adds anything a
  // person can reach.
}
