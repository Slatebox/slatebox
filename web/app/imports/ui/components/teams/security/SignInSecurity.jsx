// Team settings > Sign-in & security: reads the team's single sign-on (teamSso.get) and hands each
// card the one way to change it (act: a teamSso.* method, whose answer is the new state).
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import SsoConnectionsCard from './SsoConnectionsCard'
import BusinessGateNotice, { useBusinessAccess } from './BusinessGate'
import { businessGate } from './business-gate-model.mjs'

export default function SignInSecurity({ noun }) {
  const [view, setView] = React.useState(null)
  const [error, setError] = React.useState('')
  const [attempt, setAttempt] = React.useState(0)
  const access = useBusinessAccess()
  React.useEffect(() => {
    let live = true
    setError('')
    Meteor.callAsync('teamSso.get').then((v) => live && setView(v)).catch((err) => live && setError(err?.reason || 'The sign-in settings could not be read.'))
    return () => { live = false }
  }, [attempt])
  const act = React.useCallback(async (method, input) => {
    const next = await Meteor.callAsync(method, input)
    if (next?.connections) setView(next)
    return next
  }, [])
  if (error) return <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}>{error}</Alert>
  if (!view) return <Typography variant="body2" color="text.secondary">Reading the {noun}&apos;s sign-in settings…</Typography>
  const origin = String(Meteor.settings.public?.baseUrl || window.location.origin).replace(/\/$/, '')
  return (
    <>
      <BusinessGateNotice gate={businessGate({ feature: 'sso', available: view.available, kept: view.connections?.length > 0, noun, ...access })} />
      {view.available && !view.secretsAvailable && (
        <Alert severity="warning">
          This server has no SLATEBOX_KEY_ENCRYPTION_KEY, so it cannot keep an OpenID Connect client secret. SAML connections work without it.
        </Alert>
      )}
      <SsoConnectionsCard view={view} act={act} origin={origin} noun={noun} />
    </>
  )
}
SignInSecurity.propTypes = { noun: PropTypes.string.isRequired }
