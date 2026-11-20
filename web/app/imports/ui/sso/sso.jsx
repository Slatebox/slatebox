// "Sign in with SSO" in the browser. Public settings only (Meteor.settings.public.sso):
// { enabled, only, label }. The server does the OpenID Connect work; the browser only follows
// redirects and trades the one-time ticket from /sso/done for a Meteor session.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { useTracker } from 'meteor/react-meteor-data'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Typography } from '@mui/material'

const REFUSALS = {
  denied: 'Single sign-on was cancelled.',
  account: 'Your single sign-on account cannot be used here. Ask your administrator.',
  'no-sign-in': 'That sign-in took too long or was started elsewhere. Try again.',
}

export function useSso() {
  const sso = Meteor.settings.public?.sso
  return {
    enabled: sso?.enabled === true,
    only: sso?.enabled === true && sso?.only === true,
    label: sso?.label || 'Sign in with SSO',
  }
}

const samePath = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/')

/** The sign-in button, and the reason the last single sign-on did not work, if it did not. */
export function SsoSignIn({ next }) {
  const { enabled, label } = useSso()
  const [query] = useSearchParams()
  if (!enabled) return null
  const refused = query.get('sso')
  const start = () => window.location.assign('/sso/login?next=' + encodeURIComponent(samePath(next || query.get('next'))))
  return (
    <Box sx={{ mb: 2 }}>
      {refused ? (
        <Typography role="alert" color="error" variant="body2" sx={{ mb: 1 }}>
          {REFUSALS[refused] || 'Single sign-on did not work. Try again, or ask your administrator.'}
        </Typography>
      ) : null}
      <Button id="ssoSignIn" type="button" fullWidth variant="contained" color="primary" onClick={start}>
        {label} &rarr;
      </Button>
    </Box>
  )
}

/** /sso/done#ticket=…&next=… : finish the sign-in the server started. */
export function SsoDone() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const ticket = fragment.get('ticket')
    const next = samePath(fragment.get('next'))
    // The ticket works once; keep it out of the history and of anything that reads the address.
    window.history.replaceState(null, '', '/sso/done')
    if (!ticket) { setFailed(true); return }
    Accounts.callLoginMethod({
      methodArguments: [{ ssoTicket: ticket }],
      userCallback: (error) => (error ? setFailed(true) : navigate(next, { replace: true })),
    })
  }, [navigate])
  if (failed) return <Navigate replace to="/login?sso=no-sign-in" />
  return <Box component="main" sx={{ p: 3 }}><Typography role="status">Signing you in…</Typography></Box>
}

const OPEN_PATHS = [/^\/login(\/|$)/, /^\/sso\//]

/** Under "SSO only", everything but the sign-in page needs a signed-in, non-guest account. */
export function SsoGate() {
  const { only } = useSso()
  const location = useLocation()
  const { user, pending } = useTracker(() => ({ user: Meteor.user(), pending: Meteor.loggingIn() || (Meteor.userId() && !Meteor.user()) }), [])
  if (!only || pending) return null
  if (user && !user.isAnonymous) return null
  if (OPEN_PATHS.some(path => path.test(location.pathname))) return null
  const next = location.pathname + location.search
  return <Navigate replace to={'/login?next=' + encodeURIComponent(next)} />
}
