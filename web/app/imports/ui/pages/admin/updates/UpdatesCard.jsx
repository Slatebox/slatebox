// Admin tools › Updates (self-hosted only): the version this server runs, whether a newer one is
// available, and the way to Admin › Updates.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../../api/common/constants'
import { AccountSection, FinePrint } from '../../../common/AccountLayout'
import { updaterLine } from './updates-view.mjs'

export default function UpdatesCard() {
  const [status, setStatus] = React.useState(null)
  React.useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.updates.status).then((answer) => { if (live) setStatus(answer) }, () => { if (live) setStatus(null) })
    return () => { live = false }
  }, [])
  const line = status ? (status.available ? `Slatebox ${status.available.version} is available (this server runs ${status.current.version || 'a local build'}).` : `This server runs Slatebox ${status.current.version || '(a local build)'}. ${status.decision?.words || ''}`) : 'New versions of Slatebox from GitHub, and when this server applies them.'
  return (
    <AccountSection title="Updates" data-testid="admin-updates-card">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Typography>{line}</Typography>
        <Button variant="contained" component={RouterLink} to="/admin/updates">Open Updates</Button>
      </Box>
      {status && <FinePrint>{updaterLine(status).text}</FinePrint>}
    </AccountSection>
  )
}
