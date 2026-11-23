import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../api/common/constants'
import BrandBar from '../common/BrandBar'
import { tokenPermissions } from '../../api/common/token-permissions.mjs'
import { AccountActions, AccountNote, AccountPage, AccountPanel, AccountSection, FinePrint, SPACE } from '../common/AccountLayout'

// /oauth/consent?request=<id>: an MCP app (Claude, ChatGPT, an editor) asked to act as this
// person on the hosted MCP endpoint. The server checked the app and where it returns; the person
// sees its name (which the app chose itself), that address, and each permission, and allows or
// denies. Allowing sends the browser back to the app with a one-time code (server/oauth).
export default function OAuthConsent() {
  const [query] = useSearchParams()
  const requestId = query.get('request') || ''
  const { user, loggingIn } = useTracker(() => ({ user: Meteor.user(), loggingIn: Meteor.loggingIn() }), [])
  const [request, setRequest] = React.useState(undefined)
  const [chosen, setChosen] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  // A consent page inside someone else's frame could be clicked through without being seen.
  const framed = typeof window !== 'undefined' && window.top !== window.self

  React.useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.oauth.describe, { requestId })
      .then((found) => {
        if (!live) return
        setRequest(found)
        setChosen(found ? found.scopes : [])
      })
      .catch((requestError) => live && setError(requestError.reason || requestError.message))
    return () => {
      live = false
    }
  }, [requestId])

  const answer = async (allow) => {
    setBusy(true)
    setError('')
    try {
      const decided = await Meteor.callAsync(CONSTANTS.methods.oauth.decide, { requestId, allow, scopes: chosen })
      window.location.assign(decided.redirectTo)
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
      setBusy(false)
    }
  }

  const signIn = `/login?oauth=${encodeURIComponent(requestId)}`
  let body
  if (framed) {
    body = <Alert severity="error">Open this page in its own browser tab to connect an app.</Alert>
  } else if (request === undefined || loggingIn) {
    body = <FinePrint>Loading…</FinePrint>
  } else if (request === null) {
    body = (
      <AccountSection title="This request has ended">
        <Typography>
          It was already answered or waited more than ten minutes. Start connecting again from the app.
        </Typography>
      </AccountSection>
    )
  } else if (!user || user.isAnonymous) {
    body = (
      <AccountSection title={`Sign in to connect ${request.client.name}`}>
        <Typography>
          {request.client.name} wants to use Slatebox for you. Sign in with your Slatebox account first;
          {user?.isAnonymous ? ' a guest account cannot connect apps.' : ' you come back here after.'}
        </Typography>
        <AccountActions>
          <Button variant="contained" component={RouterLink} to={signIn}>Sign in</Button>
        </AccountActions>
      </AccountSection>
    )
  } else {
    const offered = tokenPermissions.filter(({ scope }) => request.scopes.includes(scope))
    body = (
      <>
        <AccountSection title={`Allow ${request.client.name} to use your Slatebox?`}>
          <Typography>
            It acts as you, with the permissions you tick below, on the slates you can open. You can
            disconnect it at any time in Profile → Developer.
          </Typography>
          <AccountNote>
            <Typography variant="subtitle2">After you answer, you go back to {request.client.redirectHost}</Typography>
            <FinePrint>
              Slatebox has not checked this app. The name above is the one the app gave. Allow it only if you
              started connecting it just now.
            </FinePrint>
          </AccountNote>
        </AccountSection>
        <AccountSection title="Permissions">
          <Box component="fieldset" disabled={busy} sx={{ border: 0, m: 0, p: 0, display: 'grid', gap: SPACE.hair }}>
            <Typography component="legend" variant="subtitle2" sx={{ mb: SPACE.tight }}>
              {request.client.name} asked for
            </Typography>
            {offered.map(({ scope, label }) => (
              <FormControlLabel
                key={scope}
                label={label}
                control={(
                  <Checkbox
                    size="small"
                    checked={chosen.includes(scope)}
                    onChange={(event) => {
                      const { checked } = event.target
                      setChosen((current) => (checked ? [...current, scope] : current.filter((item) => item !== scope)))
                    }}
                  />
                )}
              />
            ))}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          <AccountActions>
            <Button variant="contained" onClick={() => answer(true)} disabled={busy || !chosen.length}>
              Allow
            </Button>
            <Button variant="outlined" onClick={() => answer(false)} disabled={busy}>
              Deny
            </Button>
          </AccountActions>
          <FinePrint sx={{ mt: SPACE.text }}>Signed in as {user.emails?.[0]?.address || 'you'}.</FinePrint>
        </AccountSection>
      </>
    )
  }

  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default' }}>
      <BrandBar />
      <Box sx={{ maxWidth: 760, mx: 'auto', px: 3, pt: { xs: 2, sm: 3 } }}>
        <AccountPage title="Connect an app">
          <AccountPanel>
            {error && (request === undefined || request === null || !user) && <Alert severity="error">{error}</Alert>}
            {body}
          </AccountPanel>
        </AccountPage>
      </Box>
    </Box>
  )
}
