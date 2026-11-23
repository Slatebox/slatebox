import React from 'react'
import PropTypes from 'prop-types'
import StripeCheckout from './StripeCheckout'
import { Fine, PayAlert, PayButton, SheetBody, SheetFooter, Totals } from './SheetParts'

// The lower half of a paying pane: in the app (the Payment Element in StripeCheckout.jsx), or, where
// in-app payments are off (public.stripe.inApp false, no publishable key, self-host, the dev mock),
// the same choice and totals with a Pay button that goes to the hosted page (today's redirect).
export default function PayArea({ state, pay, before, lines, payLabel, hostedLabel, hostedRows, fine, mode, askEmail }) {
  const confirming = state.stage === 'confirming'
  if (state.hosted || state.session?.ui === 'hosted') {
    return (
      <>
        <SheetBody>
          {before}
          {state.error && <PayAlert>{state.error.message}</PayAlert>}
          {hostedRows && <Totals rows={hostedRows} />}
        </SheetBody>
        <SheetFooter>
          <PayButton label={hostedLabel} busy={confirming} busyLabel="Opening the payment page…" onClick={pay.onHostedPay} />
          {fine && <Fine>{fine}</Fine>}
        </SheetFooter>
      </>
    )
  }
  return (
    <StripeCheckout
      mode={mode}
      publishableKey={pay.publishableKey}
      clientSecret={state.stage === 'preparing' ? null : state.session?.clientSecret || null}
      before={before}
      lines={lines}
      payLabel={payLabel}
      fine={fine}
      confirming={confirming}
      error={state.error}
      onPay={pay.onPay}
      onResult={pay.onResult}
      onThrew={pay.onThrew}
      onExpired={pay.onExpired}
      announce={pay.announce}
      phone={pay.phone}
      askEmail={askEmail}
    />
  )
}

PayArea.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string, hosted: PropTypes.bool, session: PropTypes.shape({ ui: PropTypes.string, clientSecret: PropTypes.string }), error: PropTypes.shape({ message: PropTypes.string }) }).isRequired,
  pay: PropTypes.shape({
    publishableKey: PropTypes.string, onPay: PropTypes.func, onResult: PropTypes.func, onThrew: PropTypes.func, onExpired: PropTypes.func, onHostedPay: PropTypes.func, announce: PropTypes.func, phone: PropTypes.bool,
  }).isRequired,
  before: PropTypes.node,
  lines: PropTypes.func.isRequired,
  payLabel: PropTypes.func.isRequired,
  hostedLabel: PropTypes.string.isRequired,
  hostedRows: PropTypes.arrayOf(PropTypes.shape({})),
  fine: PropTypes.node,
  mode: PropTypes.oneOf(['payment', 'setup']),
  askEmail: PropTypes.bool,
}
PayArea.defaultProps = { before: null, hostedRows: null, fine: null, mode: 'payment', askEmail: false }
