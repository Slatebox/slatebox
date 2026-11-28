// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The vendor apps a native integration signs people in with (not MCP: oauth.mjs KNOWN_PROVIDERS are
// the MCP vendors). An operator registers one app with the vendor and enters it in Admin › Integration
// apps (integration-apps.mjs) or settings.connectors.oauthApps.<provider>.
//   slack  the Slack app (from the manifest Admin › Integration apps shows): client id, client secret
//          and the signing secret Slack signs its events, shortcuts and commands with
//          (enterprise/server/slack/).
//   linear the public Linear OAuth app recipes read Linear with: client id, client secret and the
//          webhook signing secret Linear signs its events with (enterprise/server/linear/).
export const NATIVE_APPS = Object.freeze({
  slack: Object.freeze({ name: 'Slack', signingSecret: true }),
  linear: Object.freeze({ name: 'Linear', signingSecret: true }),
})
