// "Sign in with SSO" in the browser. The server's own connection (a self-hosted server's bundled
// Keycloak) comes from the public settings (Meteor.settings.public.sso: { enabled, only, label })
// and has its own button. A team's connection is found by address: the person types their email,
// /sso/discover answers which connection signs it in. The server does the OpenID Connect and SAML
// work; the browser only follows redirects and trades the one-time ticket from /sso/done for a
// Meteor session.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { useTracker } from 'meteor/react-meteor-data'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, TextField, Typography } from '@mui/material'

const REFUSALS = {
  denied: 'Single sign-on was cancelled.',
  account: 'Your single sign-on account cannot be used here. Ask your administrator.',
  'no-sign-in': 'That sign-in took too long or was started in another browser or tab. Try again.',
  'no-connection': 'That single sign-on connection is turned off or no longer exists. Ask your administrator.',
  discovery: 'Your identity provider could not be reached. Try again, or ask your administrator.',
  saml: 'Your identity provider\'s answer could not be accepted. Ask your administrator.',
  'too-many': 'Too many sign-ins were started from here. Wait a minute and try again.',
}

export function useSso() {
  const sso = Meteor.settings.public?.sso
  return {
    enabled: sso?.enabled === true,
    only: sso?.enabled === true && sso?.only === true,
    label: sso?.label || 'Sign in with SSO',
  }
}

// When the server ends a session (single sign-on access was removed, or a team's session length
// ran out), it closes the connection and refuses the tab's resume on reconnect. Meteor's client can
// then keep showing the old account with its method queue stalled, so watch for that refusal and
// sign the tab out with a reload.
if (Meteor.isClient) {
  Meteor.connection._stream.on('message', (raw) => {
    if (typeof raw !== 'string' || !raw.includes('"error"') || !Meteor.userId()) return
    let message
    try { message = JSON.parse(raw) } catch { return }
    const refused = message?.msg === 'result' && message.error?.error === 403 &&
      /logged out by the server|no longer has access|single sign-on session ended|your company signs in with single sign-on|account is turned off/i.test(message.error.reason || '')
    if (!refused) return
    Accounts.makeClientLoggedOut().finally(() => window.location.reload())
  })
}

const samePath = (next) => (typeof next === 'string' && /^\/(?![/\\])/.test(next) ? next : '/')

// The sign-in is bound to this tab: a random value kept in sessionStorage goes to /sso/start and
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

/** Start a sign-in with a connection (none: the server's own), bound to this tab. */
export function startSso({ connectionId, next, email } = {}) {
  const verifier = newVerifier()
  try { window.sessionStorage.setItem(VERIFIER_KEY, verifier) } catch { /* the sign-in then fails at /sso/done */ }
  const params = new URLSearchParams({ next: samePath(next), verifier })
  if (connectionId) params.set('c', connectionId)
  if (email) params.set('email', email)
  window.location.assign('/sso/start?' + params)
}

/** Which of a team's connections signs in this address: { connectionId, label, requireSso } or null. */
export async function discoverSso(email) {
  const address = String(email || '').trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return null
  try {
    const response = await fetch('/sso/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: address }), credentials: 'same-origin',
    })
    if (!response.ok) return null
    const found = await response.json()
    return found?.connectionId ? found : null
  } catch {
    return null
  }
}

/** "Sign in with SSO" by address: the person types their work email and is sent to their company's sign-in. */
function SsoByEmail({ next }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [none, setNone] = useState(false)
  const go = async (event) => {
    event.preventDefault()
    setBusy(true)
    setNone(false)
    const found = await discoverSso(email)
    if (found) { startSso({ connectionId: found.connectionId, next, email: email.trim() }); return }
    setBusy(false)
    setNone(true)
  }
  if (!open) {
    return (
      <Button id="ssoByEmail" type="button" fullWidth variant="text" color="primary" onClick={() => setOpen(true)}
        sx={{ textTransform: 'none', fontWeight: 600 }}>
        Sign in with SSO
      </Button>
    )
  }
  return (
    <Box component="form" onSubmit={go} noValidate data-sso-by-email="" sx={{ display: 'grid', gap: 1 }}>
      <TextField id="ssoEmail" size="small" fullWidth autoFocus type="email" label="Work email" autoComplete="email"
        value={email} onChange={(e) => { setEmail(e.target.value); setNone(false) }}
        helperText={none ? 'No single sign-on is set up for that address. Sign in with your password, or ask your administrator.' : 'We send you to your company\'s sign-in.'}
        error={none} />
      <Button type="submit" variant="contained" color="primary" disableElevation disabled={busy || !email.includes('@')}>
        {busy ? 'Finding your company…' : 'Continue'}
      </Button>
    </Box>
  )
}

/** The sign-in buttons, and the reason the last single sign-on did not work, if it did not. */
export function SsoSignIn({ next }) {
  const { enabled, label } = useSso()
  const [query] = useSearchParams()
  const refused = query.get('sso')
  const back = next || query.get('next')
  return (
    <Box sx={{ mb: 2, display: 'grid', gap: 1 }}>
      {refused ? (
        <Typography role="alert" color="error" variant="body2">
          {REFUSALS[refused] || 'Single sign-on did not work. Try again, or ask your administrator.'}
        </Typography>
      ) : null}
      {enabled ? (
        <Button id="ssoSignIn" type="button" fullWidth variant="contained" color="primary" onClick={() => startSso({ next: back })}>
          {label} &rarr;
        </Button>
      ) : null}
      <SsoByEmail next={back} />
    </Box>
  )
}

/**
 * Under the email field of the sign-in page: when the address belongs to a team's single sign-on,
 * a button that continues there, and (when the team requires it) the word that the password field
 * is not for this address. onRequired(true|false) lets the page hide its password field.
 */
export function SsoForAddress({ email, next, onRequired }) {
  const [found, setFound] = useState(null)
  useEffect(() => {
    let live = true
    const timer = setTimeout(async () => {
      const result = await discoverSso(email)
      if (!live) return
      setFound(result)
      onRequired?.(Boolean(result?.requireSso))
    }, 350)
    return () => { live = false; clearTimeout(timer) }
  }, [email, onRequired])
  if (!found) return null
  return (
    <Box data-sso-for-address={found.requireSso ? 'required' : 'offered'} sx={{ display: 'grid', gap: 1, my: 1 }}>
      {found.requireSso ? (
        <Typography variant="body2" role="status">Your company signs in with single sign-on.</Typography>
      ) : null}
      <Button type="button" fullWidth variant={found.requireSso ? 'contained' : 'outlined'} color="primary" disableElevation
        onClick={() => startSso({ connectionId: found.connectionId, next, email })}>
        Continue with {found.label} &rarr;
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
