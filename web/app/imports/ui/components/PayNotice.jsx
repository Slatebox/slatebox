import React, { useCallback } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtomValue } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import { CREDIT_REFUSALS } from '../../api/common/native-canvas-conversation.mjs'
import { allowance } from '../jotai/atoms'
import { usePaySheet } from './billing/pay/PaySheetHost'
import { refusalAction } from './billing/pay/pay-notice.mjs'
import { ownKeysAllowed } from '../../api/common/own-keys.mjs'

// Whether a refusal is the meter's: no Slatebox Pro (or, self-hosted, own AI), this month's credits used up,
// a paused budget, an unconfirmed address. Only a server with a meter has them.
export const isCreditRefusal = (code) => Meteor.settings.public.metered === true && CREDIT_REFUSALS.includes(code)

/**
 * The way on from a refusal, in place (design §4.1): usePayAction()(refusal, { from, retry }) →
 * { label, action, run } | null. run() opens the pay sheet on the refusal's pane (Get Pro, top up,
 * the card, confirm the email…); the surface's retry runs once the server has the payment. When
 * Pro came on since, run() is the retry itself.
 *   from: what the person was doing ('draft' | 'call' | 'pictures' | 'image' | 'plan'), for the
 *   sheet's heading and the Welcome's button.
 */
export function usePayAction() {
  const { open } = usePaySheet()
  const summary = useAtomValue(allowance)
  return useCallback((refusal, { from = 'draft', retry = null, reason: said = null } = {}) => {
    const pay = refusalAction(refusal, { summary, metered: Meteor.settings.public.metered === true, ownKeys: ownKeysAllowed(Meteor.settings) })
    if (!pay) return null
    if (pay.action === 'again') return typeof retry === 'function' ? { label: pay.label, action: pay.action, run: retry } : null
    const reason = said ?? refusal.reason ?? ''
    return { label: pay.label, action: pay.action, run: () => open({ action: pay.action, wallet: pay.wallet, reason, retry, from }) }
  }, [open, summary])
}

// The button itself, under a refusal's text. plain: the style bar's and the presenter's own
// small button instead of MUI's.
export default function PayNotice({ refusal, from, retry, plain }) {
  const payAction = usePayAction()
  const pay = refusal ? payAction(refusal, { from, retry }) : null
  if (!pay) return null
  if (plain) {
    return <button type="button" className="sb-quiet" data-pay-action={pay.action} onClick={pay.run}>{pay.label}</button>
  }
  return (
    <Box aria-label="Pay" sx={{ my: 1 }}>
      <Button variant="outlined" size="small" data-pay-action={pay.action} onClick={pay.run}>{pay.label}</Button>
    </Box>
  )
}

PayNotice.propTypes = {
  refusal: PropTypes.shape({ error: PropTypes.string, code: PropTypes.string, reason: PropTypes.string, details: PropTypes.shape({}) }),
  from: PropTypes.oneOf(['draft', 'call', 'pictures', 'image', 'plan']),
  retry: PropTypes.func,
  plain: PropTypes.bool,
}

PayNotice.defaultProps = { refusal: null, from: 'draft', retry: null, plain: false }
