import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import Balance from './Balance'
import OwnKeys from './OwnKeys'
import { AccountPanel, AccountSection } from '../../common/AccountLayout'

// Team settings: the shared balance and, where own keys are on (summary.ownKeysAvailable,
// own-keys.mjs), the team's own keys. Admins change them; members read.
export default function TeamBalance() {
  const [summary, setSummary] = useState(null)
  const load = () => Meteor.callAsync(CONSTANTS.methods.meter.summary).then(setSummary).catch(() => setSummary(null))
  useEffect(() => { load() }, [])
  if (!summary?.metered) return null
  return (
    <AccountPanel>
      <Typography>
        {summary.ownKeysAvailable
          ? 'Team keys are optional and free to use. A request one of them serves spends no Slatebox credits, with or without Pro, for every member who has no key of their own. A team balance is used by every member after their own Pro credits, when they have no balance of their own.'
          : 'A team balance is used by every member after their own Pro credits, when they have no balance of their own. Members without Pro use it too.'}
      </Typography>
      <Balance wallet="team" summary={summary} onChange={load} />
      {summary.ownKeysAvailable && (
        <AccountSection title="Use the team's own key">
          <OwnKeys owner="team" onChange={load} />
        </AccountSection>
      )}
    </AccountPanel>
  )
}
