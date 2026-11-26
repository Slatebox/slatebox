import React, { useCallback } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtomValue } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { CREDIT_REFUSALS } from '../../api/common/native-canvas-conversation.mjs'
import { allowance } from '../jotai/atoms'
import { dropPendingRetry, prefetchPaySheet, useLoadedAllowance, usePaySheet } from './billing/pay/PaySheetHost'
import { inlinePayActions, inlineRefusalText, refusalAction } from './billing/pay/pay-notice.mjs'

// Whether a refusal is the meter's: no Slatebox Pro (and no own key), this month's credits used up,
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
    const pay = refusalAction(refusal, { summary, metered: Meteor.settings.public.metered === true, ownKeys: Meteor.settings.public.ownKeys === true })
    if (!pay) return null
    if (pay.action === 'again') return typeof retry === 'function' ? { label: pay.label, action: pay.action, run: retry } : null
    const reason = said ?? refusal.reason ?? ''
    return { label: pay.label, action: pay.action, run: () => open({ action: pay.action, wallet: pay.wallet, reason, retry, from }) }
  }, [open, summary])
}

/**
 * The ways on inside a chat's own message (inline): the short reason, then "Get Slatebox Pro — $5/month" and "Add a
 * balance" as buttons in the bubble, each opening the same pay sheet on its pane (the person pays there, with their own
 * click, or not at all); the surface's retry runs once the server has the payment. Pro switched on since: "Run it now".
 */
function InlinePay({ refusal, from, retry }) {
  const { open } = usePaySheet()
  // What this person can buy, from their own meter (read once if nobody on the page has yet): a second way on is offered
  // only when it is known to be theirs; until then the server's own answer is the one button.
  const summary = useLoadedAllowance()
  const actions = inlinePayActions(refusal, { summary, metered: Meteor.settings.public.metered === true, ownKeys: Meteor.settings.public.ownKeys === true })
  const reason = refusal.reason ?? ''
  const run = item => {
    if (item.action !== 'again') return open({ action: item.action, wallet: item.wallet, reason, retry, from, choice: item.choice })
    // Run by hand: the sheet's late confirmation must not run it again.
    dropPendingRetry()
    return retry?.()
  }
  return <Box data-inline-pay="" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    <Typography variant="body2" component="span" sx={{ whiteSpace: 'pre-wrap', display: 'block', lineHeight: 1.5 }}>{inlineRefusalText(refusal, actions) || reason}</Typography>
    {actions.length > 0 && <Box role="group" aria-label="Pay" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {actions.map((item, i) => <Button key={item.action} size="small" variant={i === 0 ? 'contained' : 'outlined'} data-pay-action={item.action}
        disabled={item.action === 'again' && typeof retry !== 'function'} onPointerEnter={prefetchPaySheet} onClick={() => run(item)}
        sx={{ textTransform: 'none' }}>{item.label}</Button>)}
    </Box>}
  </Box>
}

// The button itself, under a refusal's text. plain: the style bar's and the presenter's own
// small button instead of MUI's. inline: inside a chat's message, its text with both ways on (InlinePay).
export default function PayNotice({ refusal, from, retry, plain, inline }) {
  if (inline && refusal) return <InlinePay refusal={refusal} from={from} retry={retry} />
  return <PayButton refusal={refusal} from={from} retry={retry} plain={plain} />
}

function PayButton({ refusal, from, retry, plain }) {
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
  inline: PropTypes.bool,
}

PayNotice.defaultProps = { refusal: null, from: 'draft', retry: null, plain: false, inline: false }
