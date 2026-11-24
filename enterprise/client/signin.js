// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The sign-in popup, from the walkthrough. The window is opened at once on the click (so the
// browser allows it), pointed at Slatebox's own start address once the server has made the flow,
// and cut off from this page (opener = null) before it reaches the outside server's sign-in page.
// The callback page tells us how it went over a BroadcastChannel (and localStorage, for browsers
// without one); we also ask the server every 1.5 s, and notice when the window is closed.
import { Meteor } from 'meteor/meteor'

export const CHANNEL = 'slatebox-agent-sign-in'

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
export function followSignIn(win, { flowId, startUrl }, { timeoutMs = 10 * 60000 } = {}) {
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
    try {
      // From here on the outside page cannot reach this one.
      win.opener = null
      win.location.replace(startUrl)
    } catch {
      return finish({ ok: false, code: 'blocked', message: FAILURES.blocked })
    }
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
