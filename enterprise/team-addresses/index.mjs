// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Team addresses (https://<name>.slatebox.team for a self-hosted Slatebox): Slatebox Cloud only.
// Registered by enterprise/server/index.js wherever enterprise code is unlocked, but nothing here
// answers unless this server is Slatebox Cloud by its signed Cloud key (context.via 'cloud', and
// cloudLicensed() checked again on every call) AND settings.cloudflare.teamClaims is present. A
// licensed on-prem install (via 'license') answers 404 on every route and refuses every method.
//   routes   /api/v1/team-addresses/* (routes.mjs): plain routes, never actions or MCP tools
//   methods  teamAddresses.admin.* (admin.mjs): Admin tools › Team addresses, administrators only
//   startup  meteor.js: the collections, the Cloudflare client, the reconciler (every 10 minutes)
import { teamAddressRoutes } from './routes.mjs'
import { adminMethods } from './admin.mjs'

export function registerTeamAddresses(api, context, { load = () => import('./meteor.js'), log = console.log } = {}) { // eslint-disable-line no-console
  let started = null
  // Cloud by key, the settings present, and started: anything else is the same 404.
  const gate = () => context?.via === 'cloud' && Boolean(started) && started.gate()
  for (const route of teamAddressRoutes({
    gate,
    service: () => started.service,
    authenticateUser: (req) => started.authenticateUser(req),
    address: (req) => (started ? started.address(req) : req.socket?.remoteAddress),
    log,
  })) api.addRoute(route)
  api.addMethods(adminMethods(() => (context?.via === 'cloud' ? started : null)))
  // Nothing starts off Slatebox Cloud: no collections, no Cloudflare client, no reconciler.
  if (context?.via !== 'cloud') return
  api.onStartup(async () => {
    const { startTeamAddresses } = await load()
    started = await startTeamAddresses({ isUnlocked: context.isUnlocked || (() => true) })
  })
}
