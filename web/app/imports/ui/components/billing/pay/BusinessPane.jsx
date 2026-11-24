import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'
import CONSTANTS from '../../../../api/common/constants'
import { PRICING_URL } from '../../../../api/common/contact.mjs'
import ChoiceGroup from './ChoiceGroup'
import PayArea from './PayArea'
import { CheckList, SheetBody } from './SheetParts'
import { BUSINESS_BRINGS, businessChoice, businessFine, moneyIn } from './pay-copy.mjs'

// Get Slatebox Business for the team: month or year at the amounts the server read from Stripe
// (business.offer), times the team's members, then pay. No amount is written in the app.
export default function BusinessPane({ state, onChoose, pay }) {
  const [offer, setOffer] = useState(null)
  useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.business.offer).then(o => { if (live) setOffer(o) }).catch(() => { if (live) setOffer({ onSale: false, prices: [], members: 1 }) })
    return () => { live = false }
  }, [])
  const interval = state.choice?.interval === 'year' ? 'year' : 'month'
  const members = offer?.members || 1
  const price = offer?.prices?.find(p => p.interval === interval) || null
  const choice = businessChoice(price, members)
  const busy = state.stage === 'confirming'
  const pricing = <Link href={offer?.pricingUrl || PRICING_URL} target="_blank" rel="noopener noreferrer">See pricing</Link>

  const before = (
    <>
      {offer?.onSale && (
        <ChoiceGroup
          label="How often"
          value={interval}
          disabled={busy}
          columns={2}
          onChange={v => onChoose({ interval: v })}
          options={offer.prices.map(p => {
            const c = businessChoice(p, members)
            return {
              value: p.interval,
              render: (
                <>
                  <Box component="b" sx={{ display: 'block', fontSize: 15 }}>{p.interval === 'year' ? 'Yearly' : 'Monthly'}</Box>
                  <Box component="span" sx={{ display: 'block', fontSize: 13 }}>{c.label}</Box>
                  <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>{c.sub}</Box>
                </>
              ),
            }
          })}
        />
      )}
      <CheckList rows={BUSINESS_BRINGS} />
      <Box sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
        Everyone in your team is included. {pricing}
      </Box>
    </>
  )

  // the server read no usable price (not on sale here): nothing to pay; the team page says Talk to us
  if (offer && !offer.onSale) {
    return (
      <SheetBody>
        <Box sx={{ fontSize: 14, mb: 2 }}>
          Slatebox Business is not sold in the app here.{' '}
          <Link href={offer.contactUrl} target="_blank" rel="noopener noreferrer">Talk to us about Business</Link>
        </Box>
      </SheetBody>
    )
  }

  const lines = checkout => {
    if (!checkout) return { rows: [{ label: choice?.line || 'Slatebox Business', value: choice ? moneyIn(choice.totalCents, price.currency) : null }, { label: 'Tax', value: null, muted: true }], today: null }
    const taxReady = checkout.tax?.status === 'ready'
    return {
      rows: [
        { label: choice?.line || 'Slatebox Business', value: checkout.total.subtotal.amount },
        { label: 'Tax', value: taxReady ? checkout.total.taxExclusive.amount : <Box component="span" className="taxnote" sx={{ fontSize: 12.5 }}>Added once you enter your country and ZIP</Box>, muted: true },
      ],
      today: taxReady ? checkout.total.total.amount : `${checkout.total.subtotal.amount} + tax`,
    }
  }
  const payLabel = checkout => {
    if (!checkout) return choice ? `Pay ${moneyIn(choice.totalCents, price.currency)} + tax` : 'Pay'
    return checkout.tax?.status === 'ready' ? `Pay ${checkout.total.total.amount}` : `Pay ${checkout.total.subtotal.amount} + tax`
  }
  const hostedLabel = choice ? `Pay ${moneyIn(choice.totalCents, price.currency)} + tax` : 'Pay'
  const hostedRows = choice ? [{ label: choice.line, value: moneyIn(choice.totalCents, price.currency) }, { label: 'Tax', value: 'Where applicable', muted: true }] : null
  return <PayArea state={state} pay={pay} before={before} lines={lines} payLabel={payLabel} hostedLabel={hostedLabel} hostedRows={hostedRows} fine={businessFine(interval)} />
}

BusinessPane.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string, choice: PropTypes.shape({ interval: PropTypes.string }) }).isRequired,
  onChoose: PropTypes.func.isRequired,
  pay: PropTypes.shape({}).isRequired,
}
