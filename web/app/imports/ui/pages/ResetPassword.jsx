import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Container from '@mui/material/Container'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../api/common/constants'

export default function ResetPassword({ asEnroll = false }) {
  const navigate = useNavigate()
  const { token } = useParams()
  const userId = useTracker(() => Meteor.userId(), [])
  const [recipient, setRecipient] = useState(null)
  const [lookupError, setLookupError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (userId) return undefined
    let active = true
    setRecipient(null)
    setLookupError('')
    Meteor.callAsync(CONSTANTS.methods.users.extractUserAndOrgNamesByResetToken, token)
      .then((details) => {
        if (!active) return
        if (details) setRecipient(details)
        else setLookupError(asEnroll
          ? 'This invitation has expired or has already been used. Ask your team administrator for a new invitation.'
          : 'This reset link has expired or has already been used.')
      })
      .catch(() => {
        if (active) setLookupError('Slatebox could not check this link. Reload the page to try again.')
      })
    return () => { active = false }
  }, [token, asEnroll, userId])

  const mismatch = confirmation !== '' && password !== confirmation
  const submit = (event) => {
    event.preventDefault()
    if (submitting || !recipient || !password || password !== confirmation) return
    setSubmitting(true)
    setSubmitError('')
    Accounts.resetPassword(token, password, (error) => {
      if (error) {
        setSubmitting(false)
        setSubmitError(error.reason || 'Your password could not be set. Please try again.')
        return
      }
      navigate(Meteor.userId() ? (asEnroll ? '/team/slates' : '/') : '/login', { replace: true })
    })
  }

  const title = asEnroll ? (recipient?.orgName ? `Join ${recipient.orgName}` : 'Join your team') : 'Reset your password'
  return (
    <Container maxWidth="xs" sx={{ py: { xs: 4, sm: 8 } }}>
      <Stack spacing={3}>
        <Typography component="h1" variant="h4" color="text.primary">{title}</Typography>
        {userId && !submitting ? (
          <>
            <Typography>You’re signed in to Slatebox. To use this email link with another account, open it in a private browser window.</Typography>
            <Link component={RouterLink} to="/">Return to my slates</Link>
          </>
        ) : lookupError ? (
          <>
            <Alert severity="error">{lookupError}</Alert>
            <Link component={RouterLink} to={asEnroll ? '/login' : '/recover'}>{asEnroll ? 'Sign in' : 'Request another reset link'}</Link>
          </>
        ) : !recipient ? (
          <Typography role="status">Checking your link…</Typography>
        ) : (
          <Stack component="form" spacing={2} onSubmit={submit}>
            <Typography>{asEnroll ? 'Set your password to open your team’s slates.' : 'Choose a new password for your Slatebox account.'}</Typography>
            <TextField required fullWidth id="password" label="New password" name="password"
              type="password" autoComplete="new-password" value={password}
              onChange={(event) => setPassword(event.target.value)} />
            <TextField required fullWidth id="confirm-password" label="Confirm password" name="confirm-password"
              type="password" autoComplete="new-password" value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} error={mismatch}
              helperText={mismatch ? 'Enter the same password in both fields.' : undefined} />
            {submitError && <Alert severity="error">{submitError}</Alert>}
            <Button type="submit" variant="contained" disabled={submitting || !password || password !== confirmation}>
              {asEnroll ? 'Join team' : 'Reset password'}
            </Button>
          </Stack>
        )}
      </Stack>
    </Container>
  )
}

ResetPassword.propTypes = {
  asEnroll: PropTypes.bool,
}
