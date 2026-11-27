/* eslint-disable consistent-return */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import Container from '@mui/material/Container'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Link from '@mui/material/Link'
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import { Box, Divider } from '@mui/material'
import CONSTANTS from '../../api/common/constants'
import { globalMessage } from '../jotai/atoms'
import { loginDestination, rememberLoginReturn } from '../../api/common/login-return.mjs'
import BrandBar from '../common/BrandBar'
import { SsoForAddress, SsoSignIn, useSso } from '../sso/sso'
import { loginReturn } from '../components/billing/pay/pay-url.mjs'
import { loginWelcome, rememberSignedIn, signedInBefore } from '../common/accountCopy.mjs'
import PasskeySignIn from '../passkeys/PasskeySignIn'
import { focusOnLoad } from '../passkeys/passkey-request.mjs'
import usePhoneView from '../common/usePhoneView'

export default function Login() {
  const history = useNavigate()

  const [query] = useSearchParams()
  // A phone views slates and makes none (phoneView.mjs): no "Start a slate" there.
  const phoneView = usePhoneView()
  // A workshop room being joined, an app's consent page (?oauth=), or the pay sheet a &pay= link
  // asked for (billing/pay/pay-url.mjs), else home.
  const signedInPlace = loginDestination(query)
  const destination = signedInPlace !== '/' ? signedInPlace : loginReturn(query) || '/'
  const { email } = useParams()
  const setGlobalMessage = useSetAtom(globalMessage)
  // A first visit is greeted as one; a browser that has been signed in before says Welcome back.
  const [welcome] = React.useState(() => loginWelcome(signedInBefore(globalThis.localStorage)))
  const sso = useSso()
  // No field takes focus on load on a touch device: a focused webauthn field raised iOS's passkey
  // sheet uninvited in the app's sign-in sheet (passkeys/passkey-request.mjs).
  const [focusFirst] = React.useState(() => focusOnLoad())
  // The address typed so far: when a team requires single sign-on for it, the password is not asked.
  const [typed, setTyped] = React.useState(email || '')
  const [ssoRequired, setSsoRequired] = React.useState(false)
  if (Meteor.user() && !Meteor.user().isAnonymous) return <Navigate replace to={destination} />

  async function generateLoginToken(eml) {
    const attempt = await Meteor.callAsync(
      CONSTANTS.methods.users.generateSpecialUseLoginToken,
      { email: eml, asEmail: true }
    )
    if (!attempt) {
      setGlobalMessage({
        visible: true,
        text: `We couldn’t send a sign-in link to that address. Check the email and try again.`,
        severity: 'error',
        autoHide: 10000,
      })
    } else {
      setGlobalMessage({
        visible: true,
        text: `Check your inbox: the link in our email signs you in to Slatebox.`,
        severity: 'info',
        autoHide: 10000,
      })
    }
  }

  const oneTimeSignIn = (e) => {
    e.preventDefault()
    const em = document.getElementById('email').value
    if (em) {
      rememberLoginReturn(localStorage, destination, Date.now())
      generateLoginToken(em)
    } else {
      setGlobalMessage({
        visible: true,
        text: `Enter your email address and we’ll send you a sign-in link.`,
        severity: 'error',
        autoHide: 10000,
      })
    }
  }

  // A passkey sign-in (the button or the email field's autofill) lands where a password one does.
  const passkeySignedIn = () => {
    rememberSignedIn(globalThis.localStorage)
    history(destination)
    setGlobalMessage({ visible: false })
  }
  const passkeyFailed = (text) => setGlobalMessage({ visible: true, text, severity: 'error', autoHide: 10000 })

  const performLogin = (e) => {
    e.preventDefault()
    if (ssoRequired) return
    const em = document.getElementById('email').value
    const pwd = document.getElementById('password').value
    Meteor.loginWithPassword(em, pwd, (err) => {
      if (err) {
        setGlobalMessage({
          visible: true,
          text: `That email and password don’t match. Try again, or reset your password.`,
          severity: 'error',
          autoHide: 10000,
        })
      } else {
        rememberSignedIn(globalThis.localStorage)
        history(destination)
        setGlobalMessage({
          visible: false,
        })
      }
    })
  }

  const quiet = { color: 'text.secondary', textTransform: 'none', fontWeight: 600 }
  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default', pb: 6 }}>
      <BrandBar />
      <Container component="main" maxWidth="xs" sx={{ width: '100%', pt: { xs: 5, md: 8 } }}>
        <Typography component="h1" sx={{ fontFamily: '"Archivo Narrow", Arial, sans-serif', fontWeight: 700,
          fontSize: { xs: 44, md: 56 }, lineHeight: 1.02, letterSpacing: '-.01em', mb: 1.5, textAlign: 'center' }}>
          {welcome.heading}
        </Typography>
        <Typography sx={{ color: 'text.secondary', textAlign: 'center', fontSize: 17, lineHeight: 1.45, mb: 3 }}>
          {welcome.lede}
        </Typography>
        <SsoSignIn next={destination} />
        {/* Under "SSO only" there are no guests and no passwords: single sign-on is the way in. */}
        {sso.only ? null : <>
        <form onSubmit={performLogin} style={{ width: '100%' }} noValidate>
          <TextField
            variant="outlined"
            margin="normal"
            size="small"
            required
            fullWidth
            id="email"
            label="Email address"
            name="email"
            // "webauthn" lets the browser offer this site's passkeys here (autofill, PasskeySignIn).
            autoComplete="username webauthn"
            defaultValue={email}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus={focusFirst && !email}
          />
          <SsoForAddress email={typed} next={destination} onRequired={setSsoRequired} />
          {ssoRequired ? null : <>
          <TextField
            variant="outlined"
            margin="normal"
            size="small"
            required
            fullWidth
            name="password"
            label="Password"
            type="password"
            id="password"
            autoComplete="current-password"
            autoFocus={focusFirst && !!email}
          />
          <Button type="submit" fullWidth color="primary" variant="contained" disableElevation size="large"
            sx={{ mt: 2, mb: 1, borderRadius: 6 }}>
            Sign in
          </Button>
          <PasskeySignIn onSignedIn={passkeySignedIn} onError={passkeyFailed} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Button sx={quiet} component={RouterLink} to="/recover" size="small">Forgot password?</Button>
            <Button sx={quiet} type="button" size="small" onClick={oneTimeSignIn}>Email me a sign-in link</Button>
          </Box>
          </>}
        </form>
        <Divider sx={{ my: 3, color: 'text.secondary', fontSize: 14 }}>New to Slatebox?</Divider>
        <Box sx={{ display: 'grid', gap: 1.25 }}>
          <Button fullWidth variant="outlined" color="primary" size="large" component={RouterLink} to="/signup" sx={{ borderRadius: 6 }}>
            Create an account
          </Button>
          {!phoneView && <Button fullWidth variant="text" color="primary" component={RouterLink} to="/start" sx={{ borderRadius: 6, fontWeight: 600 }}>
            Start a slate, no account needed
          </Button>}
        </Box>
        </>}
        <Box sx={{ pt: 4, textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            By signing in or creating an account, you agree to the{' '}
            <Link href="./slatebox_terms_of_use.pdf" target="_blank" sx={{ color: 'text.primary' }}>Terms of Service</Link>
            {' '}and{' '}
            <Link href="./slatebox_privacy_policy.pdf" target="_blank" sx={{ color: 'text.primary' }}>Privacy Policy</Link>.
          </Typography>
        </Box>
      </Container>
    </Box>
  )
}
