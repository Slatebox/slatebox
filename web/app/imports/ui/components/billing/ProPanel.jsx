import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Link from '@mui/material/Link'
import CONSTANTS from '../../../api/common/constants'
import { BUSINESS } from '../../../api/business/catalog.mjs'
import { PRICING_URL } from '../../../api/common/contact.mjs'
import { AccountActions, AccountNote, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'
import { prefetchPaySheet, usePaySheet } from './pay/PaySheetHost'
import { proStatusText } from './billing-date.mjs'

// Profile → Credits → Slatebox Pro: one optional personal subscription on Slatebox Cloud, monthly
// or yearly, that includes AI and calls each month (summary.credits: the meter's own numbers in
// plain words). Get it, and manage it (card, monthly or yearly, stop renewing, receipts), in the
// in-app pay sheet (billing/pay), and see when it renews or ends. For a team, Slatebox Business:
// talk to us (an email) for now.
export default function ProPanel({ summary, onChange }) {
  const { open } = usePaySheet()
  const pro = summary.proState

  // a subscription that looks out of date (a missed webhook) is read again from Stripe
  useEffect(() => {
    if (summary.proStale) Meteor.callAsync(CONSTANTS.methods.pro.refresh).then(changed => { if (changed) onChange?.() }).catch(() => {})
  }, [summary.proStale])

  // The return from a payment that left the page (?pro=cs_…) opens the pay sheet's Welcome
  // (billing/pay/PaySheetHost.jsx), which confirms it with the server and refreshes the summary.

  // the pay sheet: month or year chosen here is chosen there; Your Pro, or the card when its last payment failed
  const getPro = interval => open({ action: 'pro', choice: { interval } })
  const manage = () => open({ action: pro?.pastDue ? 'card' : 'manage' })

  // the same date the pay sheet's Your Pro shows (billing-date.mjs)
  const status = proStatusText(pro)

  const holding = Boolean(pro && (pro.active || pro.pastDue))
  let manageLabel = 'Pro invoices'
  if (pro?.pastDue) manageLabel = 'Update your card'
  else if (holding) manageLabel = 'Your Pro (card, monthly or yearly, renewal, receipts)'
  return (
    <AccountSection title="Slatebox Pro">
      {status && <Typography>{status}</Typography>}
      {!holding && (
        <Typography>
          Slatebox is free. Pro is $5 a month or $50 a year (two months free), plus tax where applicable, for you alone, and includes AI on Slatebox, image search and calls you start. Cancel any time.
        </Typography>
      )}
      {summary.credits?.sentence && (
        <AccountNote>
          <Typography variant="body2" data-pro-credits="">
            {holding ? 'Your Pro credits. ' : 'Pro credits. '}{summary.credits.sentence} Unused credits don’t carry over.
          </Typography>
        </AccountNote>
      )}
      {summary.proAvailable && (
        <AccountActions>
          {!holding && summary.emailVerified && <>
            <Button variant="contained" onPointerEnter={prefetchPaySheet} onClick={() => getPro('month')}>Get Pro, $5 a month</Button>
            <Button variant="outlined" onPointerEnter={prefetchPaySheet} onClick={() => getPro('year')}>Get Pro, $50 a year</Button>
          </>}
          {!holding && !summary.emailVerified && <Typography variant="body2">Confirm your email address to get Slatebox Pro.</Typography>}
          {pro && <Button variant={holding ? 'contained' : 'outlined'} onPointerEnter={prefetchPaySheet} onClick={manage}>{manageLabel}</Button>}
        </AccountActions>
      )}
      {/* Slatebox Business: a team's owner or admin gets it on the team page; amounts on the pricing page */}
      <FinePrint sx={{ mt: SPACE.text }}>
        For a team: {BUSINESS.name}, paid per person, with a shared AI and call pool. Get it on your team page.{' '}
        <Link href={PRICING_URL} target="_blank" rel="noopener noreferrer">See pricing</Link>
      </FinePrint>
    </AccountSection>
  )
}

ProPanel.propTypes = {
  summary: PropTypes.shape({
    proState: PropTypes.shape({}),
    proStale: PropTypes.bool,
    proAvailable: PropTypes.bool,
    credits: PropTypes.shape({ sentence: PropTypes.string }),
    needsPro: PropTypes.bool,
    pro: PropTypes.bool,
    emailVerified: PropTypes.bool,
  }).isRequired,
  onChange: PropTypes.func,
}

ProPanel.defaultProps = {
  onChange: () => {},
}
