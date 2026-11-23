/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import Avatar from '@mui/material/Avatar'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Box from '@mui/material/Box'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import Container from '@mui/material/Container'
import Stack from '@mui/material/Stack'
import { useNavigate } from 'react-router-dom'
import Dialog from '@mui/material/Dialog'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'
import { useAtom } from 'jotai'
import CircularProgress from '@mui/material/CircularProgress'
import SlideTransition from '../components/SlideTransition'
import confirmService from './confirm'
import CONSTANTS from '../../api/common/constants'
import {
  registrationDetails,
  globalMessage,
  mainDrawerOpen,
} from '../jotai/atoms'
import {
  REGISTRATION_MODES,
  buildRegistrationForm,
  getRegistrationMode,
  isClaimFormComplete,
  isValidEmail,
  markClaimFieldsInvalid,
} from './guestRegistration.mjs'
import { registrationCopy } from './accountCopy.mjs'

let emailCheckTimer = null

export default function Register({ user = null }) {
  const history = useNavigate()
  const theme = useTheme()
  const [, setGlobalMessage] = useAtom(globalMessage)
  const [, setMainDrawerOpen] = useAtom(mainDrawerOpen)
  const [getRegistrationDetails, setRegistrationDetails] =
    useAtom(registrationDetails)

  const mode = getRegistrationMode(user)
  const isAnon = mode === REGISTRATION_MODES.anonymous
  const accountTypeReady = [
    REGISTRATION_MODES.anonymous,
    REGISTRATION_MODES.identified,
  ].includes(mode)
  const emailAddress =
    mode === REGISTRATION_MODES.identified
      ? user?.emails?.[0]?.address?.trim() || ''
      : ''
  const isVerified =
    mode === REGISTRATION_MODES.identified &&
    Boolean(user?.emails?.[0]?.verified)

  const [formVals, setFormVals] = React.useState(() =>
    buildRegistrationForm(null, REGISTRATION_MODES.signedOut)
  )
  const [mailAvailable, setMailAvailable] = React.useState(Meteor.settings.public.env === 'selfhost' ? null : true)
  React.useEffect(() => {
    if (!getRegistrationDetails.registrationOpen || Meteor.settings.public.env !== 'selfhost') return
    let active = true
    Meteor.callAsync(CONSTANTS.methods.users.verificationMailAvailable)
      .then(available => { if (active) setMailAvailable(available) })
      .catch(() => { if (active) setMailAvailable(null) })
    return () => { active = false }
  }, [getRegistrationDetails.registrationOpen])
  const [emailSent, setEmailSent] = React.useState(false)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const handleClose = React.useCallback(() => {
    window.clearTimeout(emailCheckTimer)
    setEmailSent(false)
    setIsSubmitting(false)
    setRegistrationDetails((current) => ({
      ...current,
      registrationOpen: false,
    }))
  }, [setRegistrationDetails])

  React.useEffect(() => {
    if (!getRegistrationDetails.registrationOpen || !accountTypeReady) return
    setFormVals(buildRegistrationForm(user, mode))
    setIsSubmitting(false)
  }, [
    accountTypeReady,
    getRegistrationDetails.registrationOpen,
    mode,
    user?._id,
  ])

  React.useEffect(
    () => () => {
      window.clearTimeout(emailCheckTimer)
    },
    []
  )

  React.useEffect(() => {
    if (
      isVerified &&
      emailAddress !== '' &&
      getRegistrationDetails.registrationOpen
    ) {
      handleClose()
      setGlobalMessage({
        visible: true,
        title: 'Email verified',
        text: `${emailAddress} is verified. Your Slatebox is saved and ready wherever you sign in.`,
        severity: 'info',
        autoHide: 60000,
      })
    }
  }, [
    emailAddress,
    getRegistrationDetails.registrationOpen,
    handleClose,
    isVerified,
    setGlobalMessage,
  ])

  const showError = (err) => {
    setGlobalMessage({
      visible: true,
      text: err?.reason || err?.message || 'Unable to save your account.',
      severity: 'error',
      autoHide: 60000,
    })
  }

  async function identifyUser() {
    try {
      // A guest saves its account by choosing a password in the same call.
      const identify = await Meteor.callAsync(
        CONSTANTS.methods.users.identify,
        {
          firstName: formVals.firstName.value.trim(),
          lastName: formVals.lastName.value.trim(),
          email: formVals.email.value.trim(),
          ...(isAnon && { password: formVals.password.value }),
        }
      )
      setEmailSent(identify === true)
      if (identify?.verificationEmailSent === false) setMailAvailable(false)
      return identify
    } catch (err) {
      showError(err)
      return false
    }
  }

  async function sendVerificationEmail() {
    setIsSubmitting(true)
    const identified = await identifyUser()
    if (identified) {
      setGlobalMessage({
        visible: true,
        text: identified === true ? `Verification email sent to ${formVals.email.value.trim()}` : 'Email verification requires a mail server on this instance.',
        severity: 'info',
        autoHide: 60000,
      })
    }
    setIsSubmitting(false)
  }

  async function anyOtherUsersWithEmail(email) {
    try {
      const others = await Meteor.callAsync(CONSTANTS.methods.users.get, {
        email,
        count: true,
      })
      return others > 0
    } catch (err) {
      showError(err)
      return false
    }
  }

  async function claimGuestAccount() {
    if (!isClaimFormComplete(formVals)) {
      setFormVals(markClaimFieldsInvalid(formVals))
      return
    }

    setIsSubmitting(true)
    try {
      const identified = await identifyUser()
      if (identified) {
        if (identified.verificationEmailSent === false) handleClose()
        setGlobalMessage({
          visible: true,
          text: identified === true ? `Your work is saved. Check ${formVals.email.value.trim()} to verify your email.` : 'Your work is saved. You can sign in with your email and password.',
          severity: 'info',
          autoHide: 60000,
        })
      }
    } catch (err) {
      showError(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const invokeRegistration = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (isAnon) await claimGuestAccount()
    else if (formVals.email.valid) await sendVerificationEmail()
    else {
      setFormVals((current) => ({
        ...current,
        email: { ...current.email, valid: false },
      }))
    }
  }

  const handleExistingUser = async (email) => {
    const nextPath = await confirmService.show({
      theme,
      title: 'Account already exists',
      message: `There is already an account for ${email}. Sign in to keep working with that account, or reset its password.`,
      actionItems: [
        { label: 'Sign in', return: `/login/${email}` },
        { label: 'Reset password', return: `/recover/${email}` },
        { label: 'Cancel', return: false },
      ],
    })
    if (nextPath) {
      setMainDrawerOpen(false)
      handleClose()
      Meteor.logout(() => history(nextPath))
    } else {
      setFormVals((current) => ({
        ...current,
        email: { value: '', valid: false },
      }))
    }
  }

  const set = (prop, value) => {
    const trimmedValue = value.trim()
    setFormVals((current) => {
      const { valid: currentValidity } = current[prop]
      let valid = currentValidity
      if (prop === 'email') valid = isValidEmail(value)
      if (prop === 'password') valid = value.length >= 8
      if (prop === 'firstName' || prop === 'lastName') valid = true
      return {
        ...current,
        [prop]: { value, valid },
      }
    })

    if (prop === 'email' && isAnon) {
      window.clearTimeout(emailCheckTimer)
      emailCheckTimer = window.setTimeout(async () => {
        if (
          isValidEmail(trimmedValue) &&
          (await anyOtherUsersWithEmail(trimmedValue))
        ) {
          await handleExistingUser(trimmedValue)
        }
      }, 500)
    }
  }

  // A guest who chose Create an account is signing up; any other guest is saving their work.
  const copy = registrationCopy({ guest: isAnon, intent: getRegistrationDetails.intent, emailSent })
  const actionLabel = copy.action

  return (
    <Dialog
      fullScreen
      open={getRegistrationDetails.registrationOpen}
      onClose={handleClose}
      slots={{ transition: SlideTransition }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'shell.background',
            backgroundImage: 'none',
          },
        },
      }}
      aria-labelledby="account-claim-title"
    >
      <AppBar
        sx={{ position: 'relative', bgcolor: 'shell.main' }}
        elevation={0}
      >
        <Toolbar>
          <IconButton
            edge="start"
            sx={{ color: 'white' }}
            onClick={handleClose}
            aria-label="Close"
          >
            <CloseIcon />
          </IconButton>
          <Typography variant="h6" sx={{ ml: 2, color: '#fff' }}>
            Slatebox
          </Typography>
        </Toolbar>
      </AppBar>

      <Container component="main" maxWidth="sm">
        {!accountTypeReady ? (
          <Stack
            alignItems="center"
            justifyContent="center"
            spacing={2}
            sx={{ minHeight: '60vh' }}
          >
            <CircularProgress color="primary" />
            <Typography color="text.secondary">
              Preparing your workspace…
            </Typography>
          </Stack>
        ) : (
          <Box
            data-testid={isAnon ? 'guest-account-claim' : 'email-verification'}
            sx={{
              pt: { xs: 6, sm: 10 },
              pb: 6,
              width: '100%',
            }}
          >
            <Avatar
              sx={{
                width: 52,
                height: 52,
                mb: 3,
                bgcolor: 'primary.main',
              }}
            >
              <LockOutlinedIcon />
            </Avatar>
            <Typography
              component="h1"
              variant="h4"
              id="account-claim-title"
              sx={{ mb: 1.5 }}
            >
              {copy.heading}
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
              {isAnon
                ? copy.lede
                : mailAvailable === false ? 'Ask your administrator to configure email delivery to verify this address.'
                : `Send a verification link to ${emailAddress || 'your email address'} to finish securing your Slatebox.`}
            </Typography>
            {getRegistrationDetails.registrationMessage && (
              <Typography
                variant="body2"
                color="primary.main"
                sx={{ mt: 2.5, fontWeight: 600 }}
              >
                {getRegistrationDetails.registrationMessage}
              </Typography>
            )}

            <Box
              component="form"
              onSubmit={invokeRegistration}
              sx={{ mt: 4 }}
              noValidate
            >
              <Stack spacing={2.5}>
                <TextField
                  variant="outlined"
                  required
                  fullWidth
                  id="email"
                  label="Email address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={formVals.email.value}
                  onChange={(event) => set('email', event.target.value)}
                  error={formVals.email.valid === false}
                  helperText={
                    formVals.email.valid === false
                      ? 'Enter a valid email address.'
                      : 'We’ll send a verification link. Your slate remains available while you verify.'
                  }
                  autoFocus
                />
                {isAnon && (
                  <TextField
                    variant="outlined"
                    required
                    fullWidth
                    name="password"
                    label="Password"
                    type="password"
                    id="password"
                    autoComplete="new-password"
                    value={formVals.password.value}
                    onChange={(event) => set('password', event.target.value)}
                    error={formVals.password.valid === false}
                    helperText={
                      formVals.password.valid === false
                        ? 'Use at least 8 characters.'
                        : 'At least 8 characters.'
                    }
                  />
                )}
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                sx={{ mt: 4 }}
              >
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="large"
                  disabled={isSubmitting || (!isAnon && mailAvailable !== true)}
                  sx={{ minWidth: 220 }}
                >
                  {isSubmitting ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    actionLabel
                  )}
                </Button>
                {isAnon && (
                  <Button
                    type="button"
                    size="large"
                    color="inherit"
                    onClick={handleClose}
                  >
                    {copy.dismiss}
                  </Button>
                )}
              </Stack>

              {!isAnon && !isVerified && emailSent && (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={2}
                  sx={{ mt: 3 }}
                >
                  <CircularProgress size={20} color="secondary" />
                  <Typography variant="body2" color="text.secondary">
                    Check your inbox. This window will close after verification.
                  </Typography>
                </Stack>
              )}
            </Box>
          </Box>
        )}
      </Container>
    </Dialog>
  )
}

Register.propTypes = {
  user: PropTypes.shape({
    _id: PropTypes.string,
    isAnonymous: PropTypes.bool,
    emails: PropTypes.arrayOf(
      PropTypes.shape({
        address: PropTypes.string,
        verified: PropTypes.bool,
      })
    ),
    profile: PropTypes.shape({
      firstName: PropTypes.string,
      lastName: PropTypes.string,
    }),
  }),
}

