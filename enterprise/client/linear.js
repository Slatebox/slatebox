// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Connecting Linear for recipes is one click: the window opens inside the click, the server makes
// the sign-in flow (linear.connect), this page claims it and sends the window to Linear's own page
// (signin.js followSignIn), and Authorize there finishes it.
import { Meteor } from 'meteor/meteor'
import { followSignIn, openSignInWindow } from './signin'

/**
 * Must be called inside the click. onPending(cancel) is told once the window is on its way.
 * → { ok: true } | { ok: false, code, message }
 */
export async function connectLinear({ onPending = () => {} } = {}) {
  const win = openSignInWindow()
  try {
    const started = await Meteor.callAsync('linear.connect', {})
    const follow = followSignIn(win, started)
    onPending(follow.cancel)
    const outcome = await follow.promise
    try { if (win && !win.closed) win.close() } catch {}
    return outcome
  } catch (error) {
    try { win?.close() } catch {}
    throw error
  }
}
