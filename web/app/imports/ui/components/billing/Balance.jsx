import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import CONSTANTS from '../../../api/common/constants'
import { prefetchPaySheet, usePaySheet } from './pay/PaySheetHost'
import Charges from './Charges'
import { dollars, refundConfirmText } from './money'
import { AccountActions, AccountSection } from '../../common/AccountLayout'
import ContactLinkText from './ContactLinkText'
import { BILLING_CONTACT_URL } from '../../../api/common/contact.mjs'

// A balance (yours or your team's): what is in it, top up (in the pay sheet), refund, and the
// charges list.
export default function Balance({ wallet, summary, onChange }) {
  const { open } = usePaySheet()
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [chargesKey, setChargesKey] = useState(0)
  const team = wallet === 'team'
  const cents = (team ? summary.teamBalanceCents : summary.balanceCents) || 0
  const refundable = (team ? summary.teamRefundableCents : summary.refundableCents) || 0
  const canPay = summary.topUpsAvailable && (!team || summary.teamAdmin)
  const verified = summary.emailVerified
  const [confirming, setConfirming] = useState(false)

  useEffect(() => { setChargesKey(k => k + 1) }, [cents])

  const refund = async () => {
    setConfirming(false)
    setBusy(true)
    setMessage(null)
    try {
      const { refundedCents } = await Meteor.callAsync(CONSTANTS.methods.wallet.refund, { wallet })
      const closed = Math.max(0, cents - refundedCents)
      setMessage({ severity: 'info', text: `${dollars(refundedCents)} is on its way back to your card.${closed ? ` The other ${dollars(closed)} is no longer in the balance.` : ''}` })
      onChange?.()
    } catch (err) {
      setMessage({ severity: 'warning', text: err.reason || `We could not refund the balance. Try again or write to us at ${BILLING_CONTACT_URL}.` })
    }
    setBusy(false)
  }

  return (
    <AccountSection title={<>{team ? 'Team balance' : 'Balance'}: {dollars(cents)}</>}>
      <Typography>
        Used after {team ? 'each member’s' : 'your'} Pro credits, or on its own without Pro, at the provider's price plus {summary.marginPercent}%. It never expires.
      </Typography>
      {!team && summary.frozen && <Alert severity="warning"><ContactLinkText text={`Your balance is on hold. Write to us at ${BILLING_CONTACT_URL}.`} /></Alert>}
      {canPay && (
        <AccountActions>
          {verified
            ? <Button variant="contained" onPointerEnter={prefetchPaySheet} onClick={() => open({ action: 'topup', wallet })}>Top up</Button>
            : <Typography variant="body2">Confirm your email address to top up.</Typography>}
          {/* a refund needs no confirmed address: a balance can always go back */}
          {cents > 0 && <Button variant="outlined" disabled={busy} onClick={() => setConfirming(true)}>{team ? 'Refund the team balance' : 'Refund my balance'}</Button>}
        </AccountActions>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>{team ? 'Refund the team balance?' : 'Refund your balance?'}</DialogTitle>
        <DialogContent>
          <Typography>{refundConfirmText({ balanceCents: cents, refundableCents: refundable, team })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Keep the balance</Button>
          <Button variant="contained" disabled={busy} onClick={refund}>{refundable < cents ? `Refund ${dollars(Math.min(refundable, cents))} and close the rest` : `Refund ${dollars(cents)}`}</Button>
        </DialogActions>
      </Dialog>
      {message && <Alert severity={message.severity}><ContactLinkText text={message.text} /></Alert>}
      <Charges wallet={wallet} key={chargesKey} />
    </AccountSection>
  )
}

Balance.propTypes = {
  wallet: PropTypes.oneOf(['me', 'team']).isRequired,
  summary: PropTypes.object.isRequired,
  onChange: PropTypes.func,
}
