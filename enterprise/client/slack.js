// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Connecting Slack is one click (owner, 2026-11-27: Slack on its Web API): the window opens inside
// the click, the server makes the sign-in flow (slack.connect), this page claims it and sends the
// window to Slack's own page (signin.js followSignIn), and Allow there finishes it. Nothing else to
// choose: Slack's tools are fixed, and every change it proposes waits on a card you approve.
import { Meteor } from 'meteor/meteor'
import { followSignIn, openSignInWindow } from './signin'

// When a workspace lets only its admins approve apps, Slack sends the request to them and never
// comes back here: the window is closed or the sign-in runs out of time.
export const SLACK_ADMIN_NOTE = 'If Slack said your request went to a workspace admin, connect again once they approve Slatebox.'

/**
 * Must be called inside the click. onPending(cancel) is told once the window is on its way.
 * → { ok: true } | { ok: false, code, message }
 */
export async function connectSlack({ onPending = () => {} } = {}) {
  const win = openSignInWindow()
  try {
    const started = await Meteor.callAsync('slack.connect', {})
    const follow = followSignIn(win, started)
    onPending(follow.cancel)
    const outcome = await follow.promise
    try { if (win && !win.closed) win.close() } catch {}
    if (outcome.ok) return outcome
    const adminMaybe = ['closed', 'timeout', 'expired'].includes(outcome.code)
    return { ...outcome, message: [outcome.message || 'Sign-in didn\'t finish. Try again.', adminMaybe ? SLACK_ADMIN_NOTE : ''].filter(Boolean).join(' ') }
  } catch (error) {
    try { win?.close() } catch {}
    throw error
  }
}
