import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import ChoiceGroup from './ChoiceGroup'
import PayArea from './PayArea'
import { CheckList } from './SheetParts'
import { PRO_FIGURES, money, proBrings } from './pay-copy.mjs'
import { billingDate, dayOfMonth } from '../billing-date.mjs'

// Get Pro: month or year, what Pro brings (the meter's own numbers), then pay (design §5.1).
export default function ProPane({ state, summary, onChoose, pay }) {
  const interval = state.choice?.interval === 'year' ? 'year' : 'month'
  const fig = PRO_FIGURES[interval]
  const busy = state.stage === 'confirming'
  const now = new Date()
  const fine = interval === 'month'
    ? `Renews monthly on the ${dayOfMonth(now)}. Stop any time from your profile.`
    : `Renews yearly on ${billingDate(now, 'dayMonth')}. Stop any time from your profile.`

  const before = (
    <>
      <ChoiceGroup
        label="How often"
        value={interval}
        disabled={busy}
        columns={2}
        onChange={v => onChoose({ interval: v })}
        options={['month', 'year'].map(v => ({
          value: v,
          render: (
            <>
              <Box component="b" sx={{ display: 'block', fontSize: 15 }}>
                {PRO_FIGURES[v].label}
                {PRO_FIGURES[v].tag && (
                  <Box component="span" sx={{ display: { xs: 'table', sm: 'inline-block' }, mt: { xs: 0.5, sm: 0 }, ml: { xs: 0, sm: 0.75 }, fontSize: 11, fontWeight: 700, bgcolor: '#f4c37d', color: '#213d32', borderRadius: '10px', px: 0.875, py: '1px', verticalAlign: '1px' }}>
                    {PRO_FIGURES[v].tag}
                  </Box>
                )}
              </Box>
              <Box component="span" sx={{ fontSize: 13, color: 'text.secondary' }}>{PRO_FIGURES[v].sub}</Box>
            </>
          ),
        }))}
      />
      <CheckList rows={proBrings(summary?.credits)} />
    </>
  )

  // totals: the processor's figures for our session; tax only once it is known (design §5.1 review)
  const lines = checkout => {
    if (!checkout) return { rows: [{ label: fig.line, value: money(fig.cents) }, { label: 'Tax', value: null, muted: true }], today: null }
    const taxReady = checkout.tax?.status === 'ready'
    return {
      rows: [
        { label: fig.line, value: checkout.total.subtotal.amount },
        { label: 'Tax', value: taxReady ? checkout.total.taxExclusive.amount : <Box component="span" className="taxnote" sx={{ fontSize: 12.5 }}>Added once you enter your country and ZIP</Box>, muted: true },
      ],
      today: taxReady ? checkout.total.total.amount : `${checkout.total.subtotal.amount} + tax`,
    }
  }
  const payLabel = checkout => {
    if (!checkout) return `Pay ${money(fig.cents)} + tax`
    return checkout.tax?.status === 'ready' ? `Pay ${checkout.total.total.amount}` : `Pay ${checkout.total.subtotal.amount} + tax`
  }
  const hostedLabel = `Pay ${money(fig.cents)} + tax`
  return <PayArea state={state} pay={pay} before={before} lines={lines} payLabel={payLabel} hostedLabel={hostedLabel} hostedRows={[{ label: fig.line, value: money(fig.cents) }, { label: 'Tax', value: 'Where applicable', muted: true }]} fine={fine} />
}

ProPane.propTypes = {
  state: PropTypes.shape({ stage: PropTypes.string, choice: PropTypes.shape({ interval: PropTypes.string }) }).isRequired,
  summary: PropTypes.shape({ credits: PropTypes.shape({}) }),
  onChoose: PropTypes.func.isRequired,
  pay: PropTypes.shape({}).isRequired,
}
ProPane.defaultProps = { summary: null }
