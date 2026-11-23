import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import Box from '@mui/material/Box'
import Dialog from '@mui/material/Dialog'
import Drawer from '@mui/material/Drawer'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../../../api/common/constants'
import { allowance } from '../../../jotai/atoms'
import { canClose } from './sheet-machine.mjs'
import { sheetHeader, welcomeCopy } from './pay-copy.mjs'
import { makeSession, newAttempt, payUi } from './pay-env'
import { SheetHeader, visuallyHidden } from './SheetParts'
import ProPane from './ProPane'
import TopUpPane from './TopUpPane'
import CardPane from './CardPane'
import ManagePane from './ManagePane'
import BlockedPane from './BlockedPane'
import Welcome from './Welcome'

// The pay sheet (design §5, §6): a centred dialog on a wide screen, a bottom drawer on a phone, one
// pane at a time (Pro, Top-up, Card, Manage, blocked) and the Welcome after a payment, all driven by
// sheet-machine.mjs. Loaded on the first open (PaySheetHost.jsx).
//
// Focus: the processor's 3DS challenge and Link sign-in open as overlays on <body>, outside this
// dialog, so the dialog does not enforce focus (MUI would pull it back and nobody could type the
// code). Our own trap keeps Tab inside the sheet and only takes focus back from the app behind it.

const TITLE_ID = 'pay-sheet-title'
const LEAD_ID = 'pay-sheet-lead'
const PAYING = new Set(['preparing', 'ready', 'confirming'])
const WELCOMING = new Set(['finalizing', 'welcome'])
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'

export default function PaySheet({ state, dispatch }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [summary, setAllowance] = useAtom(allowance)
  const { publishableKey } = payUi()
  const paperRef = useRef(null)
  const [announcement, setAnnouncement] = useState('')
  const announce = useCallback(text => { setAnnouncement(''); setTimeout(() => setAnnouncement(text), 30) }, [])
  const open = state.stage !== 'closed'
  const closable = canClose(state)
  const close = () => { if (closable) dispatch({ type: 'close' }) }

  // a session for the chosen interval or amount (debounced: a quick change of mind makes one)
  useEffect(() => {
    if (state.stage !== 'preparing' || !state.request) return undefined
    const { action, wallet } = state.request
    const { attemptId, choice } = state
    let live = true
    const timer = setTimeout(async () => {
      try {
        const answer = await makeSession({ action, wallet, choice, attemptId, ui: 'elements' })
        if (live) dispatch({ type: 'session', attemptId, ...answer })
      } catch (err) {
        if (!live) return
        // Pro is already on (another tab, a ?pay=pro link): never a second purchase, show Your Pro
        if (err.error === 'pro-already') dispatch({ type: 'open', request: { action: 'manage', from: state.request.from }, attemptId: newAttempt(), inApp: true })
        else dispatch({ type: 'refused', attemptId, code: err.error ?? null, reason: err.reason || null })
      }
    }, 250)
    return () => { live = false; clearTimeout(timer) }
  }, [state.stage, state.attemptId])

  // the first Pro gets the burst; what the person held when they started paying decides it
  const firstPro = useRef(true)
  if (PAYING.has(state.stage)) firstPro.current = !summary?.proState

  const pay = {
    publishableKey,
    phone,
    announce,
    onPay: () => { dispatch({ type: 'pay' }); announce('Paying') },
    onResult: (result, seen) => dispatch({ type: 'confirmed', result, wallets: Boolean(seen?.wallets), nextAttemptId: newAttempt() }),
    onThrew: err => { console.error('pay sheet: confirm failed', err?.message) /* eslint-disable-line no-console */; dispatch({ type: 'threw' }) },
    onExpired: () => dispatch({ type: 'expired', attemptId: newAttempt() }),
    // in-app payments off: the same server method, ui 'hosted', then today's redirect
    onHostedPay: async () => {
      dispatch({ type: 'pay' })
      try {
        const url = state.session?.ui === 'hosted' && state.session.url
          ? state.session.url
          : (await makeSession({ ...state.request, choice: state.choice, attemptId: state.attemptId, ui: 'hosted' })).url
        window.location.assign(url)
      } catch (err) {
        dispatch({ type: 'refused', attemptId: state.attemptId, code: err.error ?? null, reason: err.reason || 'The payment page could not be opened. Try again.' })
      }
    },
  }
  const choose = choice => dispatch({ type: 'change', choice, attemptId: newAttempt() })
  // Your Pro: open another pane (Get Pro, the card), and read meter.summary again after a change
  const openPane = action => dispatch({ type: 'open', request: { action, from: action === 'card' ? 'manage' : 'profile' }, attemptId: newAttempt(), choice: action === 'pro' ? { interval: 'month' } : null, inApp: payUi().inApp })
  const refresh = async () => {
    const fresh = await Meteor.callAsync(CONSTANTS.methods.meter.summary).catch(() => null)
    if (fresh) setAllowance(fresh)
    return fresh || summary
  }

  // the Welcome's announcements: "Payment went through" while finalizing, then once when confirmed
  const copy = WELCOMING.has(state.stage) ? welcomeCopy({
    kind: state.paid?.kind || state.request?.action,
    from: state.request?.from,
    firstPro: firstPro.current,
    confirmed: state.confirmed,
    variant: state.variant === 'done' ? null : state.variant,
    amountCents: state.detail?.amountCents ?? state.choice?.amountCents ?? 0,
    pastDueCleared: state.detail?.pastDueCleared,
    interval: state.detail?.interval,
    nextDate: state.detail?.nextDate,
  }) : null
  useEffect(() => { if (copy?.announce) announce(copy.announce) }, [copy?.announce])

  // Pay pane → Welcome: the pay pane fades out over 160 ms on top, then the sheet's height moves to
  // the Welcome's over 240 ms (FLIP on the paper); none of it under reduced motion.
  // (the pay pane keeps its place in the tree while it fades, so its payment fields are not remade)
  const lastPay = useRef(null)
  const exit = useRef(null)
  const renderStage = useRef(state.stage)
  const [, redraw] = useState(0)
  if (renderStage.current !== state.stage) {
    exit.current = renderStage.current === 'confirming' && WELCOMING.has(state.stage) ? lastPay.current : null
    renderStage.current = state.stage
  }
  if (PAYING.has(state.stage) || state.stage === 'blocked') lastPay.current = state
  const exiting = exit.current
  const lastHeight = useRef(0)
  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!exit.current || !paper) return undefined
    const before = lastHeight.current
    if (!reducedMotion() && before && paper.animate) {
      const after = paper.getBoundingClientRect().height
      if (Math.abs(after - before) > 2) paper.animate([{ height: `${before}px` }, { height: `${before}px`, offset: 0.4 }, { height: `${after}px` }], { duration: 400, easing: 'cubic-bezier(.2,.7,.3,1)' })
    }
    const timer = setTimeout(() => { exit.current = null; redraw(n => n + 1) }, 160)
    return () => clearTimeout(timer)
  }, [state.stage])
  useLayoutEffect(() => { if (paperRef.current && !WELCOMING.has(state.stage)) lastHeight.current = paperRef.current.getBoundingClientRect().height })

  // our focus trap: Tab stays in the sheet; focus that lands on the app behind comes back. Overlays
  // the processor puts on <body> (3DS, Link) are outside the app root and keep their focus.
  useEffect(() => {
    if (!open) return undefined
    const onFocusIn = e => {
      const paper = paperRef.current
      const app = document.getElementById('react-target')
      if (!paper || paper.contains(e.target) || !app?.contains(e.target)) return
      ;(paper.querySelector(`#${TITLE_ID}`) || paper).focus({ preventScroll: true })
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open])
  const onKeyDown = e => {
    if (e.key !== 'Tab' || !paperRef.current) return
    const items = [...paperRef.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el.tagName === 'IFRAME')
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const renderPane = s => {
    const header = sheetHeader({ ...s.request, balanceCents: (s.request?.wallet === 'team' ? summary?.teamBalanceCents : summary?.balanceCents) || 0 })
    const head = <SheetHeader eyebrow={header.eyebrow} title={header.title} titleId={TITLE_ID} onClose={close} closable={closable} />
    let body = null
    if (s.stage === 'blocked') body = <BlockedPane blocked={s.blocked} onClose={close} />
    else if (s.request?.action === 'pro') body = <ProPane state={s} summary={summary} onChoose={choose} pay={pay} />
    else if (s.request?.action === 'topup') body = <TopUpPane state={s} summary={summary} onChoose={choose} pay={pay} />
    else if (s.request?.action === 'card') body = <CardPane state={s} summary={summary} pay={pay} onBack={summary?.proState ? () => openPane('manage') : null} />
    else if (s.request?.action === 'manage') body = <ManagePane state={s} summary={summary} pay={pay} dispatch={dispatch} onOpen={openPane} refresh={refresh} />
    return <>{head}{body}</>
  }

  const welcoming = WELCOMING.has(state.stage)
  const payState = exiting || (welcoming ? null : state)
  const seePro = ['pro', 'card', 'switch'].includes(state.paid?.kind)
    ? () => { dispatch({ type: 'close' }); setTimeout(() => dispatch({ type: 'open', request: { action: 'manage', from: 'profile' }, attemptId: newAttempt(), inApp: payUi().inApp }), 0) }
    : null
  const handle = phone ? <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1, flex: 'none' }} /> : null

  const content = (
    <>
      {!welcoming && handle}
      {payState && payState.stage !== 'closed' && (
        <Box
          aria-hidden={exiting ? 'true' : undefined}
          inert={exiting ? '' : undefined}
          sx={exiting
            ? { position: 'absolute', inset: 0, zIndex: 1, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', pointerEvents: 'none', animation: 'pay-out 160ms ease-out forwards', '@keyframes pay-out': { from: { opacity: 1 }, to: { opacity: 0 } } }
            : { display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}
          data-pay-pane={payState.request?.action || ''}
        >
          {renderPane(payState)}
        </Box>
      )}
      {welcoming && copy && (
        <Welcome
          copy={copy}
          credits={summary?.credits}
          ready={state.confirmed || ['pending', 'processing'].includes(state.variant)}
          titleId={TITLE_ID}
          leadId={LEAD_ID}
          onPrimary={() => dispatch({ type: 'close' })}
          onSeePro={seePro}
          handle={phone ? <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mb: 2.5 }} /> : null}
        />
      )}
      <Box aria-live="polite" sx={visuallyHidden} data-pay-live="">{announcement}</Box>
    </>
  )

  const paperProps = {
    ref: paperRef,
    className: 'pay-sheet ph-no-capture',
    'data-pay-stage': state.stage,
    onKeyDown,
    ...(welcoming && { 'aria-describedby': LEAD_ID }),
  }
  const onClose = () => close()
  if (phone) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        disableEnforceFocus
        disableEscapeKeyDown={!closable}
        PaperProps={{
          ...paperProps,
          role: 'dialog',
          'aria-modal': true,
          'aria-labelledby': TITLE_ID,
          // the drawer's paper is position: fixed at the bottom (a positioned box for the fading pane)
          sx: { borderRadius: '16px 16px 0 0', maxHeight: '94dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.paper', backgroundImage: 'none' },
        }}
      >
        {content}
      </Drawer>
    )
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby={TITLE_ID}
      disableEnforceFocus
      disableEscapeKeyDown={!closable}
      maxWidth={false}
      PaperProps={{
        ...paperProps,
        sx: { width: 480, maxWidth: 'calc(100vw - 32px)', m: 2, borderRadius: '16px', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', backgroundImage: 'none', boxShadow: '0 24px 64px rgba(16,32,24,.32)' },
      }}
    >
      {content}
    </Dialog>
  )
}

PaySheet.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string }).isRequired,
  dispatch: PropTypes.func.isRequired,
}
