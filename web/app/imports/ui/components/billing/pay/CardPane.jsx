import React from 'react'
import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import PayArea from './PayArea'
import { brandName } from './manage-view.mjs'

// A new card for Pro (design §5.1 Card): the Payment Element in setup mode (pro.cardSession, one
// session per attempt), then "Save card". The server makes it the default for Pro (and a pending
// switch's schedule) and pays a past-due invoice with it (pro.cardConfirm, or the webhook). If that
// payment needs the bank, Your Pro runs the bank step; if it is declined, this pane comes back with
// the reason (sheet-machine.mjs needs-action / card-declined).
export default function CardPane({ state, summary, pay, onBack }) {
  const pastDue = Boolean(summary?.proState?.pastDue)
  const card = summary?.proCard
  const busy = state.stage === 'confirming'
  const before = (
    <>
      {onBack && (
        <Button variant="text" size="small" disabled={busy} onClick={onBack} sx={{ fontWeight: 700, ml: -1, mb: 1 }} data-pay-back="">
          ‹ Back to Your Pro
        </Button>
      )}
      <Typography sx={{ mb: 2 }}>
        {pastDue ? "Pro's last payment didn't go through. Add a card and we try it again at once." : 'Your next Pro payment uses the card you add here.'}
        {card?.last4 ? ` It replaces ${brandName(card.brand)} ending ${card.last4}.` : ''}
      </Typography>
    </>
  )
  return (
    <PayArea
      mode="setup"
      state={state}
      pay={pay}
      before={before}
      lines={() => null}
      payLabel={() => (pastDue ? 'Save card and pay' : 'Save card')}
      hostedLabel="Add a card"
      fine="Your card is saved for Pro. Stop any time from your profile."
    />
  )
}

CardPane.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string }).isRequired,
  summary: PropTypes.shape({ proState: PropTypes.shape({ pastDue: PropTypes.bool }), proCard: PropTypes.shape({ brand: PropTypes.string, last4: PropTypes.string }) }),
  pay: PropTypes.shape({}).isRequired,
  onBack: PropTypes.func,
}
CardPane.defaultProps = { summary: null, onBack: null }
