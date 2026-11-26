import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../../api/common/constants'
import { BILLING_CONTACT_URL } from '../../../../api/common/contact.mjs'
import ContactLinkText from '../ContactLinkText'
import { SheetBody, SheetFooter } from './SheetParts'

// When there is nothing to pay here (design §6 blocked): the server's reason and the one thing that
// helps — confirm the email, write to us (the billing contact form) or ask a team admin, sign in,
// or use your own key (own-keys.mjs). On a server that cannot keep keys (public.ownKeys false: no
// vault key) an 'own-key' answer is shown as help.
const TEXT = {
  verify: 'Confirm your email address first. Nothing can be bought before it is confirmed.',
  help: `Write to us at ${BILLING_CONTACT_URL}, or ask a team admin to top up the team balance.`,
  'own-key': 'Top-ups are not available right now. Use your own AI or call key instead: requests on it spend no Slatebox credits.',
  'sign-in': 'Sign in to get Slatebox Pro or top up a balance.',
  none: 'There is nothing to pay for here.',
}

export default function BlockedPane({ blocked: given, onClose }) {
  const [sent, setSent] = useState(null)
  const blocked = given.kind === 'own-key' && Meteor.settings.public.ownKeys !== true ? { ...given, kind: 'help' } : given
  const verify = blocked.kind === 'verify' || blocked.code === 'unverified'
  const resend = async () => {
    setSent({ busy: true })
    try {
      const result = await Meteor.callAsync(CONSTANTS.methods.users.sendVerification)
      setSent({ text: result?.sent ? `We sent a confirmation link to ${result.address}. Open it, then come back here.` : 'Your address is confirmed. Close this and try again.' })
    } catch (err) {
      setSent({ text: err.reason || 'We could not send the email. Try again in a minute.' })
    }
  }
  return (
    <>
      <SheetBody>
        <Typography data-pay-blocked={blocked.kind}><ContactLinkText text={blocked.reason || TEXT[blocked.kind] || TEXT.none} /></Typography>
        {sent?.text && <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>{sent.text}</Typography>}
      </SheetBody>
      <SheetFooter>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {verify && <Button variant="contained" disabled={Boolean(sent)} onClick={resend}>Send the confirmation email again</Button>}
          {blocked.kind === 'own-key' && <Button variant="contained" href="/profile?tab=ai">Add your own key</Button>}
          {blocked.kind === 'sign-in' && <Button variant="contained" href="/login">Sign in</Button>}
          {blocked.kind === 'help' && <Button variant="contained" href={BILLING_CONTACT_URL} target="_blank" rel="noopener noreferrer">Write to us</Button>}
          <Button variant={verify || ['own-key', 'sign-in', 'help'].includes(blocked.kind) ? 'text' : 'contained'} onClick={onClose}>Close</Button>
        </Box>
      </SheetFooter>
    </>
  )
}

BlockedPane.propTypes = {
  blocked: PropTypes.shape({ kind: PropTypes.string, code: PropTypes.string, reason: PropTypes.string }).isRequired,
  onClose: PropTypes.func.isRequired,
}
