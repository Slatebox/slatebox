import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../../api/common/constants'
import { Fine, PayAlert, SheetBody, SheetFooter, sheetTone } from './SheetParts'
import { bankKind, manageOutcome, manageView, receiptRows, runBankStep } from './manage-view.mjs'
import { confirmWithBank } from './StripeCheckout'
import { newAttempt } from './pay-env'
import ContactLinkText from '../ContactLinkText'

// Your Pro (design §5.1 Manage, mock-sheet.html#manage): one list, no tabs. The status, "Confirm
// your card" or "Update your card" pinned on top when Pro needs it, then pay yearly (the server's
// preview) or monthly at renewal ("Monthly from … · Keep yearly" once asked), the card, receipts
// (the latest inline, all of them in place), stop renewing or keep Pro, and the billing page as
// the fallback. Each change has its own small confirm; the sheet is locked while one runs
// (sheet-machine.mjs manage-run). What it shows and what each answer means: manage-view.mjs.

const WORKING = { 'to-year': 'Switching to yearly', 'to-month': 'Switching to monthly at renewal', 'keep-year': 'Keeping yearly', stop: 'Stopping renewal', keep: 'Keeping Pro', bank: 'Waiting for your bank' }
const wait = ms => new Promise(resolve => { setTimeout(resolve, ms) })
const call = (method, args) => Meteor.callAsync(method, args)

const rowSx = theme => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}`, fontSize: 14, '&:last-of-type': { borderBottom: 0 } })
const smallButton = { flex: 'none', fontWeight: 700, whiteSpace: 'nowrap' }

// the danger tone the sheet's alerts use (SheetParts PayAlert), per mode
const danger = theme => (theme.palette.mode === 'dark' ? { ink: '#ffb4a8', wash: '#4a2a25' } : { ink: '#a1352b', wash: '#fbebe7' })

function Seal({ warn }) {
  return (
    <Box component="span" aria-hidden sx={theme => ({ width: 36, height: 36, flex: 'none', borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: warn ? danger(theme).ink : 'primary.main', color: warn ? 'background.paper' : 'primary.contrastText' })}>
      {warn
        ? <svg viewBox="0 0 18 18" width="18" height="18"><path d="M9 4.5v5.5M9 13v.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        : <svg viewBox="0 0 18 18" width="18" height="18"><path d="M5 9.5l2.6 2.5L13 6.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </Box>
  )
}
Seal.propTypes = { warn: PropTypes.bool.isRequired }

function Spinner() {
  return <CircularProgress size={14} color="inherit" sx={{ mr: 1 }} aria-hidden />
}

export default function ManagePane({ state, summary, pay, dispatch, onOpen, refresh }) {
  const pro = summary?.proState || null
  const busy = state.stage === 'confirming'
  const inApp = Boolean(pay.publishableKey) && summary?.inApp !== false
  const [preview, setPreview] = useState(undefined)
  const [invoices, setInvoices] = useState(undefined)
  const [asking, setAsking] = useState(null)
  const [allReceipts, setAllReceipts] = useState(false)
  const [portalProblem, setPortalProblem] = useState(null)
  const rowButtons = useRef({})
  const yesButton = useRef(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])

  // what switching to yearly costs today: the server's own preview, tax included (never our sums)
  const wantsPreview = Boolean(pro?.active && !pro.pastDue && !pro.endsOn && pro.interval === 'month' && !summary?.proPending)
  useEffect(() => {
    if (!wantsPreview) return undefined
    let current = true
    setPreview(undefined)
    call(CONSTANTS.methods.pro.preview, { interval: 'year' }).then(p => { if (current) setPreview(p) }).catch(() => { if (current) setPreview(null) })
    return () => { current = false }
  }, [wantsPreview])

  // receipts, once per opening of Your Pro
  const proHeld = Boolean(pro)
  useEffect(() => {
    if (!proHeld) return undefined
    let current = true
    call(CONSTANTS.methods.pro.invoices).then(rows => { if (current) setInvoices(rows || []) }).catch(() => { if (current) setInvoices(null) })
    return () => { current = false }
  }, [proHeld])

  // a confirm that opens takes focus; "Not now" gives it back to its row's button
  useEffect(() => { if (asking) yesButton.current?.focus() }, [asking])
  const notNow = key => { setAsking(null); setTimeout(() => rowButtons.current[key]?.focus(), 0) }

  // the payment that waits for the bank: secret, the bank's own window, then the server sees it
  const bank = async ({ start }) => {
    if (start) dispatch({ type: 'manage-run', job: 'bank' })
    pay.announce(WORKING.bank)
    const kind = bankKind(summary)
    const out = await runBankStep({
      askSecret: () => call(CONSTANTS.methods.pro.actionSecret),
      confirmWithBank: secret => confirmWithBank(pay.publishableKey, secret),
      wait,
    })
    const after = await refresh()
    if (out.outcome === 'done') {
      dispatch({ type: 'manage-done', kind, detail: kind === 'card' ? { pastDueCleared: true } : { interval: 'year', nextDate: after?.proState?.renewsOn || null } })
      return
    }
    let event = { type: 'manage-error', message: out.message }
    if (out.outcome === 'already') event = { type: 'manage-notice', text: 'There is nothing left to confirm.' }
    if (out.outcome === 'slow') event = { type: 'manage-notice', text: 'Your bank confirmed it. Your Pro shows it in a moment.' }
    dispatch(event)
    pay.announce(event.text || event.message)
  }

  // a saved card whose past-due payment needs the bank: the step runs as the pane opens
  const bankStarted = useRef(false)
  useEffect(() => {
    if (state.bank && state.stage === 'ready' && !bankStarted.current && inApp) {
      bankStarted.current = true
      bank({ start: true })
    }
  }, [state.bank])

  const run = async job => {
    setAsking(null)
    dispatch({ type: 'manage-run', job })
    pay.announce(WORKING[job])
    let result
    try {
      if (job === 'stop' || job === 'keep') result = await call(CONSTANTS.methods.pro.renewal, { renew: job === 'keep', attemptId: newAttempt() })
      else result = await call(CONSTANTS.methods.pro.switchInterval, { interval: job === 'to-month' ? 'month' : 'year', attemptId: newAttempt() })
    } catch (err) {
      result = { error: err?.error || 'error', reason: err?.reason || null }
    }
    const after = result.error ? summary : await refresh()
    const event = manageOutcome(job, result, after)
    if (event.type === 'manage-bank') {
      dispatch(event)
      await bank({ start: false })
      return
    }
    dispatch(event)
    if (live.current) pay.announce(event.text || event.message)
  }

  const portal = async () => {
    setPortalProblem(null)
    try {
      const { url } = await call(CONSTANTS.methods.pro.portal)
      window.location.assign(url)
    } catch (err) {
      setPortalProblem(err.reason || 'The billing page is not available just now. Try again in a moment.')
    }
  }

  const view = manageView({ ...summary, inApp }, { preview, invoices })

  const act = row => {
    if (row.key === 'get') return onOpen('pro')
    if (row.key === 'card') return onOpen('card')
    if (row.key === 'receipts') return setAllReceipts(v => !v)
    if (row.confirm) return setAsking(row.key)
    return run(row.job)
  }

  const { pinned } = view
  let pinnedButton = null
  if (pinned) {
    const label = <>{busy && state.job === 'bank' && <Spinner />}{pinned.button}</>
    if (pinned.key === 'past-due') pinnedButton = <Button variant="contained" size="small" disabled={busy} onClick={() => onOpen('card')} sx={smallButton}>{pinned.button}</Button>
    else if (inApp) pinnedButton = <Button variant="contained" size="small" disabled={busy} onClick={() => bank({ start: true })} sx={smallButton}>{label}</Button>
    else if (pinned.href) pinnedButton = <Button variant="contained" size="small" href={pinned.href} target="_blank" rel="noopener noreferrer" sx={smallButton}>{pinned.button}</Button>
    else pinnedButton = <Button variant="contained" size="small" disabled={busy} onClick={portal} sx={smallButton}>{pinned.button}</Button>
  }

  return (
    <>
      <SheetBody>
        <Box sx={theme => ({ display: 'flex', gap: 1.5, alignItems: 'center', bgcolor: view.status.warn ? danger(theme).wash : sheetTone.selected(theme), borderRadius: '12px', px: 1.75, py: 1.5, mb: 1 })} data-pay-manage="">
          <Seal warn={view.status.warn} />
          <div>
            <Typography component="b" sx={{ fontWeight: 700, display: 'block' }}>{view.status.title}</Typography>
            {view.status.when && <Typography variant="body2" color="text.secondary">{view.status.when}</Typography>}
          </div>
        </Box>

        {state.error && <PayAlert>{state.error.message}</PayAlert>}
        {state.notice && (
          <Box role="status" sx={theme => ({ borderRadius: '10px', px: 1.5, py: 1.25, my: 1.5, fontSize: 13.5, bgcolor: sheetTone.offset(theme) })} data-pay-notice=""><ContactLinkText text={state.notice} /></Box>
        )}
        {view.notices.map(text => (
          <Box key={text} sx={theme => ({ borderRadius: '10px', px: 1.5, py: 1.25, my: 1, fontSize: 13.5, bgcolor: sheetTone.offset(theme) })}>{text}</Box>
        ))}

        {pinned && (
          <Box sx={theme => ({ ...rowSx(theme), border: `1.5px solid ${theme.palette.primary.main}`, borderRadius: '12px', px: 1.75, my: 1, '&:last-of-type': {} })} data-pay-pinned={pinned.key}>
            <div>
              <Typography component="b" sx={{ fontWeight: 700, display: 'block', fontSize: 14 }}>{pinned.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>{pinned.sub}</Typography>
            </div>
            {pinnedButton}
          </Box>
        )}

        <Box>
          {view.rows.map(row => (
            <Box key={row.key} sx={theme => ({ borderBottom: `1px solid ${theme.palette.divider}`, '&:last-of-type': { borderBottom: 0 } })} data-pay-row={row.key}>
              <Box sx={theme => ({ ...rowSx(theme), borderBottom: 0 })}>
                <div>
                  <Typography component="b" sx={{ fontWeight: 700, display: 'block', fontSize: 14 }}>{row.title}</Typography>
                  {row.sub && <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>{row.sub}</Typography>}
                </div>
                {row.button && (
                  <Button
                    ref={el => { rowButtons.current[row.key] = el }}
                    variant={row.key === 'switch' || row.key === 'get' ? 'outlined' : 'text'}
                    size="small"
                    disabled={busy || row.disabled || asking === row.key}
                    aria-expanded={row.key === 'receipts' ? allReceipts : undefined}
                    onClick={() => act(row)}
                    sx={{ ...smallButton, borderRadius: row.key === 'switch' || row.key === 'get' ? '18px' : undefined }}
                  >
                    {busy && state.job === row.job && !row.confirm && <Spinner />}
                    {row.key === 'receipts' && allReceipts ? 'Hide' : row.button}
                  </Button>
                )}
              </Box>

              {row.confirm && (asking === row.key || (busy && state.job === row.job)) && (
                <Box sx={theme => ({ borderRadius: '10px', px: 1.5, py: 1.25, mb: 1.5, bgcolor: sheetTone.offset(theme) })} data-pay-confirm={row.job}>
                  <Typography sx={{ fontSize: 14, mb: 1.25 }}>{row.confirm.text}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    <Button ref={yesButton} variant="contained" size="small" disabled={busy} onClick={() => run(row.job)} sx={{ fontWeight: 700 }} aria-busy={busy || undefined}>
                      {busy && <Spinner />}{row.confirm.yes}
                    </Button>
                    <Button variant="text" size="small" disabled={busy} onClick={() => notNow(row.key)} sx={{ fontWeight: 700 }}>{row.confirm.no}</Button>
                  </Box>
                </Box>
              )}

              {row.key === 'receipts' && allReceipts && Array.isArray(invoices) && (
                <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 1.5, p: 0, display: 'grid', gap: 0.75 }} data-pay-receipts="">
                  {receiptRows(invoices).map(r => (
                    <Box component="li" key={r.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 13.5 }}>
                      <span>{r.date} · {r.amount}{r.status !== 'Paid' && <Box component="span" sx={{ color: 'text.secondary' }}> · {r.status}</Box>}</span>
                      <Box component="span" sx={{ display: 'flex', gap: 1.5, flex: 'none' }}>
                        {r.url && <Link href={r.url} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600 }}>View</Link>}
                        {r.pdf && <Link href={r.pdf} target="_blank" rel="noopener noreferrer" underline="hover" sx={{ fontWeight: 600 }}>PDF</Link>}
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
        {portalProblem && <PayAlert>{portalProblem}</PayAlert>}
      </SheetBody>
      {view.portal.show && (
        <SheetFooter>
          <Fine>
            Something not here?{' '}
            <Button variant="text" size="small" disabled={busy} onClick={portal} sx={{ fontSize: 'inherit', p: 0, minWidth: 0, verticalAlign: 'baseline', textDecoration: 'underline' }}>Open the billing page</Button>
          </Fine>
          {view.portal.note && <Fine>{view.portal.note}</Fine>}
        </SheetFooter>
      )}
    </>
  )
}

ManagePane.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string, job: PropTypes.string, bank: PropTypes.string, notice: PropTypes.string, error: PropTypes.shape({ message: PropTypes.string }) }).isRequired,
  summary: PropTypes.shape({ proState: PropTypes.shape({}), proPending: PropTypes.shape({}), inApp: PropTypes.bool }),
  pay: PropTypes.shape({ publishableKey: PropTypes.string, announce: PropTypes.func }).isRequired,
  dispatch: PropTypes.func.isRequired,
  onOpen: PropTypes.func.isRequired,
  refresh: PropTypes.func.isRequired,
}
ManagePane.defaultProps = { summary: null }
