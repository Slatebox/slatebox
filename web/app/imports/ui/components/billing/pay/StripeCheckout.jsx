import React, { useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import { loadStripe } from '@stripe/stripe-js/pure'
import { CheckoutElementsProvider, ExpressCheckoutElement, PaymentElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout'
import { PAY_FONTS, stripeAppearance } from './appearance.mjs'
import { FieldSkeleton, Fine, OrLine, PayAlert, PayButton, SheetBody, SheetFooter, Totals } from './SheetParts'

// The only file that imports the payment SDK (design §2.1). It holds the Checkout session provider
// (ui_mode 'elements'), the wallet buttons, the Payment Element, the totals the processor computed
// for our server's session, and the Pay button, enabled only when the session can be confirmed.
// The sheet's state machine (sheet-machine.mjs) decides what happens with each answer.

let stripeOnce = null
// js.stripe.com is fetched once per page, on the first open of the sheet (the pure entry adds no
// script tag on import).
const stripeFor = publishableKey => { stripeOnce ||= loadStripe(publishableKey); return stripeOnce }

/**
 * The bank's own confirmation (3DS) of a Pro payment that waits for the person: a switch to yearly
 * or a past-due payment on a new card (Your Pro, manage-view.mjs runBankStep). The secret is the
 * invoice's confirmation secret from pro.actionSecret. → { paymentIntent } | { error }
 */
export async function confirmWithBank(publishableKey, clientSecret) {
  const stripe = await stripeFor(publishableKey)
  if (!stripe) return { error: { message: 'Payments are not available just now.' } }
  return stripe.handleNextAction({ clientSecret })
}

const formatted = amount => amount?.amount || null

function CheckoutBody({ mode, before, lines, payLabel, fine, confirming, error, onPay, onResult, onThrew, onExpired, announce, phone, appearance }) {
  const state = useCheckoutElements()
  const [wallets, setWallets] = useState(false)
  const [fieldReady, setFieldReady] = useState(false)
  const alertRef = useRef(null)
  const checkout = state.type === 'success' ? state.checkout : null
  const total = formatted(checkout?.total?.total)
  const expired = state.type === 'error' ? /expired/i.test(state.error?.message || '') : checkout?.status?.type === 'expired'

  // an expired session is made again (the machine allows one silent renewal)
  useEffect(() => { if (expired) onExpired() }, [expired])

  // the theme changed while the sheet is open
  useEffect(() => { checkout?.changeAppearance?.(appearance) }, [appearance, Boolean(checkout)])

  // a total that changes (tax once an address is in) is announced, politely
  const lastTotal = useRef(null)
  useEffect(() => {
    if (!total) return
    if (lastTotal.current && lastTotal.current !== total) announce(`Total is now ${total}`)
    lastTotal.current = total
  }, [total])

  // a decline: the alert is read out, and focus goes back to the card field
  useEffect(() => {
    if (!error || !checkout) return
    const field = checkout.getPaymentElement?.()
    if (field?.focus) field.focus()
    else alertRef.current?.focus()
  }, [error])

  const confirm = async extra => {
    onPay()
    try {
      // whether the wallet buttons were on screen: a decline offers them only then
      onResult(await checkout.confirm({ redirect: 'if_required', ...extra }), { wallets: mode === 'payment' && wallets })
    } catch (err) {
      onThrew(err)
    }
  }

  const rows = lines(checkout)
  const loading = !checkout
  return (
    <>
      <SheetBody>
        {before}
        <Box sx={theme => ({ borderTop: `1px solid ${theme.palette.divider}`, pt: 2 })} data-pay-fields="">
          {mode === 'payment' && checkout && (
            <Box sx={{ display: wallets ? 'block' : 'none' }}>
              <ExpressCheckoutElement
                options={{ buttonHeight: 48, layout: { maxColumns: 1, maxRows: 3, overflow: 'auto' } }}
                onReady={e => setWallets(Boolean(e?.availablePaymentMethods && Object.values(e.availablePaymentMethods).some(Boolean)))}
                onConfirm={ev => confirm({ expressCheckoutConfirmEvent: ev })}
              />
              <OrLine>or pay by card</OrLine>
            </Box>
          )}
          {error && <PayAlert alertRef={alertRef}>{error.message}</PayAlert>}
          {!fieldReady && <Box sx={{ mx: 0, mt: -2 }}><FieldSkeleton /></Box>}
          {checkout && (
            <Box sx={{ display: fieldReady ? 'block' : 'none', minHeight: 44 }}>
              <PaymentElement options={{ layout: phone ? 'accordion' : 'tabs', readOnly: confirming }} onReady={() => setFieldReady(true)} />
            </Box>
          )}
          {state.type === 'error' && !expired && <PayAlert>Payment is not available just now. Nothing was charged. Close this and try again.</PayAlert>}
        </Box>
        {rows && <Totals rows={rows.rows} today={rows.today === undefined ? total : rows.today} loading={loading} />}
      </SheetBody>
      <SheetFooter>
        <PayButton label={payLabel(checkout)} busy={confirming} busyLabel={mode === 'setup' ? 'Saving…' : 'Paying…'} disabled={!checkout?.canConfirm} onClick={() => confirm({})} />
        {fine && <Fine>{fine}</Fine>}
      </SheetFooter>
    </>
  )
}

CheckoutBody.propTypes = {
  mode: PropTypes.oneOf(['payment', 'setup']).isRequired,
  before: PropTypes.node,
  lines: PropTypes.func.isRequired,
  payLabel: PropTypes.func.isRequired,
  fine: PropTypes.node,
  confirming: PropTypes.bool.isRequired,
  error: PropTypes.shape({ kind: PropTypes.string, message: PropTypes.string }),
  onPay: PropTypes.func.isRequired,
  onResult: PropTypes.func.isRequired,
  onThrew: PropTypes.func.isRequired,
  onExpired: PropTypes.func.isRequired,
  announce: PropTypes.func.isRequired,
  phone: PropTypes.bool.isRequired,
  appearance: PropTypes.shape({}).isRequired,
}
CheckoutBody.defaultProps = { before: null, fine: null, error: null }

/**
 * clientSecret: the session's (null while it is being made: skeletons, Pay disabled).
 * lines(checkout|null) → { rows: [{ label, value, muted }], today? } | null.
 * payLabel(checkout|null) → the button's words (with the amount).
 */
export default function StripeCheckout({ publishableKey, clientSecret, ...rest }) {
  const theme = useTheme()
  const appearance = useMemo(() => stripeAppearance({ mode: theme.palette.mode, palette: theme.palette }), [theme.palette.mode])
  if (!clientSecret) {
    const rows = rest.lines(null)
    return (
      <>
        <SheetBody>
          {rest.before}
          <FieldSkeleton />
          {rows && <Totals rows={rows.rows} today={rows.today ?? null} loading />}
        </SheetBody>
        <SheetFooter>
          <PayButton label={rest.payLabel(null)} disabled onClick={() => {}} />
          {rest.fine && <Fine>{rest.fine}</Fine>}
        </SheetFooter>
      </>
    )
  }
  return (
    <CheckoutElementsProvider
      key={clientSecret}
      stripe={stripeFor(publishableKey)}
      options={{ clientSecret, elementsOptions: { appearance, fonts: PAY_FONTS } }}
    >
      <CheckoutBody {...rest} appearance={appearance} />
    </CheckoutElementsProvider>
  )
}

StripeCheckout.propTypes = {
  publishableKey: PropTypes.string.isRequired,
  clientSecret: PropTypes.string,
  lines: PropTypes.func.isRequired,
  payLabel: PropTypes.func.isRequired,
  before: PropTypes.node,
  fine: PropTypes.node,
}
StripeCheckout.defaultProps = { clientSecret: null, before: null, fine: null }
