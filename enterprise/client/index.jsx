// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The browser half of Slatebox Cloud's outside agent connections. Loaded with import() on Cloud
// only (web/app/client/enterprise.js), as its own chunk. It fills the app's named slots
// (<EnterpriseSlot name="..."/>) through api.fill(name, Component).
// context: { edition: 'cloud', agentInvite }; the invite UI fills its slots only when
// agentInvite is true (settings.public.agents.invite).
import AgentsOnSlate, { InvitedAgentControls } from './AgentsOnSlate'

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

export function register(api, context) {
  if (!context?.agentInvite) return
  // The slate's invited agents: each one chip on the app's roster, "+ Invite agent" and the walkthrough.
  api.fill('canvas.agents', AgentsOnSlate)
  // Inside an invited agent's roster chip: the ask box (the inviter's only), Sign in again, Renew Pro, Remove.
  api.fill('agents.chip', InvitedAgentControls)
}
