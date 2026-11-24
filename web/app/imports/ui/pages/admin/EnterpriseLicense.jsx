// Admin tools › Enterprise features, on a self-hosted install: whether the enterprise features
// (invited agents and the connectors behind them) are unlocked here, by which license, until when,
// and a button to ask Slatebox for an on-prem license. Plain words, no price. Single sign-on with
// the bundled Keycloak is free and needs no license, so it is never mentioned as locked.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { AccountActions, AccountPanel, AccountSection, COLUMN_WIDTH, FinePrint } from '../../common/AccountLayout'

export default function EnterpriseLicense() {
  const [status, setStatus] = useState(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    Meteor.callAsync('enterprise.licenseStatus').then(setStatus, (error) => setProblem(error?.reason || 'The license could not be read.'))
  }, [])
  if (problem) return <Alert severity="warning">{problem}</Alert>
  if (!status || status.edition === 'cloud') return null
  const { license } = status
  const renew = status.reason === 'grace' || status.reason === 'expired'
  return (
    <AccountPanel sx={{ maxWidth: COLUMN_WIDTH }}>
      <AccountSection title="Enterprise features" data-testid="enterprise-license" data-unlocked={status.unlocked ? 'true' : 'false'}>
        <Typography variant="body1">{status.unlocked ? 'Unlocked on this install.' : 'Locked on this install.'}</Typography>
        <Typography variant="body2">{status.words}</Typography>
        {license?.licensee && (
          <FinePrint>
            Licensed to {license.licensee}
            {status.worksUntil ? `, until ${status.worksUntil}` : ''}
            {license.hosts?.length ? ` for ${license.hosts.join(', ')}` : ''}.
          </FinePrint>
        )}
        {status.restartNeeded && <Alert severity="info">Restart the app to use the license as it is in the settings now.</Alert>}
        <FinePrint>
          Enterprise features let people invite outside agents, such as GitHub, Linear or Hugging Face, onto a slate. A license from
          Slatebox unlocks them on this install without moving to Slatebox Cloud. Single sign-on with the bundled Keycloak is free and
          needs no license.
        </FinePrint>
        {status.upgradeUrl && (!status.unlocked || renew) && (
          <AccountActions>
            <Button variant="contained" href={status.upgradeUrl} target="_blank" rel="noopener" data-testid="on-prem-license">
              {renew ? 'Renew the license' : 'Upgrade on prem'}
            </Button>
          </AccountActions>
        )}
        {!status.unlocked && (
          <FinePrint>With a license key, add it to the server settings as enterprise.license and restart the app.</FinePrint>
        )}
      </AccountSection>
    </AccountPanel>
  )
}
