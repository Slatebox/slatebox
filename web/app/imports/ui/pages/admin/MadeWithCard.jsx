// Admin › Overview › Made with Slatebox mark (a self-hosted server only): whether shared slates,
// embeds, presentations and library items here show the small "Made with Slatebox" link. Slatebox
// Cloud always shows it, so the server answers canHide only on a self-hosted server and this card
// draws nothing elsewhere.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { MADE_WITH_ADMIN } from '../../../api/common/made-with.mjs'
import { AccountSection, FinePrint } from '../../common/AccountLayout'
import { madeWithEnabled } from '../../components/MadeWithSlatebox'

const M = CONSTANTS.methods.madeWith

export default function MadeWithCard() {
  const [status, setStatus] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    Meteor.callAsync(M.status).then((answer) => { if (live) setStatus(answer) }, () => { if (live) setStatus(null) })
    return () => { live = false }
  }, [])
  if (!status?.canHide) return null
  const change = async (event) => {
    const shown = event.target.checked
    setBusy(true)
    setError('')
    try {
      const answer = await Meteor.callAsync(M.setHidden, !shown)
      setStatus({ ...status, enabled: answer.enabled })
      madeWithEnabled.forget()
    } catch (err) {
      setError(err?.reason || 'That did not save. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <AccountSection title={MADE_WITH_ADMIN.title} data-testid="admin-made-with-card">
      <Typography>{MADE_WITH_ADMIN.detail}</Typography>
      <FormControlLabel sx={{ mt: 1 }}
        control={<Switch checked={status.enabled} onChange={change} disabled={busy} inputProps={{ 'data-made-with-switch': '' }} />}
        label={status.enabled ? MADE_WITH_ADMIN.on : MADE_WITH_ADMIN.off} />
      {error && <FinePrint role="alert">{error}</FinePrint>}
    </AccountSection>
  )
}
