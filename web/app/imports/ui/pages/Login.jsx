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
import { loginReturn } from '../components/billing/pay/pay-url.mjs'

export default function Login() {
  const history = useNavigate()

  const [query] = useSearchParams()
  // A workshop room being joined, an app's consent page (?oauth=), or the pay sheet a &pay= link
  // asked for (billing/pay/pay-url.mjs), else home.
  const signedInPlace = loginDestination(query)
  const destination = signedInPlace !== '/' ? signedInPlace : loginReturn(query) || '/'
  const { email } = useParams()
  const setGlobalMessage = useSetAtom(globalMessage)
  if (Meteor.user() && !Meteor.user().isAnonymous) return <Navigate replace to={destination} />

  async function generateLoginToken(eml) {
    const attempt = await Meteor.callAsync(
      CONSTANTS.methods.users.generateSpecialUseLoginToken,
      { email: eml, asEmail: true }
    )
    if (!attempt) {
      setGlobalMessage({
        visible: true,
        text: `Unable to create a login link for this email. Did you enter a valid email?`,
        severity: 'error',
        autoHide: 10000,
      })
    } else {
      setGlobalMessage({
        visible: true,
        text: `Hooray! We've sent an email to your inbox. Click the link in your email to immediately log into Slatebox.`,
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
        text: `Please provide your email to receive the login link!`,
        severity: 'error',
        autoHide: 10000,
      })
    }
  }

  const performLogin = (e) => {
    e.preventDefault()
    const em = document.getElementById('email').value
    const pwd = document.getElementById('password').value
    Meteor.loginWithPassword(em, pwd, (err) => {
      if (err) {
        setGlobalMessage({
          visible: true,
          text: `Invalid login, please try again`,
          severity: 'error',
          autoHide: 10000,
        })
      } else {
        history(destination)
        setGlobalMessage({
          visible: false,
        })
      }
    })
  }

  return (
    <Box sx={{ minHeight: '100svh', bgcolor: 'background.default', pb: 4 }}>
      <BrandBar />
      <Typography component="h1" sx={{ fontFamily: '"Archivo Narrow", Arial, sans-serif', fontWeight: 700,
        fontSize: { xs: 54, md: 72 }, lineHeight: 1, mt: { xs: 5, md: 7 }, mb: 3, textAlign: 'center' }}>
        Welcome back.
      </Typography>
      <Container component="main" maxWidth="xs" sx={{ mt: 0, width: '100%' }}>
        <Button
          type="button"
          fullWidth
          variant="contained"
          color="secondary"
          component={RouterLink}
          to="/start"
          className="MuiBox-register"
          sx={{ mb: 2 }}
        >
          Start now. No Registration required.
        </Button>
        <Divider sx={{ mt: 1, mb: 1, width: '100%' }} orientation="horizontal">
          OR
        </Divider>
        <form
          onSubmit={performLogin}
          style={{
            width: '100%',
          }}
          noValidate
        >
          <TextField
            variant="outlined"
            margin="normal"
            size="small"
            required
            fullWidth
            id="email"
            label="Email Address"
            name="email"
            autoComplete="email"
            defaultValue={email}
            autoFocus={!email}
          />
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
            autoFocus={!!email}
          />
          <Button
            type="submit"
            fullWidth
            color="primary"
            variant="contained"
            sx={{
              margin: (theme) => theme.spacing(2, 0, 2),
            }}
          >
            Sign In &rarr;
          </Button>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mt: -1,
              mb: 4,
            }}
          >
            <Button
              sx={{
                color: 'text.secondary',
                textTransform: 'none',
              }}
              component={RouterLink}
              to="/recover"
              size="small"
            >
              Forgot password?
            </Button>
            <Button
              sx={{
                color: 'text.secondary',
                textTransform: 'none',
              }}
              type="button"
              size="small"
              onClick={oneTimeSignIn}
            >
              Get a one-time sign in link &rarr;
            </Button>
          </Box>
        </form>
        <Box p={1} textAlign="center">
          <Typography variant="caption" color="text.secondary">
            By registering with Slatebox, you agree to the{' '}
            <Link
              href="./slatebox_terms_of_use.pdf"
              target="_blank"
              sx={{ color: 'primary.dark' }}
            >
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link
              href="./slatebox_privacy_policy.pdf"
              target="_blank"
              sx={{ color: 'primary.dark' }}
            >
              Privacy
            </Link>{' '}
            policies.
          </Typography>
        </Box>
      </Container>
    </Box>
  )
}
