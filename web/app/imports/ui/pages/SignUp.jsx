// Create an account, from the sign-in page. An account starts as a guest (the server makes one and
// signs it in), and the account form turns it into an account with an email and a password, the
// same way "Save your work" does. The form opens over My slates, so closing it leaves a person
// somewhere useful: their (empty) slates, as a guest.
import React, { useEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Navigate } from 'react-router-dom'
import { useSetAtom } from 'jotai'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { registrationDetails } from '../jotai/atoms'

export default function SignUp() {
  const setRegistration = useSetAtom(registrationDetails)
  const { user, loggingIn } = useTracker(() => ({ user: Meteor.user(), loggingIn: Meteor.loggingIn() }), [])
  const started = useRef(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const hasAccount = Boolean(user && user.isAnonymous === false)

  // Signing the new guest in changes loggingIn, so the start is guarded by `started`, and only
  // leaving the page (not a re-run of the effect) stops it from opening the form.
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (loggingIn || hasAccount || started.current) return
    started.current = true
    ;(async () => {
      if (!Meteor.userId()) await createAnonymousUser()
      if (!mounted.current) return
      setRegistration({ type: 'registration', registrationOpen: true, intent: 'signup', registrationMessage: '' })
      setReady(true)
    })().catch(() => { if (mounted.current) { started.current = false; setFailed(true) } })
  }, [loggingIn, hasAccount, attempt, setRegistration])

  if (hasAccount || ready) return <Navigate replace to="/" />
  return (
    <Box sx={{ minHeight: 'calc(100svh - 160px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {failed ? (
        <>
          <Typography role="alert" sx={{ color: 'text.primary' }}>Your account could not be started. Check your connection and try again.</Typography>
          <Button variant="outlined" onClick={() => { setFailed(false); setAttempt((n) => n + 1) }}>Try again</Button>
        </>
      ) : (
        <>
          <CircularProgress size={28} />
          <Typography role="status" sx={{ color: 'text.secondary' }}>Getting your account ready…</Typography>
        </>
      )}
    </Box>
  )
}
