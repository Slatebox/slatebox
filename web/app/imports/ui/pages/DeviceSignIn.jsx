import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../api/common/constants'
import BrandBar from '../common/BrandBar'
import { deviceCodeFromQuery } from '../../api/common/login-return.mjs'
import { AccountActions, AccountNote, AccountPage, AccountPanel, AccountSection, FinePrint } from '../common/AccountLayout'

// /device?code=XXXX-XXXX: the slatebox command on another computer (npx slatebox install) asked
// to sign in as this person (server/oauth/device.mjs). The person types or confirms the code their
// terminal shows, sees which computer asks, from where, and exactly what it gets, and approves or
// denies. Nothing is sent back to a browser address: the command polls for its answer.
export default function DeviceSignIn() {
  const [query] = useSearchParams()
  const { user, loggingIn } = useTracker(() => ({ user: Meteor.user(), loggingIn: Meteor.loggingIn() }), [])
  const [code, setCode] = React.useState(deviceCodeFromQuery(query) || '')
  const [request, setRequest] = React.useState(undefined)
  const [done, setDone] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const framed = typeof window !== 'undefined' && window.top !== window.self

  const look = async (event) => {
    event?.preventDefault()
    setBusy(true)
    setError('')
    try {
      const found = await Meteor.callAsync(CONSTANTS.methods.oauth.deviceDescribe, { userCode: code })
      setRequest(found)
      if (!found) setError('That code is not waiting. Check the code in your terminal, or start again there.')
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
    }
    setBusy(false)
  }

  const answer = async (allow) => {
    setBusy(true)
    setError('')
    try {
      await Meteor.callAsync(CONSTANTS.methods.oauth.deviceDecide, { userCode: code, allow })
      setDone(allow ? 'approved' : 'denied')
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
    }
    setBusy(false)
  }

  const shown = deviceCodeFromQuery(new URLSearchParams({ code })) || ''
  const signIn = `/login?device=${encodeURIComponent(shown || '1')}`
  let body
  if (framed) {
    body = <Alert severity="error">Open this page in its own browser tab to sign in a device.</Alert>
  } else if (loggingIn) {
    body = <FinePrint>Loading…</FinePrint>
  } else if (!user || user.isAnonymous) {
    body = (
      <AccountSection title="Sign in to continue">
        <Typography>
          A Slatebox command on another computer wants to sign in as you. Sign in with your Slatebox account first;
          {user?.isAnonymous ? ' a guest account cannot approve a sign-in.' : ' you come back here after.'}
        </Typography>
        <AccountActions>
          <Button variant="contained" component={RouterLink} to={signIn}>Sign in</Button>
        </AccountActions>
      </AccountSection>
    )
  } else if (done) {
    body = (
      <AccountSection title={done === 'approved' ? 'Approved' : 'Denied'} data-testid="device-done" data-outcome={done}>
        <Typography>
          {done === 'approved' ? 'Your terminal continues on its own. You can close this tab.' : 'Nothing was granted. You can close this tab.'}
        </Typography>
      </AccountSection>
    )
  } else if (!request) {
    body = (
      <AccountSection title="Enter the code from your terminal">
        <Box component="form" onSubmit={look} sx={{ display: 'grid', gap: 2, maxWidth: 360 }}>
          <TextField
            label="Code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            inputProps={{ 'data-testid': 'device-code', autoCapitalize: 'characters', autoComplete: 'off', spellCheck: false, maxLength: 12 }}
            placeholder="WDJB-MJHT"
            autoFocus
          />
          {error && <Alert severity="error">{error}</Alert>}
          <AccountActions>
            <Button type="submit" variant="contained" disabled={busy || !shown} data-testid="device-continue">Continue</Button>
          </AccountActions>
        </Box>
      </AccountSection>
    )
  } else {
    const from = [request.label && `"${request.label}"`, request.region && `(${request.region})`].filter(Boolean).join(' ')
    body = (
      <AccountSection title={`${request.client}${from ? ` on ${from}` : ''} wants to:`} data-testid="device-consent">
        {request.grants.map((grant) => (
          <Typography key={grant} variant="body1">{grant[0].toUpperCase() + grant.slice(1)}.</Typography>
        ))}
        <Typography variant="body2">{request.cannot}</Typography>
        <AccountNote>
          <Typography variant="subtitle2">Only approve if you started this yourself, just now.</Typography>
          <FinePrint>The code on this page must match the one in your terminal: {shown}.</FinePrint>
        </AccountNote>
        {error && <Alert severity="error">{error}</Alert>}
        <AccountActions>
          <Button variant="contained" onClick={() => answer(true)} disabled={busy} data-testid="device-approve">Approve</Button>
          <Button variant="outlined" onClick={() => answer(false)} disabled={busy} data-testid="device-deny">Deny</Button>
        </AccountActions>
        <FinePrint>Signed in as {user.emails?.[0]?.address || 'you'}.</FinePrint>
      </AccountSection>
    )
  }

  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default' }}>
      <BrandBar />
      <Box sx={{ maxWidth: 760, mx: 'auto', px: 3, pt: { xs: 2, sm: 3 } }}>
        <AccountPage title="Sign in a device">
          <AccountPanel>{body}</AccountPanel>
        </AccountPage>
      </Box>
    </Box>
  )
}
