// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The sign-in popup, from the walkthrough. The window is opened at once on the click (so the
// browser allows it). Once the server has made the flow, this page (signed in) claims it at
// Slatebox's start route with its login token, which ties the flow to this browser and answers the
// server's sign-in address; the window is cut off from this page (opener = null) and sent there.
// The callback page tells us how it went over a BroadcastChannel (and localStorage, for browsers
// without one); we also ask the server every 1.5 s, and notice when the window is closed.
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'

export const CHANNEL = 'slatebox-agent-sign-in'

export const START_PATH = '/connectors/oauth/start'

/** Claims the flow as the signed-in person. → the server's sign-in address, or throws { code, message }. */
export async function claimFlow(flowId) {
  const response = await fetch(START_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'X-Slatebox-Login-Token': Accounts._storedLoginToken() || '' },
    body: JSON.stringify({ flow: flowId }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.authorizeUrl !== 'string') throw { code: body.error || 'failed', message: body.message || 'Sign-in didn\'t start. Try again.' }
  return body.authorizeUrl
}

const FAILURES = {
  blocked: 'Your browser blocked the sign-in window. Allow pop-ups for Slatebox, then sign in again.',
  closed: 'Sign-in was cancelled.',
  timeout: 'That sign-in took too long. Sign in again.',
}

/** Opens the window now (inside the click). → the window, or null when the browser blocked it. */
export function openSignInWindow() {
  const width = 520
  const height = 720
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
  const win = window.open('about:blank', 'slatebox-agent-sign-in', `popup,width=${width},height=${height},left=${left},top=${top}`)
  if (!win) return null
  try {
    win.document.title = 'Signing in…'
    win.document.body.style.font = '16px system-ui, sans-serif'
    win.document.body.textContent = 'Opening the sign-in page…'
  } catch {}
  return win
}

/**
 * Sends the window to Slatebox's start address and waits for the outcome.
 * → Promise<{ ok: true } | { ok: false, code, message }>; cancel() stops waiting.
 */
export function followSignIn(win, { flowId }, { timeoutMs = 10 * 60000 } = {}) {
  let cancel = () => {}
  const promise = new Promise((resolve) => {
    let done = false
    const timers = []
    let channel = null
    const finish = (outcome) => {
      if (done) return
      done = true
      timers.forEach(clearInterval)
      try { channel?.close() } catch {}
      window.removeEventListener('storage', onStorage)
      resolve(outcome)
    }
    cancel = () => finish({ ok: false, code: 'cancelled', message: FAILURES.closed })
    const onMessage = (data) => {
      if (!data || data.type !== 'agent-sign-in' || (data.flowId && data.flowId !== flowId)) return
      if (data.ok) finish({ ok: true })
      else if (data.flowId === flowId) check()
    }
    const onStorage = (event) => {
      if (event.key !== CHANNEL || !event.newValue) return
      try { onMessage(JSON.parse(event.newValue)) } catch {}
    }
    async function check() {
      try {
        const status = await Meteor.callAsync('connectors.signInStatus', { flowId })
        if (status.status === 'done') finish({ ok: true })
        else if (status.status === 'failed' || status.status === 'unknown') finish({ ok: false, code: status.code || 'failed', message: status.message })
        return status
      } catch {
        return null
      }
    }
    if (!win) return finish({ ok: false, code: 'blocked', message: FAILURES.blocked })
    claimFlow(flowId).then((authorizeUrl) => {
      if (done) return
      try {
        // From here on the outside page cannot reach this one.
        win.opener = null
        win.location.replace(authorizeUrl)
      } catch {
        finish({ ok: false, code: 'blocked', message: FAILURES.blocked })
      }
    }, (problem) => {
      try { win.close() } catch {}
      finish({ ok: false, code: problem?.code || 'failed', message: problem?.message || 'Sign-in didn\'t start. Try again.' })
    })
    try {
      channel = new BroadcastChannel(CHANNEL)
      channel.onmessage = (event) => onMessage(event.data)
    } catch {}
    window.addEventListener('storage', onStorage)
    timers.push(setInterval(check, 1500))
    timers.push(setInterval(async () => {
      if (!win.closed) return
      // Closed: one last look, then cancelled.
      const status = await check()
      if (!done && (!status || status.status === 'pending')) finish({ ok: false, code: 'closed', message: FAILURES.closed })
    }, 600))
    const started = Date.now()
    timers.push(setInterval(() => Date.now() - started > timeoutMs && finish({ ok: false, code: 'timeout', message: FAILURES.timeout }), 5000))
  })
  return { promise, cancel: () => cancel() }
}
