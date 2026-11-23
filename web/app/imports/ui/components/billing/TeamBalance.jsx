import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import Balance from './Balance'
import OwnKeys from './OwnKeys'
import { AccountPanel, AccountSection } from '../../common/AccountLayout'

// Team settings: the shared balance and (self-hosted Slatebox only, summary.ownKeysAvailable) the
// team's own keys. Admins change them; members read. Slatebox Cloud shows the balance alone.
export default function TeamBalance() {
  const [summary, setSummary] = useState(null)
  const load = () => Meteor.callAsync(CONSTANTS.methods.meter.summary).then(setSummary).catch(() => setSummary(null))
  useEffect(() => { load() }, [])
  if (!summary?.metered) return null
  return (
    <AccountPanel>
      <Typography>
        {summary.ownKeysAvailable
          ? 'A team balance and team keys are used by every member after their own Pro credits, when they have no balance or key of their own. Members without Pro use them too.'
          : 'A team balance is used by every member after their own Pro credits, when they have no balance of their own. Members without Pro use it too.'}
      </Typography>
      <Balance wallet="team" summary={summary} onChange={load} />
      {summary.ownKeysAvailable && (
        <AccountSection title="Team keys">
          <OwnKeys owner="team" onChange={load} />
        </AccountSection>
      )}
    </AccountPanel>
  )
}
