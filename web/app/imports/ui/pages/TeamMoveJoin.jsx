import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import BrandBar from '../common/BrandBar'
import { AccountActions, AccountPage, AccountPanel, AccountSection, FinePrint } from '../common/AccountLayout'

// /team-move/join?token=…: a team moved to this server, and this person already had an account
// here, so instead of a new account they got an invitation to join (server/team-export/invite.mjs).
// Signed in as that account, they accept (teamMove.join) and take their seat: their slates and
// comments from the old server become theirs. Nothing changes until they press Join.
export default function TeamMoveJoin() {
  const [query] = useSearchParams()
  const token = /^[A-Za-z0-9_-]{43}$/.test(query.get('token') || '') ? query.get('token') : null
  const { user, loggingIn } = useTracker(() => ({ user: Meteor.user(), loggingIn: Meteor.loggingIn() }), [])
  const [done, setDone] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  const accept = async () => {
    setBusy(true)
    setError('')
    try {
      setDone(await Meteor.callAsync('teamMove.join', { token }))
    } catch (failure) {
      setError(failure.reason || failure.message)
    }
    setBusy(false)
  }

  let body
  if (!token) {
    body = <Alert severity="error">This invitation link is not complete. Open it again from the email.</Alert>
  } else if (loggingIn) {
    body = <FinePrint>Loading…</FinePrint>
  } else if (!user || user.isAnonymous) {
    body = (
      <AccountSection title="Sign in to accept">
        <Typography>Your team moved to this Slatebox server. Sign in with the account the invitation was sent to; you come back here after.</Typography>
        <AccountActions>
          <Button variant="contained" component={RouterLink} to={`/login?join=${encodeURIComponent(token)}`} data-testid="join-sign-in">Sign in</Button>
        </AccountActions>
      </AccountSection>
    )
  } else if (done) {
    body = (
      <AccountSection title="You joined the team" data-testid="join-done">
        <Typography>{done.teamName ? `You are in ${done.teamName} now.` : 'You are in the team now.'} Your slates and comments from the old server are yours here.</Typography>
        <AccountActions>
          {/* A full load: the open session picks up its new team at once. */}
          <Button variant="contained" component="a" href="/">Open Slatebox</Button>
        </AccountActions>
      </AccountSection>
    )
  } else {
    body = (
      <AccountSection title="Join your team here" data-testid="join-consent">
        <Typography>
          Your team moved to this Slatebox server, and you were invited to join it with this account. Join, and the slates and
          comments you made on the old server become yours here.
        </Typography>
        <FinePrint>Signed in as {user.emails?.[0]?.address || 'you'}. Not expecting this? Close this tab: nothing changes.</FinePrint>
        {error && <Alert severity="error">{error}</Alert>}
        <AccountActions>
          <Button variant="contained" onClick={accept} disabled={busy} data-testid="join-accept">Join the team</Button>
        </AccountActions>
      </AccountSection>
    )
  }

  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default' }}>
      <BrandBar />
      <Box sx={{ maxWidth: 760, mx: 'auto', px: 3, pt: { xs: 2, sm: 3 } }}>
        <AccountPage title="Join a moved team">
          <AccountPanel>{body}</AccountPanel>
        </AccountPage>
      </Box>
    </Box>
  )
}
