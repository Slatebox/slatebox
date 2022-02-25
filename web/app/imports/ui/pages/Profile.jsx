import React, { useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useDispatch } from 'react-redux'
import Container from '@material-ui/core/Container'
import { Translation } from '../common/Translation.jsx'
import Grid from '@material-ui/core/Grid'
import { Divider, useTheme } from '@material-ui/core'
import InputAdornment from '@material-ui/core/InputAdornment'
import Button from '@material-ui/core/Button'
import Typography from '@material-ui/core/Typography'
import TextField from '@material-ui/core/TextField'
import Tooltip from '@material-ui/core/Tooltip'
import Box from '@material-ui/core/Box'
import confirmService from '../common/confirm'
import { promisify } from '../../api/client/promisify'
import { CONSTANTS } from '../../api/common/constants.js'
import AuthManager from '../../api/common/AuthManager.js'
import { Organizations } from '../../api/common/models.js'
import { GuestViewReport } from '../components/teams/GuestViewReport'

export const Profile = () => {
  const theme = useTheme()
  const dispatch = useDispatch()
  const [email, setEmail] =
    Meteor.user() && Meteor.user().emails && Meteor.user().emails[0].address
      ? React.useState(Meteor.user().emails[0].address)
      : React.useState(null)
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword1, setNewPassword1] = React.useState('')
  const [newPassword2, setNewPassword2] = React.useState('')

  if (Meteor.user() && Meteor.user().isAnonymous) {
    dispatch({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: `Register to create an account.`,
    })
  }

  function openRegistration() {
    dispatch({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: `Register to create an account.`,
    })
  }

  async function handleNewEmail() {
    if (email.indexOf('@') > -1) {
      if (email === Meteor.user().emails[0].address) {
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Your email didn't change! It's still ${email}.`,
            severity: 'error',
            autoHide: 60000,
          },
        })
        return
      }
      const result = await confirmService.show({
        theme: theme,
        title: `Confirm Email Change`,
        message: `You are changing your email to <strong>${email}</strong>. We will send you a verification email -- please check your inbox and click the verification link.`,
        actionItems: [
          { label: 'Send Verification Email', return: true },
          { label: 'Cancel', return: false },
        ],
      })
      if (result) {
        await promisify(Meteor.call, CONSTANTS.methods.users.changeEmail, {
          email,
        })
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Email sent to ${email}. Please verify.`,
            severity: 'info',
            autoHide: 60000,
          },
        })
      }
    } else {
      dispatch({
        type: 'canvas',
        globalMessage: {
          visible: true,
          text: `Your email doesn't look right: (${email})`,
          severity: 'error',
          autoHide: 60000,
        },
      })
    }
  }

  function handlePasswordChange() {
    if (newPassword1 !== newPassword2) {
      dispatch({
        type: 'canvas',
        globalMessage: {
          visible: true,
          text: `Your passwords do not match!`,
          severity: 'error',
          autoHide: 60000,
        },
      })
      return
    }
    Accounts.changePassword(currentPassword, newPassword1, (err, res) => {
      if (err) {
        console.error(err)
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Sorry, there was a problem changing your password: ${err.message}`,
            severity: 'error',
            autoHide: 60000,
          },
        })
      } else {
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Your password has been changed!`,
            severity: 'info',
            autoHide: 60000,
          },
        })
        setCurrentPassword('')
        setNewPassword1('')
        setNewPassword2('')
      }
    })
  }

  async function handleAccountDeletion() {
    if (!Meteor.user().orgId) {
      //single user -- organzation removals are handled on TeamSettings
      let res = await confirmService.show({
        theme: theme,
        title: `Confirm Account Removal`,
        message: `Are you sure you want to remove your account and all your attached slates? This CANNOT be undone. Confirming below will remove your account and all your slates and log you out.`,
        actionItems: [
          {
            label: 'Yes, remove my account and delete all my slates.',
            return: true,
          },
          { label: 'Cancel', return: false },
        ],
      })
      if (res) {
        setTimeout(() => {
          window.location.href = '/'
        }, 250)
        await promisify(Meteor.call, CONSTANTS.methods.users.delete)
        // let done = await confirmService.show({
        //   theme: theme,
        //   title: `Account Removal Succeeded`,
        //   message: `Your account and all your data has been removed. Thanks so much for trying Slatebox.`,
        //   actionItems: [{ label: "OK", return: true }]
        // });
        //   if (done) {
        //     Meteor.logout();
        //     window.location.href = "/";
        //   }
        // }
      }
    }
  }

  return (
    <Container maxWidth="lg">
      <Grid container alignItems="flex-start" justify="center" spacing={10}>
        <Grid item xs={12}>
          {Meteor.user() && Meteor.user().isAnonymous ? (
            <Box p={5}>
              <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
                You can access your profile page after registering!
              </Typography>
              <Box mt={5}>
                <Button
                  color="secondary"
                  size="lg"
                  variant="outlined"
                  onClick={openRegistration}
                >
                  Register Now
                </Button>
              </Box>
            </Box>
          ) : (
            <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
              <Box p={3}>
                <Translation>profile.header</Translation>
              </Box>
            </Typography>
          )}
        </Grid>
        {Meteor.user() && !Meteor.user().isAnonymous && (
          <>
            <Grid item xs={6}>
              <Box mb={2}>
                <Typography variant="h5" color="secondary">
                  Change Email
                </Typography>
              </Box>
              <TextField
                autoComplete="email"
                type="email"
                name="email"
                variant="outlined"
                required
                fullWidth
                id="email"
                label="Email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                }}
                error={email?.indexOf('@') === -1}
                autoFocus
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button
                        color="secondary"
                        variant="outlined"
                        onClick={handleNewEmail}
                      >
                        Update
                      </Button>
                    </InputAdornment>
                  ),
                }}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
              <Typography variant="overline" color="secondary">
                <Box p={3}>
                  <Translation>profile.reVerificationNote</Translation>
                </Box>
              </Typography>
            </Grid>
            <Grid item xs={6}>
              <Grid
                container
                alignItems="flex-start"
                justify="flex-end"
                spacing={2}
              >
                <Grid item xs={12}>
                  <Typography variant="h5" color="secondary">
                    Change Password
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Tooltip
                    title="Please enter your current password"
                    placement="top"
                  >
                    <TextField
                      variant="outlined"
                      required
                      fullWidth
                      name="currentPassword"
                      label="Current Password"
                      type="password"
                      id="currentPassword"
                      autoComplete="currentPassword"
                      onChange={(e) => {
                        setCurrentPassword(e.target.value)
                      }}
                      value={currentPassword}
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Tooltip>
                </Grid>
                <Grid item xs={12}>
                  <Tooltip title="At least 8 characters long" placement="top">
                    <TextField
                      variant="outlined"
                      required
                      fullWidth
                      name="password"
                      label="New Password"
                      type="password"
                      id="newPassword1"
                      autoComplete="new-password-1"
                      onChange={(e) => {
                        setNewPassword1(e.target.value)
                      }}
                      value={newPassword1}
                      error={newPassword1 !== newPassword2}
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Tooltip>
                </Grid>
                <Grid item xs={12}>
                  <Tooltip
                    title="Type the same password again, at least 8 characters long"
                    placement="top"
                  >
                    <TextField
                      variant="outlined"
                      required
                      fullWidth
                      name="password"
                      label="New Password Again"
                      type="password"
                      id="newPassword2"
                      autoComplete="new-password-2"
                      onChange={(e) => {
                        setNewPassword2(e.target.value)
                      }}
                      value={newPassword2}
                      error={newPassword2 !== newPassword1}
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Tooltip>
                </Grid>
                <Grid item>
                  <Button
                    color="secondary"
                    variant="outlined"
                    onClick={handlePasswordChange}
                  >
                    Change Password
                  </Button>
                </Grid>
              </Grid>
            </Grid>
            {Meteor.user() &&
              Meteor.user().planType !== 'free' &&
              !Organizations.findOne() && (
                <Grid item xs={12}>
                  <GuestViewReport />
                </Grid>
              )}
            {Meteor.user() && !Meteor.user()?.orgId && (
              <Grid item xs={12}>
                <Grid container spacing={2}>
                  <Grid item xs={12}>
                    <Divider
                      style={{
                        border: `1px solid ${theme.palette.error.main}`,
                      }}
                    />
                    <Box p={3}>
                      <Typography
                        variant="h5"
                        style={{ color: theme.palette.error.main }}
                      >
                        Danger Zone
                      </Typography>
                    </Box>
                  </Grid>
                  <Box p={3}>
                    <Button
                      onClick={handleAccountDeletion}
                      variant="outlined"
                      style={{
                        border: `1px solid ${theme.palette.error.main}`,
                      }}
                    >
                      Delete My Account
                    </Button>
                  </Box>
                </Grid>
              </Grid>
            )}
          </>
        )}
      </Grid>
    </Container>
  )
}
