// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The pieces of a Slack recipe's setup that every Slack recipe shares: which channels (by id, picked
// from the channels the owner is in), the owner's time zone, and the needs and triggers of the ledger.

export const CHANNEL_ID = '^[CG][A-Z0-9]{6,24}$'
export const channelsSchema = Object.freeze({ type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', pattern: CHANNEL_ID }, description: 'The channels to read (you must be in each).', 'x-picker': 'slack.channel' })
// The owner's connected workspace (filled in by setup, not typed): Slack events find the recipe by it.
export const teamIdSchema = Object.freeze({ type: 'string', pattern: '^[TE][A-Z0-9]{2,24}$', description: 'The Slack workspace (from your connection).', 'x-picker': 'slack.workspace' })
export const tzSchema = Object.freeze({ type: 'string', minLength: 1, maxLength: 64, description: 'Time zone for dates and schedules, e.g. America/Chicago.', 'x-picker': 'timezone' })

// Read scopes only: the history of the channels the person is in, their names, and people's names.
export const SLACK_READ_NEEDS = Object.freeze(['channels:history', 'groups:history', 'channels:read', 'groups:read', 'search:read', 'users:read'])

// New messages are folded at most every 30 minutes while a channel is active.
export const FOLD_TRIGGER = Object.freeze({ kind: 'vendor', event: 'slack.message', debounceMs: 30 * 60000, default: true })

/** A channel's label for a slate name: "#proj-checkout". */
export const channelLabel = (channel) => '#' + String(channel?.name || channel?.id || 'channel').replace(/^#/, '')
