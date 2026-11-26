// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What the gallery and the Integrations page say about a person's integrations, as plain functions
// (shared by enterprise/client/InviteWalkthrough.jsx and IntegrationsPage.jsx, and tested in
// scripts/integrations-polish.test.mjs): a connected card's ✓ line and next step, the one-line tool
// summary, and the offer to let an integration make changes too.

// What an integration's state says, where it can't be invited now.
export const STATUS_WORDS = { paused: 'tools changed: review it on the Integrations page', needs_sign_in: 'needs sign-in', pro_ended: 'Pro ended' }

/**
 * The gallery card's state for this person: { here } when one of their agents on this slate came
 * from it; { linked } when it is one of their connected integrations (Google is never a gallery card).
 */
export function cardState(item, invited = [], integrations = []) {
  // A paused copy (its tools changed) is invited again to look at them, so its card stays open.
  const here = invited.find((c) => c.galleryId === item.id && c.mine && c.status !== 'removed' && c.status !== 'paused') || null
  const linked = integrations.find((i) => i.galleryId === item.id && i.kind !== 'google') || null
  return { here, linked }
}

/** What a connected card says and does next: Manage on the Integrations page, Invite on a slate. */
export function connectedAction({ here, linked }, integrationMode) {
  if (here) return { words: '✓ On this slate · Manage', act: 'manage-agent' }
  if (!linked) return null
  if (integrationMode) return { words: '✓ Connected · Manage', act: 'manage-integration' }
  if (linked.status !== 'active') return { words: `✓ Connected · ${STATUS_WORDS[linked.status] || linked.status}`, act: 'discover' }
  return { words: '✓ Connected · Invite to this slate', act: 'invite' }
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

/**
 * What an integration may use, in a line: "Looks things up with 34 tools · Makes changes with 6 (you
 * approve each one) · 2 off". The full list is behind Review tools.
 */
export function toolSummary(integration) {
  const tools = integration.tools || []
  const lookups = tools.filter((tool) => tool.group === 'lookup' && tool.policy === 'allow').length
  const changes = tools.filter((tool) => tool.group === 'change' && tool.policy === 'allow').length
  const off = tools.filter((tool) => tool.policy !== 'allow').length
  const parts = []
  if (lookups) parts.push(`Looks things up with ${plural(lookups, 'tool')}`)
  if (changes) parts.push(`Makes changes with ${changes} (${integration.actWithoutAsking ? 'made without asking, except deleting, closing or merging' : 'you approve each one'})`)
  if (off) parts.push(`${off} off`)
  return parts.length ? parts.join(' · ') : 'Nothing allowed yet'
}

/**
 * Whether its owner can let it make changes too: { kind: 'allow', count } for changes its server
 * offers that its consent has off; { kind: 'address', address } when it is connected at its card's
 * read-only address (one more sign-in at the full one); else null. Destructive ones are never offered.
 */
export function changesOffer(integration) {
  if (integration.kind !== 'mcp') return null
  if (integration.writesAt) return { kind: 'address', address: integration.writesAt }
  const count = (integration.tools || []).filter((tool) => tool.group === 'change' && !tool.destructive && tool.policy !== 'allow').length
  return count ? { kind: 'allow', count } : null
}

/**
 * What "Add" does for one of this person's connected integrations in the canvas's Invite agent panel
 * (owner, 2026-11-25: "it should be quicker to invite an already connected mcp to the slate - they can
 * just connect here without 'asking' first"). Connecting it already gave its sign-in and its consent,
 * so adding it is instant: one click, no dialog, no new sign-in, no consent again. The only times it
 * is not are said plainly: its tools changed since it was connected (look at them once), it needs a
 * new sign-in, Pro ended, or this slate's owner does not let this person bring outside agents here.
 * Adding never changes how its outside changes are approved: Ask first stays its default.
 *
 * integration: a row of integrations.list. invited: the agents on this slate (each with integrationId,
 * mine, status). setting: integrations.slateSetting's answer, or null while it is still asked (the
 * server checks it again either way). isOwner: this person owns the slate.
 * Returns { act, why }: act is 'here' (already on this slate), 'add' (instant), 'review' (its tools
 * changed), 'sign-in', 'pro' or 'blocked' (the slate owner's rule); why is empty only for 'add'/'here'.
 */
export function addDecision(integration, { invited = [], setting = null, isOwner = false } = {}) {
  const name = integration?.name || 'This agent'
  const here = invited.find((c) => c.mine && c.status !== 'removed' && c.integrationId === integration?.integrationId)
  if (here) return { act: 'here', why: '' }
  const rule = setting?.outsideAgents
  if (rule === 'off') return { act: 'blocked', why: isOwner ? 'You turned outside agents off on this slate. Turn them on again under More agents.' : 'This slate\'s owner turned outside agents off here.' }
  if (rule === 'owner' && !isOwner) return { act: 'blocked', why: 'Only this slate\'s owner can bring outside agents here.' }
  if (integration?.status === 'paused') return { act: 'review', why: `${name}'s tools changed since you connected it. Look at them once on the Integrations page, then add it.` }
  if (integration?.status === 'needs_sign_in') return { act: 'sign-in', why: `${name} needs you to sign in again on the Integrations page.` }
  if (integration?.status === 'pro_ended') return { act: 'pro', why: 'Adding agents to slates is part of Slatebox Pro and Slatebox Business.' }
  if (integration?.status && integration.status !== 'active') return { act: 'review', why: `${name} can't be added right now. Open the Integrations page to see why.` }
  return { act: 'add', why: '' }
}
