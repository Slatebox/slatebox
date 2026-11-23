import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import CONSTANTS from '../../../../api/common/constants'
import ChoiceGroup from './ChoiceGroup'
import PayArea from './PayArea'
import { sheetTone } from './SheetParts'
import { money, whyText } from './pay-copy.mjs'
import ContactLinkText from '../ContactLinkText'

const FIRST_TOP_UP_CAP = 2500
const whole = cents => (cents % 100 ? money(cents) : `$${cents / 100}`)

// Top up a balance (yours, or the team's for an admin): why, the amount, then pay (design §5.1).
// The price is the server's quote (wallet.quote, topUp.cardFee): "Top up $10" with "includes
// processing" when the card processing is folded into the price; never a separate fee line.
export default function TopUpPane({ state, summary, onChoose, pay }) {
  const team = state.request?.wallet === 'team'
  const amounts = summary?.topUpAmounts || [1000, 2500, 5000, 10000]
  const amountCents = state.choice?.amountCents || amounts[0]
  const firstTopUp = team ? summary?.teamFirstTopUp : summary?.firstTopUp
  const [quote, setQuote] = useState(null)
  const busy = state.stage === 'confirming'

  useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.wallet.quote, { amountCents }).then(q => { if (live) setQuote(q) }).catch(() => { if (live) setQuote(null) })
    return () => { live = false }
  }, [amountCents])

  const why = whyText(state.request?.reason)
  const capId = 'pay-first-topup-cap'
  const before = (
    <>
      {why && <Box sx={theme => ({ fontSize: 13.5, color: 'text.secondary', bgcolor: sheetTone.offset(theme), borderRadius: '10px', px: 1.5, py: 1.25, mb: 2 })} data-pay-why=""><ContactLinkText text={why} /></Box>}
      <ChoiceGroup
        label="Amount"
        compact
        columns={4}
        value={amountCents}
        disabled={busy}
        onChange={v => onChoose({ amountCents: v })}
        options={amounts.map(a => ({
          value: a,
          disabled: Boolean(firstTopUp && a > FIRST_TOP_UP_CAP),
          describedBy: firstTopUp && a > FIRST_TOP_UP_CAP ? capId : undefined,
          render: <Box component="b" sx={{ fontSize: 15 }}>{whole(a)}</Box>,
        }))}
      />
      {firstTopUp && <Box component="p" id={capId} sx={{ fontSize: 13, color: 'text.secondary', mt: -0.5, mb: 1.5 }}>Your first top-up can be up to {whole(FIRST_TOP_UP_CAP)}.</Box>}
    </>
  )

  const label = quote?.label || `Top up ${whole(amountCents)}`
  const note = quote?.note ? <Box component="span" sx={{ display: 'block', fontSize: 12.5, color: 'text.secondary' }}>{quote.note[0].toUpperCase() + quote.note.slice(1)}</Box> : null
  const lineLabel = note ? <>{label}{note}</> : label
  const quoted = quote ? money(quote.totalCents) : null
  const lines = checkout => ({
    rows: [{ key: 'balance', label: lineLabel, value: checkout ? checkout.total.subtotal.amount : quoted }],
    today: checkout ? checkout.total.total.amount : quoted,
  })
  const hostedLabel = quoted ? `Pay ${quoted}` : 'Pay'
  const payLabel = checkout => (checkout ? `Pay ${checkout.total.total.amount}` : hostedLabel)
  return (
    <PayArea
      state={state}
      pay={pay}
      before={before}
      lines={lines}
      payLabel={payLabel}
      hostedLabel={hostedLabel}
      hostedRows={[{ key: 'balance', label: lineLabel, value: quoted }]}
      fine="Unused balance can be refunded from your profile."
    />
  )
}

TopUpPane.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string, request: PropTypes.shape({ wallet: PropTypes.string, reason: PropTypes.string }), choice: PropTypes.shape({ amountCents: PropTypes.number }) }).isRequired,
  summary: PropTypes.shape({ topUpAmounts: PropTypes.arrayOf(PropTypes.number), firstTopUp: PropTypes.bool, teamFirstTopUp: PropTypes.bool }),
  onChoose: PropTypes.func.isRequired,
  pay: PropTypes.shape({}).isRequired,
}
TopUpPane.defaultProps = { summary: null }
