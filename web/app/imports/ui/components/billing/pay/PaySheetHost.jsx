import React, { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useSearchParams } from 'react-router-dom'
import CONSTANTS from '../../../../api/common/constants'
import { allowance, globalMessage } from '../../../jotai/atoms'
import { POLL_DELAYS_MS, initialSheet, sheetReducer } from './sheet-machine.mjs'
import { PAY_PARAMS, payRequestFromQuery } from './pay-url.mjs'
import { newAttempt, payUi } from './pay-env'
import { BILLING_CONTACT_URL } from '../../../../api/common/contact.mjs'

// The one pay sheet (design §2): mounted once at the app root (App.jsx), it renders nothing until a
// surface opens it with usePaySheet().open({ action, wallet, reason, retry, from }). The sheet and
// the payment SDK are loaded on the first open only, so pages where nobody pays never fetch them.
// It also reads ?pay= (open a pane) and ?pro= / ?topup= / ?card= (the return from a payment that
// left the page), and confirms a payment with the server, also after the sheet is closed.

export const paySheetAtom = atom(initialSheet)
const dispatchAtom = atom(null, (get, set, event) => set(paySheetAtom, sheetReducer(get(paySheetAtom), event)))

const PaySheet = lazy(() => import('./PaySheet'))
let prefetch = null
/** Loads the sheet ahead of a click (a pay button's pointerenter). */
export const prefetchPaySheet = () => { prefetch ||= import('./PaySheet'); return prefetch }

// The retry of the surface that opened the sheet: one at a time, dropped when that surface unmounts.
const pending = { retry: null, owner: null }


const defaultChoice = (action, summary) => {
  if (action === 'pro') return { interval: 'month' }
  if (action === 'topup') return { amountCents: (summary?.topUpAmounts || [1000])[0] }
  return null
}

/** Opens the pay sheet from any surface. Never named after a plan: it opens a pane for an action. */
export function usePaySheet() {
  const dispatch = useSetAtom(dispatchAtom)
  const summary = useAtomValue(allowance)
  const owner = useRef({})
  useEffect(() => () => {
    if (pending.owner === owner.current) { pending.retry = null; pending.owner = null }
  }, [])
  const open = useCallback(({ action, wallet = null, reason = '', retry = null, from = 'profile', choice = null } = {}) => {
    pending.retry = typeof retry === 'function' ? retry : null
    pending.owner = pending.retry ? owner.current : null
    prefetchPaySheet()
    dispatch({ type: 'open', request: { action, wallet: action === 'topup' ? wallet || 'me' : null, reason, from }, attemptId: newAttempt(), choice: choice || defaultChoice(action, summary), inApp: payUi().inApp })
  }, [dispatch, summary])
  return { open, prefetch: prefetchPaySheet }
}

// One question to the server: is the payment on the account yet? → { done, detail } | { refunded, amountCents } | { pending }
async function askServer(paid) {
  if (paid.kind === 'topup') {
    const result = await Meteor.callAsync(CONSTANTS.methods.wallet.confirmTopUp, { sessionId: paid.sessionId })
    if (result.status === 'paid') return { done: true, detail: { amountCents: result.amountCents, balanceCents: result.balanceCents } }
    if (result.status === 'refunded') return { refunded: true, amountCents: result.amountCents }
    return { pending: true }
  }
  if (paid.kind === 'card') {
    const result = await Meteor.callAsync(CONSTANTS.methods.pro.cardConfirm, { sessionId: paid.sessionId })
    if (result.status === 'updated') return { done: true, detail: { pastDueCleared: Boolean(result.paidInvoice) } }
    // the card is saved; the past-due payment on it waits for the bank, or was declined
    if (result.status === 'needs-action') return { needsAction: true }
    if (result.status === 'declined') return { cardDeclined: true, message: result.message }
    return { pending: true }
  }
  const result = await Meteor.callAsync(CONSTANTS.methods.pro.confirm, { sessionId: paid.sessionId })
  // claim: what a guest's email did after paying (server/pro-claim.mjs), for the Welcome's next step
  return result.status === 'active' ? { done: true, detail: result.claim ? { claim: result.claim } : null } : { pending: true }
}

const DONE_TOAST = { pro: 'Slatebox Pro is on.', topup: 'Your balance is topped up.', card: 'Your card is updated.' }

export default function PaySheetHost({ children }) {
  const [state, setState] = useAtom(paySheetAtom)
  const dispatch = useSetAtom(dispatchAtom)
  const setAllowance = useSetAtom(allowance)
  const setMessage = useSetAtom(globalMessage)
  const [query, setQuery] = useSearchParams()
  const userId = useTracker(() => Meteor.userId(), [])
  // who is here, once their account's own fields (isAnonymous) have loaded
  const account = useTracker(() => {
    if (!Meteor.userId() || !Meteor.subscribe(CONSTANTS.publications.users.me).ready()) return null
    return Meteor.user()?.isAnonymous ? 'guest' : 'member'
  }, [])
  const opened = useRef(false)
  if (state.stage !== 'closed') opened.current = true
  const closedRef = useRef(true)
  closedRef.current = state.stage === 'closed'

  // ?pay= / ?pro= / ?topup= / ?card=: open once, then take the params out of the address
  useEffect(() => {
    if (!userId || !account) return
    const asked = payRequestFromQuery(query)
    if (!asked) return
    // A guest (an exec or MCP &pay= link opened signed out) saves their account or signs in first:
    // the link stays in the address, and the pane opens once they are a member (design §4.1).
    // Pro is the exception: a guest pays it at once and gives their email in the sheet (/pro, pro-claim.mjs).
    if (account === 'guest' && asked.open && asked.open.action !== 'pro') return
    const next = new URLSearchParams(query)
    PAY_PARAMS.forEach(p => next.delete(p))
    setQuery(next, { replace: true })
    prefetchPaySheet()
    if (asked.back) dispatch({ type: 'return', ...asked.back })
    else dispatch({ type: 'open', request: { action: asked.open.action, wallet: asked.open.wallet, from: asked.open.from, reason: '' }, attemptId: newAttempt(), choice: asked.open.choice || defaultChoice(asked.open.action, null), inApp: payUi().inApp })
  }, [query, userId, account])

  // the summary the sheet reads (credits, amounts, balances): fetched when it opens if nobody has
  useEffect(() => {
    if (state.stage === 'closed' || !userId) return
    Meteor.callAsync(CONSTANTS.methods.meter.summary).then(s => { if (s) setAllowance(s) }).catch(() => {})
  }, [state.stage === 'closed', userId])

  // Paid: ask the server until it has the payment (1 s, then 2 s, for 15 s; then quietly every 5 s
  // for two minutes), then refresh meter.summary so every open surface updates, and only then confirm.
  const paidId = state.paid?.sessionId
  const waiting = Boolean(state.paid && !state.confirmed && state.variant !== 'processing' && !state.blocked)
  useEffect(() => {
    if (!waiting || !paidId) return undefined
    let stop = false
    let timer = null
    const { paid } = state
    const delays = [...POLL_DELAYS_MS, ...Array(24).fill(5000)]
    const settle = async answer => {
      if (answer.refunded) return dispatch({ type: 'refunded', amountCents: answer.amountCents })
      if (answer.needsAction || answer.cardDeclined) {
        const fresh = await Meteor.callAsync(CONSTANTS.methods.meter.summary).catch(() => null)
        if (fresh) setAllowance(fresh)
        if (stop) return null
        if (answer.needsAction) dispatch({ type: 'needs-action', kind: 'card' })
        else dispatch({ type: 'card-declined', message: answer.message, attemptId: newAttempt() })
        // closed meanwhile: said quietly, and Your Pro has the rest
        if (closedRef.current) setMessage({ visible: true, severity: 'warning', text: answer.needsAction ? 'Your bank wants you to confirm the Pro payment. Open Your Pro to finish.' : `${answer.message || 'Your card was declined.'} Open Your Pro to try another card.` })
        return null
      }
      const summary = await Meteor.callAsync(CONSTANTS.methods.meter.summary).catch(() => null)
      if (summary) setAllowance(summary)
      return stop || dispatch({ type: 'summary', detail: answer.detail })
    }
    const ask = async i => {
      if (stop || i >= delays.length) return
      let answer = { pending: true }
      try {
        answer = await askServer(paid)
      } catch (err) {
        if (err?.error !== 'too-many-requests') {
          if (!stop) dispatch({ type: 'failed', reason: err?.reason || `We could not confirm this payment. If your card was charged, write to us at ${BILLING_CONTACT_URL}.` })
          return
        }
      }
      if (stop) return
      if (!answer.pending) { settle(answer); return }
      // 15 s and not yet: the pending Welcome; the questions go on quietly
      if (i === POLL_DELAYS_MS.length - 1) dispatch({ type: 'timeout' })
      timer = setTimeout(() => ask(i + 1), delays[i + 1] ?? 0)
    }
    timer = setTimeout(() => ask(0), delays[0])
    return () => { stop = true; clearTimeout(timer) }
  }, [waiting, paidId])

  // confirmed after the sheet was closed: say so quietly
  const closedEarly = state.stage === 'closed' && state.paid && state.late
  useEffect(() => {
    if (closedEarly) setMessage({ visible: true, severity: 'success', text: DONE_TOAST[state.paid.kind] || 'Done.' })
  }, [closedEarly])

  // the surface's retry: once, after close, and only when the server has the payment
  useEffect(() => {
    if (state.retry !== 'now') return
    const { retry } = pending
    pending.retry = null
    pending.owner = null
    dispatch({ type: 'retried' })
    if (retry) {
      try { retry() } catch (err) { console.error('pay sheet retry failed', err) } // eslint-disable-line no-console
    }
  }, [state.retry])

  return (
    <>
      {children}
      {opened.current && (
        <Suspense fallback={null}>
          <PaySheet state={state} dispatch={dispatch} reset={() => setState(initialSheet)} />
        </Suspense>
      )}
    </>
  )
}

PaySheetHost.propTypes = { children: PropTypes.node }
PaySheetHost.defaultProps = { children: null }
