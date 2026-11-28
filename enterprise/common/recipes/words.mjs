// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The words people read about recipes: states, triggers, permissions, refusals. Sentence case,
// US spelling, "agent" rather than "AI". Browser-safe; the server's refusals use the same lines.

export const STATE_WORDS = Object.freeze({
  draft: 'Not turned on yet',
  active: 'On',
  paused: 'Paused',
  needs_sign_in: 'Needs you to sign in again',
  blocked_access: 'Stopped: the owner lost access',
  blocked_limit: 'Stopped: over its limits',
  failed: 'Stopped after failing',
})

export const RUN_STATE_WORDS = Object.freeze({
  queued: 'Waiting to run',
  running: 'Running',
  done: 'Done',
  partial: 'Done in part',
  failed: 'Failed',
  skipped: 'Skipped',
  cancelled: 'Cancelled',
})

export const SKIP_WORDS = Object.freeze({
  paused: 'Recipes are paused here.',
  kill_switch: 'Recipes are turned off on this server or team.',
  no_change: 'Nothing changed since the last run.',
  debounced: 'Folded into a later run.',
  budget: 'Over its run limit for today.',
  blocked_access: 'The owner no longer has access to this project.',
  slate_changed: 'Someone was editing; it tries again on the next run.',
  hook_failed: 'A webhook it waits on did not answer.',
})

export const TRIGGER_WORDS = Object.freeze({
  vendor: 'When something changes',
  schedule: 'On a schedule',
  manual: 'When you run it',
  inbound: 'When a webhook calls it',
})

export const WRITE_WORDS = Object.freeze({
  'github.check_run': 'Add a check to pushes',
  'github.pr_comment': 'Comment on pull requests',
  'github.pull_request': 'Open pull requests on slatebox/ branches',
  'slack.post': 'Post in Slack channels',
  'google.write_sheet': 'Write to Google Sheets',
})

export const PAUSE_REASON_WORDS = Object.freeze({
  person: 'Paused by a person',
  failures: 'Paused after 3 failed runs in a row',
  sign_in: 'Paused: sign in again to the integration',
  access: 'Paused: the owner lost access',
  permissions_changed: 'Paused: the integration\'s permissions changed',
  grant_revoked: 'Paused: a permission it used was taken back',
  uninstalled: 'Paused: the app was removed from the integration',
})

export const RECIPES_OFF = 'An admin turns recipes on in Admin › Recipes.'
export const RECIPES_OFF_TEAM = 'A team admin turned recipes off for this team.'

/** "GitHub architect · runs for Ana" */
export const runsFor = (agentName, firstName) => (firstName ? `${agentName} · runs for ${firstName}` : agentName)

/** "2 min ago · 3 notes changed" */
export function lastRunLine(run, now = Date.now()) {
  if (!run?.at) return 'Not run yet'
  const minutes = Math.max(0, Math.round((now - new Date(run.at).getTime()) / 60000))
  const when = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`
  const n = run.changed ?? 0
  return `${when} · ${n} note${n === 1 ? '' : 's'} changed`
}
