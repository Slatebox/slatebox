// Admin tools › Integrations, on a self-hosted install: whether integrations (outside agents and
// Google, connected once and invited onto any slate) run on this server. They are free on every
// install (owner, 2026-11-26); the card says so, and when they do not run here, why. Nothing to buy.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { AccountActions, AccountPanel, AccountSection, COLUMN_WIDTH, FinePrint } from '../../common/AccountLayout'

export default function IntegrationsStatus() {
  const [status, setStatus] = useState(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    Meteor.callAsync('enterprise.status').then(setStatus, (error) => setProblem(error?.reason || 'Whether integrations run here could not be read.'))
  }, [])
  if (problem) return <Alert severity="warning">{problem}</Alert>
  if (!status || status.edition === 'cloud') return null
  return (
    <AccountPanel sx={{ maxWidth: COLUMN_WIDTH }}>
      <AccountSection title="Integrations" data-testid="integrations-status" data-on={status.on ? 'true' : 'false'} data-reason={status.reason}>
        <Typography variant="body1">{status.words}</Typography>
        <FinePrint>
          People connect outside agents, such as GitHub, Linear or Hugging Face, and their Google account once, then invite them onto
          any slate. Free on every Slatebox install, with no key. The agent work they do runs on the agent keys set under AI.
        </FinePrint>
        {status.on && (
          <AccountActions>
            <Button variant="outlined" component={RouterLink} to="/integrations" data-testid="open-integrations">Open Integrations</Button>
          </AccountActions>
        )}
      </AccountSection>
    </AccountPanel>
  )
}
