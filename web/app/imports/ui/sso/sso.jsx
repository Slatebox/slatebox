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
  'no-sign-in': 'That sign-in took too long or was started in another browser or tab. Try again.',
}

export function useSso() {
  const sso = Meteor.settings.public?.sso
  return {
    enabled: sso?.enabled === true,
    only: sso?.enabled === true && sso?.only === true,
    label: sso?.label || 'Sign in with SSO',
  }
}

// When the server ends a session (single sign-on access was removed), it closes the connection
// and refuses the tab's resume on reconnect. Meteor's client can then keep showing the old account
// with its method queue stalled, so watch for that refusal and sign the tab out with a reload.
if (Meteor.isClient && Meteor.settings.public?.sso?.enabled) {
  Meteor.connection._stream.on('message', (raw) => {
    if (typeof raw !== 'string' || !raw.includes('"error"') || !Meteor.userId()) return
    let message
    try { message = JSON.parse(raw) } catch { return }
    const refused = message?.msg === 'result' && message.error?.error === 403 &&
      /logged out by the server|no longer has access/i.test(message.error.reason || '')
    if (!refused) return
    Accounts.makeClientLoggedOut().finally(() => window.location.reload())
  })
}

const samePath = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/')

// The sign-in is bound to this tab: a random value kept in sessionStorage goes to /sso/login and
// is needed again to redeem the ticket, so a /sso/done link from someone else's sign-in cannot
// sign this browser in to their account.
const VERIFIER_KEY = 'slatebox.sso.verifier'
function newVerifier() {
  const bytes = new Uint8Array(32)
  window.crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function takeVerifier() {
  try {
    const verifier = window.sessionStorage.getItem(VERIFIER_KEY)
    window.sessionStorage.removeItem(VERIFIER_KEY)
    return verifier
  } catch {
    return null
  }
}

/** The sign-in button, and the reason the last single sign-on did not work, if it did not. */
export function SsoSignIn({ next }) {
  const { enabled, label } = useSso()
  const [query] = useSearchParams()
  if (!enabled) return null
  const refused = query.get('sso')
  const start = () => {
    const verifier = newVerifier()
    try { window.sessionStorage.setItem(VERIFIER_KEY, verifier) } catch { /* the sign-in then fails at /sso/done */ }
    window.location.assign('/sso/login?' + new URLSearchParams({ next: samePath(next || query.get('next')), verifier }))
  }
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
    const verifier = takeVerifier()
    if (!ticket || !verifier) { setFailed(true); return }
    Accounts.callLoginMethod({
      methodArguments: [{ ssoTicket: ticket, ssoVerifier: verifier }],
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
