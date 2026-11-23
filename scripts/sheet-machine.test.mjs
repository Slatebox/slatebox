import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STAGES, POLL_DELAYS_MS, initialSheet, sheetReducer, canClose, confirmOutcome,
} from '../web/app/imports/ui/components/billing/pay/sheet-machine.mjs'

// The pay sheet's states (design §6, test 7). Pure: the sheet dispatches what Stripe and the
// server answered, and the reducer decides what the person sees next.
const A1 = '0b6a3b9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const A2 = '1c7b4c0f-2d3e-4f60-9b0c-1d2e3f4a5b6c'
const A3 = '2d8c5d10-3e4f-4071-8c1d-2e3f4a5b6c7d'
const run = (events, from = initialSheet) => events.reduce(sheetReducer, from)

const openPro = { type: 'open', request: { action: 'pro', from: 'draft' }, attemptId: A1, choice: { interval: 'month' }, inApp: true }
const session = { type: 'session', attemptId: A1, ui: 'elements', clientSecret: 'cs_test_1_secret_x', sessionId: 'cs_test_1' }
const ready = () => run([openPro, session])
const paid = { type: 'confirmed', result: { type: 'success', session: { id: 'cs_test_1', status: { type: 'complete', paymentStatus: 'paid' } } } }

test('the stages are the design\'s', () => {
  for (const stage of ['closed', 'preparing', 'blocked', 'ready', 'confirming', 'finalizing', 'welcome']) assert.ok(STAGES.includes(stage), stage)
  assert.equal(initialSheet.stage, 'closed')
})

test('open → preparing → ready; an answer for an older attempt is dropped', () => {
  const s1 = sheetReducer(initialSheet, openPro)
  assert.equal(s1.stage, 'preparing')
  assert.equal(s1.attemptId, A1)
  assert.equal(sheetReducer(s1, { ...session, attemptId: A2 }).stage, 'preparing')
  const s2 = sheetReducer(s1, session)
  assert.equal(s2.stage, 'ready')
  assert.equal(s2.session.clientSecret, 'cs_test_1_secret_x')
})

test('a decline goes back to ready with the form kept and the processor\'s own words first', () => {
  const before = ready()
  const paying = sheetReducer(before, { type: 'pay' })
  assert.equal(paying.stage, 'confirming')
  const declined = sheetReducer(paying, { type: 'confirmed', wallets: true, result: { type: 'error', error: { code: 'paymentFailed', message: 'Your card has insufficient funds.', paymentFailed: { declineCode: 'insufficient_funds' } } } })
  assert.equal(declined.stage, 'ready')
  // the same session: the Payment Element is not remounted, so what was typed stays
  assert.equal(declined.session, before.session)
  assert.equal(declined.error.kind, 'declined')
  assert.equal(declined.error.message, 'Your card has insufficient funds. Nothing was charged. Try another card, or pay with a wallet above.')
  // with no message of its own, our sentence
  const bare = sheetReducer(paying, { type: 'confirmed', wallets: true, result: { type: 'error', error: { code: 'paymentFailed', message: '' } } })
  assert.equal(bare.error.message, 'Your card was declined. Nothing was charged. Try another card, or pay with a wallet above.')
  // paying again clears the error
  assert.equal(sheetReducer(declined, { type: 'pay' }).error, null)
})

test('a decline mentions wallets only when the wallet buttons were shown', () => {
  const paying = sheetReducer(ready(), { type: 'pay' })
  const result = { type: 'error', error: { code: 'paymentFailed', message: 'Your card was declined.' } }
  // no wallet found (or the event does not say): the card only
  for (const event of [{ type: 'confirmed', result }, { type: 'confirmed', wallets: false, result }]) {
    const out = sheetReducer(paying, event)
    assert.equal(out.error.message, 'Your card was declined. Nothing was charged. Try another card.')
    assert.doesNotMatch(out.error.message, /wallet/i)
  }
  assert.doesNotMatch(confirmOutcome(result).message, /wallet/i)
  assert.match(confirmOutcome(result, { wallets: true }).message, /pay with a wallet above/)
})

test('a thrown error gives the generic message and keeps the form', () => {
  const s = run([{ type: 'pay' }, { type: 'threw' }], ready())
  assert.equal(s.stage, 'ready')
  assert.equal(s.error.kind, 'generic')
  assert.equal(s.error.message, 'Something went wrong. Nothing was charged.')
  assert.ok(s.session)
})

test('tax that cannot be worked out is its own message', () => {
  const s = run([{ type: 'pay' }, { type: 'confirmed', result: { type: 'error', error: { code: null, message: 'failed_tax_calculation: could not calculate tax' } } }], ready())
  assert.equal(s.stage, 'ready')
  assert.equal(s.error.kind, 'tax')
  assert.match(s.error.message, /^We couldn.t work out tax for that address/)
})

test('an expired session is made again once, silently; a second expiry is shown', () => {
  const s1 = run([{ type: 'pay' }, { type: 'expired', attemptId: A2 }], ready())
  assert.equal(s1.stage, 'preparing')
  assert.equal(s1.attemptId, A2)
  assert.equal(s1.error, null)
  assert.equal(s1.session, null)
  const s2 = run([{ ...session, attemptId: A2 }, { type: 'expired', attemptId: A3 }], s1)
  assert.equal(s2.stage, 'ready')
  assert.equal(s2.error.kind, 'expired')
  // a confirm error that says the session expired counts the same
  assert.equal(confirmOutcome({ type: 'error', error: { code: null, message: 'This Checkout Session has expired.' } }).kind, 'expired')
})

test('a confirm that reports the session expired prepares a new session under a new attempt', () => {
  // the old attempt's idempotency key cannot make the new session (Stripe: same key, other params)
  const expiredResult = { type: 'error', error: { code: null, message: 'This Checkout Session has expired.' } }
  const s1 = run([{ type: 'pay' }, { type: 'confirmed', result: expiredResult, nextAttemptId: A2 }], ready())
  assert.equal(s1.stage, 'preparing')
  assert.equal(s1.attemptId, A2)
  assert.notEqual(s1.attemptId, A1)
  assert.equal(s1.session, null)
  assert.equal(s1.error, null)
  // the success-shaped expiry counts the same
  const viaStatus = { type: 'success', session: { id: 'cs_test_1', status: { type: 'expired' } } }
  assert.equal(run([{ type: 'pay' }, { type: 'confirmed', result: viaStatus, nextAttemptId: A3 }], ready()).attemptId, A3)
  // the answer for the old attempt is dropped; the new attempt's session is shown
  assert.equal(sheetReducer(s1, session).stage, 'preparing')
  assert.equal(sheetReducer(s1, { ...session, attemptId: A2 }).stage, 'ready')
  // a second expiry is shown, not renewed again
  const s2 = run([{ ...session, attemptId: A2 }, { type: 'pay' }, { type: 'confirmed', result: expiredResult, nextAttemptId: A3 }], s1)
  assert.equal(s2.stage, 'ready')
  assert.equal(s2.error.kind, 'expired')
  // with no new attempt (or the same one) the old key is never reused: the expiry is shown
  for (const nextAttemptId of [undefined, A1]) {
    const s = run([{ type: 'pay' }, { type: 'confirmed', result: expiredResult, nextAttemptId }], ready())
    assert.equal(s.stage, 'ready')
    assert.equal(s.attemptId, A1)
    assert.equal(s.error.kind, 'expired')
  }
})

test('success goes to finalizing, and to welcome only after the summary confirms', () => {
  const s1 = run([{ type: 'pay' }, paid], ready())
  assert.equal(s1.stage, 'finalizing')
  assert.deepEqual(s1.paid, { kind: 'pro', sessionId: 'cs_test_1' })
  assert.equal(s1.confirmed, false)
  // the Welcome is drawn while finalizing, but nothing says Pro is on yet
  const s2 = sheetReducer(s1, { type: 'summary' })
  assert.equal(s2.stage, 'welcome')
  assert.equal(s2.confirmed, true)
  assert.equal(s2.variant, 'done')
  // a success that has not been paid (an async method) is the processing variant, never a celebration
  const unpaid = run([{ type: 'pay' }, { type: 'confirmed', result: { type: 'success', session: { id: 'cs_test_1', status: { type: 'complete', paymentStatus: 'unpaid' } } } }], ready())
  assert.equal(unpaid.stage, 'welcome')
  assert.equal(unpaid.variant, 'processing')
  assert.equal(unpaid.confirmed, false)
  // no_payment_required celebrates like paid
  assert.equal(run([{ type: 'pay' }, { type: 'confirmed', result: { type: 'success', session: { id: 'cs_test_1', status: { type: 'complete', paymentStatus: 'no_payment_required' } } } }], ready()).stage, 'finalizing')
})

test('the server is asked about 1 s, then 2 s apart, for 15 s', () => {
  assert.equal(POLL_DELAYS_MS.reduce((a, b) => a + b, 0), 15_000)
  assert.equal(POLL_DELAYS_MS[0], 1000)
  assert.equal(POLL_DELAYS_MS.at(-1), 2000)
  assert.ok(POLL_DELAYS_MS.every((d, i) => i === 0 || d >= POLL_DELAYS_MS[i - 1]))
})

test('a timeout gives the pending welcome and never a retry', () => {
  const s1 = run([{ type: 'pay' }, paid, { type: 'timeout' }], ready())
  assert.equal(s1.stage, 'welcome')
  assert.equal(s1.variant, 'pending')
  assert.equal(s1.noRetry, true)
  // the background answer still lands, still without a retry
  const s2 = run([{ type: 'summary' }, { type: 'close' }], s1)
  assert.equal(s2.stage, 'closed')
  assert.equal(s2.retry, null)
})

test('close is refused while confirming; closing the welcome (any way) asks for the retry once', () => {
  const confirming = run([{ type: 'pay' }], ready())
  assert.equal(canClose(confirming), false)
  assert.equal(sheetReducer(confirming, { type: 'close' }), confirming)
  for (const stage of [ready(), sheetReducer(initialSheet, openPro)]) assert.equal(canClose(stage), true)

  const welcome = run([{ type: 'pay' }, paid, { type: 'summary' }], ready())
  const closed = sheetReducer(welcome, { type: 'close' })
  assert.equal(closed.stage, 'closed')
  assert.equal(closed.retry, 'now')
  assert.equal(sheetReducer(closed, { type: 'retried' }).retry, null)

  // closed while finalizing: the retry waits for the server, then runs
  const early = run([{ type: 'pay' }, paid, { type: 'close' }], ready())
  assert.equal(early.stage, 'closed')
  assert.equal(early.retry, 'when-confirmed')
  assert.ok(early.paid, 'the payment is still being confirmed in the background')
  const late = sheetReducer(early, { type: 'summary' })
  assert.equal(late.stage, 'closed')
  assert.equal(late.retry, 'now')

  // closing before paying: no retry
  assert.equal(sheetReducer(ready(), { type: 'close' }).retry, null)
})

test('a changed amount or interval prepares a new attempt; never while confirming', () => {
  const s = sheetReducer(ready(), { type: 'change', choice: { interval: 'year' }, attemptId: A2 })
  assert.equal(s.stage, 'preparing')
  assert.equal(s.attemptId, A2)
  assert.deepEqual(s.choice, { interval: 'year' })
  const confirming = run([{ type: 'pay' }], ready())
  assert.equal(sheetReducer(confirming, { type: 'change', choice: { interval: 'year' }, attemptId: A2 }), confirming)
})

test('a refusal while preparing blocks with the server\'s reason', () => {
  const s = run([openPro, { type: 'refused', attemptId: A1, code: 'unverified', reason: 'Confirm your email address first.' }])
  assert.equal(s.stage, 'blocked')
  assert.deepEqual(s.blocked, { kind: 'refused', code: 'unverified', reason: 'Confirm your email address first.' })
  assert.equal(canClose(s), true)
})

test('with in-app payments off the sheet still opens; Pay leaves for the hosted page', () => {
  const s1 = sheetReducer(initialSheet, { ...openPro, inApp: false })
  assert.equal(s1.stage, 'ready')
  assert.equal(s1.hosted, true)
  const s2 = sheetReducer(s1, { type: 'pay' })
  assert.equal(s2.stage, 'confirming')
  assert.equal(canClose(s2), false)
  // the redirect could not be started: back to ready with the reason
  const s3 = sheetReducer(s2, { type: 'refused', attemptId: A1, code: 'amount', reason: 'Choose one of the amounts shown.' })
  assert.equal(s3.stage, 'ready')
  assert.equal(s3.error.message, 'Choose one of the amounts shown.')
})

test('actions that are not a payment open the blocked pane; Manage needs no session', () => {
  for (const action of ['verify', 'help', 'own-key', 'sign-in']) {
    const s = sheetReducer(initialSheet, { type: 'open', request: { action }, attemptId: A1, inApp: true })
    assert.equal(s.stage, 'blocked', action)
    assert.equal(s.blocked.kind, action)
  }
  assert.equal(sheetReducer(initialSheet, { type: 'open', request: { action: 'manage' }, attemptId: A1, inApp: true }).stage, 'ready')
})

test('a redirect return opens straight into finalizing', () => {
  const s = sheetReducer(initialSheet, { type: 'return', kind: 'topup', sessionId: 'cs_test_9' })
  assert.equal(s.stage, 'finalizing')
  assert.deepEqual(s.paid, { kind: 'topup', sessionId: 'cs_test_9' })
  assert.equal(s.request.action, 'topup')
  assert.equal(s.request.from, 'profile')
})

test('a top-up refunded for going past the limits is said plainly, not celebrated', () => {
  const s = run([{ type: 'refunded', amountCents: 2500 }], sheetReducer(initialSheet, { type: 'return', kind: 'topup', sessionId: 'cs_test_9' }))
  assert.equal(s.stage, 'blocked')
  assert.equal(s.blocked.kind, 'refunded')
  assert.match(s.blocked.reason, /\$25\.00/)
})

test('opening again while confirming does not drop the payment', () => {
  const confirming = run([{ type: 'pay' }], ready())
  assert.equal(sheetReducer(confirming, { ...openPro, attemptId: A2 }), confirming)
})

test('confirmed after the sheet was closed is marked late (a quiet note), and a failure stops the questions', () => {
  const closed = run([{ type: 'pay' }, paid, { type: 'close' }, { type: 'summary' }], ready())
  assert.equal(closed.late, true)
  const open = run([{ type: 'pay' }, paid, { type: 'summary' }], ready())
  assert.equal(open.late, false)
  const failed = run([{ type: 'pay' }, paid, { type: 'failed', reason: 'This payment is not yours.' }], ready())
  assert.equal(failed.stage, 'blocked')
  assert.equal(failed.blocked.reason, 'This payment is not yours.')
  assert.equal(failed.paid, null)
  assert.equal(sheetReducer(failed, { type: 'close' }).retry, null)
})

test('what the server confirmed travels with the summary (the top-up figure for the Welcome)', () => {
  const s = run([{ type: 'summary', detail: { amountCents: 2500 } }], sheetReducer(initialSheet, { type: 'return', kind: 'topup', sessionId: 'cs_test_9' }))
  assert.equal(s.stage, 'welcome')
  assert.equal(s.detail.amountCents, 2500)
})

// ---------- Manage (lane D) ----------

const openManage = { type: 'open', request: { action: 'manage', from: 'profile' }, attemptId: A1, inApp: true }

test('a Manage action locks the sheet while it runs, then shows its notice or its error in the pane', () => {
  const manage = sheetReducer(initialSheet, openManage)
  assert.equal(manage.stage, 'ready')
  const running = sheetReducer(manage, { type: 'manage-run', job: 'stop' })
  assert.equal(running.stage, 'confirming')
  assert.equal(running.job, 'stop')
  assert.equal(canClose(running), false)
  // a second action while one runs is ignored
  assert.equal(sheetReducer(running, { type: 'manage-run', job: 'keep' }).job, 'stop')
  const noticed = sheetReducer(running, { type: 'manage-notice', text: 'Pro stays on until December 22, 2026, then ends.' })
  assert.equal(noticed.stage, 'ready')
  assert.equal(noticed.job, null)
  assert.equal(noticed.notice, 'Pro stays on until December 22, 2026, then ends.')
  assert.equal(noticed.error, null)
  const failed = sheetReducer(sheetReducer(noticed, { type: 'manage-run', job: 'keep' }), { type: 'manage-error', message: 'Wait a moment.' })
  assert.equal(failed.stage, 'ready')
  assert.deepEqual(failed.error, { kind: 'manage', message: 'Wait a moment.' })
  assert.equal(failed.notice, null)
  // Manage actions only run from Manage
  assert.equal(sheetReducer(ready(), { type: 'manage-run', job: 'stop' }).stage, 'ready')
})

test('a switch or a bank confirmation that went through gets its check-only Welcome, already confirmed', () => {
  const running = run([openManage, { type: 'manage-run', job: 'to-year' }])
  const done = sheetReducer(running, { type: 'manage-done', kind: 'switch', detail: { interval: 'year', nextDate: '2027-11-22T12:00:00.000Z' } })
  assert.equal(done.stage, 'welcome')
  assert.equal(done.confirmed, true)
  assert.equal(done.variant, 'done')
  assert.equal(done.paid.kind, 'switch')
  assert.deepEqual(done.detail, { interval: 'year', nextDate: '2027-11-22T12:00:00.000Z' })
  assert.equal(done.job, null)
  // needs the bank: stays confirming (the bank's own window is up)
  const bank = sheetReducer(running, { type: 'manage-bank' })
  assert.equal(bank.stage, 'confirming')
  assert.equal(bank.job, 'bank')
  // only a running action finishes
  assert.equal(sheetReducer(sheetReducer(initialSheet, openManage), { type: 'manage-done', kind: 'switch' }).stage, 'ready')
})

test('a saved card whose past-due payment needs the bank opens Your Pro with the confirmation waiting', () => {
  const card = run([
    { type: 'open', request: { action: 'card', from: 'profile' }, attemptId: A1, inApp: true },
    { type: 'session', attemptId: A1, ui: 'elements', clientSecret: 'cs_card_secret', sessionId: 'cs_card' },
    { type: 'pay' },
    { type: 'confirmed', result: { type: 'success', session: { id: 'cs_card', status: { type: 'complete', paymentStatus: 'no_payment_required' } } } },
  ])
  assert.equal(card.stage, 'finalizing')
  const waiting = sheetReducer(card, { type: 'needs-action', kind: 'card' })
  assert.equal(waiting.stage, 'ready')
  assert.equal(waiting.request.action, 'manage')
  assert.equal(waiting.bank, 'card')
  assert.equal(waiting.paid, null)
  // closed meanwhile: nothing opens by itself
  const closed = sheetReducer({ ...initialSheet, paid: { kind: 'card', sessionId: 'cs_card' } }, { type: 'needs-action', kind: 'card' })
  assert.equal(closed.stage, 'closed')
  assert.equal(closed.paid, null)
})

test('a saved card whose past-due payment is declined goes back to the card pane, with the reason kept through the new session', () => {
  const finalizing = { ...initialSheet, stage: 'finalizing', request: { action: 'card', from: 'profile', wallet: null, reason: '' }, attemptId: A1, paid: { kind: 'card', sessionId: 'cs_card' } }
  const back = sheetReducer(finalizing, { type: 'card-declined', message: 'Your card has insufficient funds.', attemptId: A2 })
  assert.equal(back.stage, 'preparing')
  assert.equal(back.request.action, 'card')
  assert.equal(back.attemptId, A2)
  assert.equal(back.paid, null)
  assert.equal(back.error.kind, 'declined')
  assert.equal(back.error.message, 'Your card has insufficient funds. The card is saved, but the payment did not go through. Try another card.')
  const fresh = sheetReducer(back, { type: 'session', attemptId: A2, ui: 'elements', clientSecret: 'cs_2_secret', sessionId: 'cs_2' })
  assert.equal(fresh.stage, 'ready')
  assert.equal(fresh.error.message, back.error.message, 'the reason survives the new session')
  // paying again clears it
  assert.equal(sheetReducer(fresh, { type: 'pay' }).error, null)
  // with no words of its own
  assert.match(sheetReducer(finalizing, { type: 'card-declined', attemptId: A3 }).error.message, /^Your card was declined\. The card is saved/)
})
