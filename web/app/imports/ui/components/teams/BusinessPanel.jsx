import React, { useCallback, useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { Organizations } from '../../../api/common/models'
import { PRICING_URL } from '../../../api/common/contact.mjs'
import { BUSINESS } from '../../../api/business/catalog.mjs'
import { usePaySheet, prefetchPaySheet } from '../billing/pay/PaySheetHost'
import { newAttempt } from '../billing/pay/pay-env'
import { billingDate } from '../billing/billing-date.mjs'

// Slatebox Business on the team page: get it for the team (owner or admin, where the server sells
// it), see where it stands, stop or keep renewing, and the card and receipts. No amount is written
// here: the sheet shows Stripe's, and "See pricing" links the pricing page.
export default function BusinessPanel() {
  const { open } = usePaySheet()
  const [offer, setOffer] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  // the team document changes when the webhook writes organizations.business: read the offer again
  const stamp = useTracker(() => {
    const business = Organizations.findOne()?.business
    return business ? `${business.status}:${business.stripeStatus}:${business.cancelAtPeriodEnd}:${business.members}` : 'none'
  }, [])
  const load = useCallback(() => {
    Meteor.callAsync(CONSTANTS.methods.business.offer).then(setOffer).catch(() => setOffer(null))
  }, [])
  useEffect(load, [stamp])
  if (!offer) return null

  const { summary, manager, onSale } = offer
  const pricing = <Link href={offer.pricingUrl || PRICING_URL} target="_blank" rel="noopener noreferrer">See pricing</Link>
  const talk = <Link href={offer.contactUrl || BUSINESS.contactUrl} target="_blank" rel="noopener noreferrer">{BUSINESS.contactLabel}</Link>

  const run = async (method, args, done) => {
    setBusy(true)
    setNote(null)
    try {
      const out = await Meteor.callAsync(method, args)
      done?.(out)
      load()
    } catch (err) {
      setNote({ severity: 'error', text: err?.reason || 'That did not work. Try again.' })
    } finally {
      setBusy(false)
    }
  }
  const portal = () => run(CONSTANTS.methods.business.portal, {}, out => { if (out?.url) window.location.assign(out.url) })
  const renewal = renew => run(CONSTANTS.methods.business.renewal, { renew, attemptId: newAttempt() }, () => {
    setNote({ severity: 'success', text: renew ? 'Business renews as before.' : 'Business stops at the end of this period. Your team keeps it until then.' })
  })

  let body
  if (summary?.source === 'contract') {
    body = <Typography variant="body2">Your team has {BUSINESS.name} through an agreement with us. {talk} to change it.</Typography>
  } else if (summary?.source === 'stripe' && summary.status !== 'ended') {
    const when = billingDate(summary.endsOn || summary.renewsOn)
    let line = `Your team has ${BUSINESS.name}`
    if (summary.members) line += `, for ${summary.members} ${summary.members === 1 ? 'person' : 'people'}`
    if (summary.pastDue) line += '. The last payment did not go through: update the card to keep it.'
    else if (summary.endsOn) line += `. It stops on ${when}.`
    else if (when) line += `. It renews ${summary.interval === 'year' ? 'yearly' : 'monthly'} on ${when}.`
    else line += '.'
    body = (
      <>
        <Typography variant="body2">{line} Adding or removing a member changes the next payment, prorated. {pricing}</Typography>
        {manager && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
            <Button variant="outlined" disabled={busy} onClick={portal}>Card and receipts</Button>
            {summary.cancelAtPeriodEnd
              ? <Button variant="contained" disableElevation disabled={busy} onClick={() => renewal(true)}>Keep Business</Button>
              : <Button variant="text" disabled={busy} onClick={() => renewal(false)}>Stop renewing</Button>}
          </Box>
        )}
        {!manager && <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>The team&apos;s owner and admins manage it.</Typography>}
      </>
    )
  } else if (onSale && manager) {
    body = (
      <>
        <Typography variant="body2">{BUSINESS.summary} A shared AI and call pool for the team, and every member can invite outside agents onto slates. {pricing}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
          <Button variant="contained" disableElevation onPointerEnter={prefetchPaySheet} onClick={() => open({ action: 'business', choice: { interval: 'month' } })}>Get Business monthly</Button>
          <Button variant="outlined" onPointerEnter={prefetchPaySheet} onClick={() => open({ action: 'business', choice: { interval: 'year' } })}>Get Business yearly</Button>
        </Box>
      </>
    )
  } else if (onSale) {
    body = <Typography variant="body2">{BUSINESS.summary} The team&apos;s owner or an admin can get it for everyone here. {pricing}</Typography>
  } else {
    body = <Typography variant="body2">{BUSINESS.summary} {pricing} · {talk}</Typography>
  }

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }} data-business-panel={summary?.source || (onSale ? 'on-sale' : 'talk')}>
      <Typography variant="h6" component="h2" sx={{ mb: 0.75 }}>{BUSINESS.name}</Typography>
      {body}
      {note && <Alert severity={note.severity} sx={{ mt: 1.5 }}>{note.text}</Alert>}
    </Paper>
  )
}
