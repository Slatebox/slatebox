import React, { useCallback, useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import WorkspacePremiumOutlinedIcon from '@mui/icons-material/WorkspacePremiumOutlined'
import CONSTANTS from '../../../api/common/constants'
import { Organizations } from '../../../api/common/models'
import { PRICING_URL } from '../../../api/common/contact.mjs'
import { BUSINESS } from '../../../api/business/catalog.mjs'
import { usePaySheet, prefetchPaySheet } from '../billing/pay/PaySheetHost'
import { newAttempt, paymentsHere } from '../billing/pay/pay-env'
import { billingDate } from '../billing/billing-date.mjs'

// Slatebox Business on the team page, as a compact card (status, plan, members, renewal): get it for the team (owner or admin, where the server sells
// it), see where it stands, stop or keep renewing, and the card and receipts. No amount is written
// here: the sheet shows Stripe's, and "See pricing" links the pricing page.
// chip colors with AA contrast on the cream card, light and dark
const TONE = {
  on: (theme) => ({ bgcolor: '#dce9ce', color: '#183d28', ...theme.applyStyles('dark', { bgcolor: '#3c5344', color: '#e5f1dc' }) }),
  warn: (theme) => ({ bgcolor: '#fbecc8', color: '#5c3d00', ...theme.applyStyles('dark', { bgcolor: '#5a4519', color: '#ffe7b3' }) }),
  off: (theme) => ({ bgcolor: '#e9ebe4', color: '#3b4a40', ...theme.applyStyles('dark', { bgcolor: '#3a4a40', color: '#e3e8df' }) }),
}

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
    // Slatebox Business is Slatebox Cloud's: a server without payments shows no panel at all
    if (!paymentsHere()) return
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

  // what the card says, by state: a status chip, one line of facts, the actions, and the fine print
  let status
  let facts
  let actions = null
  let fine = null
  if (summary?.source === 'contract') {
    status = { label: 'Active', tone: 'on' }
    facts = 'Through an agreement with us.'
    fine = <>{talk} to change it.</>
  } else if (summary?.source === 'stripe' && summary.status !== 'ended') {
    const when = billingDate(summary.endsOn || summary.renewsOn)
    const parts = [summary.interval === 'year' ? 'Yearly' : 'Monthly']
    if (summary.members) parts.push(`${summary.members} ${summary.members === 1 ? 'member' : 'members'}`)
    if (summary.pastDue) parts.push('The last payment did not go through: update the card to keep it.')
    else if (summary.endsOn) parts.push(`Stops on ${when}`)
    else if (when) parts.push(`Renews on ${when}`)
    status = { label: 'Active', tone: 'on' }
    if (summary.endsOn) status = { label: 'Ending', tone: 'warn' }
    if (summary.pastDue) status = { label: 'Payment problem', tone: 'warn' }
    facts = parts.join(' · ')
    fine = <>You pay for members who have joined: invitations not yet accepted are not counted. {summary.interval === 'year' ? 'A member who joins is charged at once for the rest of the year; one who leaves becomes a credit on the next payment.' : 'A member who joins or leaves changes the next payment, prorated.'} {pricing}</>
    actions = manager ? (
      <>
        <Button variant="outlined" size="small" disabled={busy} onClick={portal}>Card and receipts</Button>
        {summary.cancelAtPeriodEnd
          ? <Button variant="contained" size="small" disableElevation disabled={busy} onClick={() => renewal(true)}>Keep Business</Button>
          : <Button variant="text" size="small" disabled={busy} onClick={() => renewal(false)}>Stop renewing</Button>}
      </>
    ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>The team&apos;s owner and admins manage it.</Typography>
  } else if (onSale && manager) {
    status = { label: 'Not active', tone: 'off' }
    facts = 'A shared AI and call pool for the team, and every member can invite outside agents onto slates.'
    fine = <>{BUSINESS.summary} You pay for the {offer.members} {offer.members === 1 ? 'member who has' : 'members who have'} joined; invitations not yet accepted are not counted until they are. {pricing}</>
    actions = (
      <>
        <Button variant="contained" size="small" disableElevation onPointerEnter={prefetchPaySheet} onClick={() => open({ action: 'business', choice: { interval: 'month' } })}>Get Business monthly</Button>
        <Button variant="outlined" size="small" onPointerEnter={prefetchPaySheet} onClick={() => open({ action: 'business', choice: { interval: 'year' } })}>Get Business yearly</Button>
      </>
    )
  } else if (onSale) {
    status = { label: 'Not active', tone: 'off' }
    facts = 'The team\'s owner or an admin can get it for everyone here.'
    fine = <>{BUSINESS.summary} {pricing}</>
  } else {
    status = { label: 'Not active', tone: 'off' }
    facts = BUSINESS.summary
    fine = <>{pricing} · {talk}</>
  }

  return (
    <Box component="section" aria-labelledby="business-panel-title" data-business-panel={summary?.source || (onSale ? 'on-sale' : 'talk')}
      sx={(theme) => ({ bgcolor: 'shell.surface', border: '1px solid', borderColor: 'shell.border', borderRadius: '14px', p: { xs: 1.75, sm: 2 },
        ...theme.applyStyles('dark', { bgcolor: 'background.paper' }) })}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Box aria-hidden sx={{ width: 40, height: 40, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: 'shell.selected', color: 'shell.selectedInk', flex: '0 0 auto' }}>
          <WorkspacePremiumOutlinedIcon />
        </Box>
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography id="business-panel-title" component="h2" sx={{ fontWeight: 700, fontSize: 17 }}>{BUSINESS.name}</Typography>
            <Chip size="small" label={status.label} sx={TONE[status.tone]} data-business-status={status.tone} />
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>{facts}</Typography>
        </Box>
        {actions && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</Box>}
      </Box>
      {fine && <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.25, mb: 0, lineHeight: 1.5 }}>{fine}</Typography>}
      {note && <Alert severity={note.severity} sx={{ mt: 1.5 }}>{note.text}</Alert>}
    </Box>
  )
}
