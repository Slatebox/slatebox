import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import Avatar from '@material-ui/core/Avatar'
import Button from '@material-ui/core/Button'
import TextField from '@material-ui/core/TextField'
import Grid from '@material-ui/core/Grid'
import Box from '@material-ui/core/Box'
import LockOutlinedIcon from '@material-ui/icons/LockOutlined'
import Typography from '@material-ui/core/Typography'
import { makeStyles, useTheme } from '@material-ui/core/styles'
import Container from '@material-ui/core/Container'

import { useHistory } from 'react-router-dom'

import Dialog from '@material-ui/core/Dialog'
import AppBar from '@material-ui/core/AppBar'
import Toolbar from '@material-ui/core/Toolbar'
import IconButton from '@material-ui/core/IconButton'
import CloseIcon from '@material-ui/icons/Close'
import Slide from '@material-ui/core/Slide'
import { useSelector, useDispatch } from 'react-redux'
import Tooltip from '@material-ui/core/Tooltip'

import cloneDeep from 'lodash.clonedeep'

import CircularProgress from '@material-ui/core/CircularProgress'
import confirmService from './confirm'

import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(8),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  avatar: {
    margin: theme.spacing(1),
    backgroundColor: theme.palette.secondary.main,
  },
  form: {
    width: '100%', // Fix IE 11 issue.
    marginTop: theme.spacing(3),
  },
  submit: {
    margin: theme.spacing(3, 0, 2),
  },
  appBar: {
    position: 'relative',
  },
  title: {
    marginLeft: theme.spacing(2),
    flex: 1,
  },
}))

const Transition = React.forwardRef((props, ref) => (
  // eslint-disable-next-line react/jsx-props-no-spreading
  <Slide direction="up" ref={ref} {...props} />
))

let cuser = null
export default function Register({ user }) {
  const classes = useStyles()
  const history = useHistory()
  const dispatch = useDispatch()
  const theme = useTheme()
  const registrationOpen =
    useSelector((state) => state.registrationOpen) || false
  const registrationMessage =
    useSelector((state) => state.registrationMessage) ||
    'Please register to continue using Slatebox.'
  const paymentWillBeRequested =
    useSelector((state) => state.paymentWillBeRequested) || false

  const handleClose = () => {
    dispatch({
      type: 'registration',
      registrationOpen: false,
    })
  }

  const isAnon = user?.isAnonymous || false

  let isVerified = false
  let emailAddress = ''
  if (user && !isAnon && user.emails && user.emails.length > 0) {
    isVerified = user.emails[0].verified || false
    emailAddress = user.emails[0].address
  }

  const [formVals, setFormVals] = React.useState({
    firstName: {
      value: isAnon ? '' : user?.profile?.firstName,
      valid: null,
    },
    lastName: {
      value: isAnon ? '' : user?.profile?.lastName,
      valid: null,
    },
    email: { value: isAnon ? '' : emailAddress, valid: null },
    password: { value: '', valid: null },
  })
  const [actionValue, setActionValue] = React.useState(
    isAnon ? 'Sign Up' : 'Verify Email'
  )
  const [emailSent, setEmailSent] = React.useState(false)

  async function identifyUser() {
    try {
      const identify = await promisify(
        Meteor.call,
        CONSTANTS.methods.users.identify,
        {
          firstName: formVals.firstName.value.trim(),
          lastName: formVals.lastName.value.trim(),
          email: formVals.email.value,
        }
      )
      setEmailSent(true)
      return identify
    } catch (err) {
      dispatch({
        type: 'canvas',
        globalMessage: {
          visible: true,
          text: err.reason,
          severity: 'error',
          autoHide: 60000,
        },
      })
      return null
    }
  }

  async function rs() {
    await identifyUser()
    dispatch({
      type: 'canvas',
      globalMessage: {
        visible: true,
        text: `Email sent to ${formVals.email.value}`,
        severity: 'info',
        autoHide: 60000,
      },
    })
    setActionValue('Resend Email')
  }

  async function anyOtherUsersWithEmail(email) {
    try {
      const others = await promisify(Meteor.call, CONSTANTS.methods.users.get, {
        email,
        count: true,
      })
      return others > 0
    } catch (err) {
      dispatch({
        type: 'canvas',
        globalMessage: {
          visible: true,
          text: err.reason,
          severity: 'error',
          autoHide: 10000,
        },
      })
      return null
    }
  }

  async function check() {
    if (Object.values(formVals).every((v) => v.valid === true)) {
      const result = await confirmService.show({
        theme,
        title: `Confirm Email - Last Step`,
        message: `Welcome! We will send an email to <strong>${formVals.email.value}</strong>. Please check your email to finish and continue building your slate.`,
        actionItems: [
          { label: 'Send Verification Email', return: true },
          { label: 'Cancel', return: false },
        ],
      })
      if (result) {
        // should start loader?
        // only needed if the user is anonymous
        Accounts.changePassword(
          CONSTANTS.anonUserPwd,
          formVals.password.value,
          (err) => {
            if (err) {
              console.error('error changing password', err)
            } else {
              rs()
            }
          }
        )
      }
    } else {
      // validate every field
      const fv = cloneDeep(formVals)
      Object.keys(formVals).forEach((k) => {
        if (fv[k].valid === null) {
          fv[k].valid = false
        }
      })
      setFormVals(fv)
    }
  }

  const invokeRegistration = (e) => {
    e.stopPropagation()
    if (isAnon) {
      check()
    } else if (formVals.email.valid) {
      rs()
    }
  }

  const set = (prop, val) => {
    const fv = cloneDeep(formVals)
    fv[prop].value = val
    switch (prop) {
      case 'firstName':
      case 'lastName': {
        fv[prop].valid = fv[prop]?.value?.length >= 1
        break
      }
      case 'email': {
        fv[prop].valid = fv[prop]?.value?.indexOf('@') > -1
        clearTimeout(cuser)
        cuser = window.setTimeout(async () => {
          if (fv[prop].valid) {
            const checkForOtherUsers = await anyOtherUsersWithEmail(val)
            if (checkForOtherUsers) {
              const logoutNow = await confirmService.show({
                theme,
                title: `User Already Registered`,
                message: `There is already a user registered with ${val}. Would you like to login or request a password reset?`,
                actionItems: [
                  { label: 'Login', return: `/login/${val}` },
                  { label: 'Reset Password', return: `/recover/${val}` },
                  { label: 'Cancel', return: false },
                ],
              })
              if (logoutNow) {
                dispatch({
                  type: 'registration',
                  registrationOpen: false,
                })
                Meteor.logout(() => {
                  console.log('redirecting ', logoutNow)
                  history.push(logoutNow)
                })
              } else {
                const fs = cloneDeep(formVals)
                fs.email.value = ''
                setFormVals(fs)
              }
            }
          }
        }, 500)
        break
      }
      case 'password': {
        fv[prop].valid = fv[prop]?.value?.length >= 8
        break
      }
      default: {
        break
      }
    }
    setFormVals(fv)
  }

  // fires when user is verified
  if (isVerified) {
    if (registrationOpen) {
      dispatch({
        type: 'registration',
        registrationOpen: false,
      })
      if (!paymentWillBeRequested) {
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            title: 'Email Verified',
            text: `Hooray, you've verified ${formVals.email.value}! Go forth and build more slates.`,
            severity: 'info',
            autoHide: 60000,
          },
        })
      }
    }
  }

  Register.propTypes = {
    user: PropTypes.shape({
      isAnonymous: PropTypes.bool,
      emails: PropTypes.arrayOf(
        PropTypes.shape({
          verified: PropTypes.bool,
          address: PropTypes.string,
        })
      ).isRequired,
      profile: PropTypes.shape({
        firstName: PropTypes.string,
        lastName: PropTypes.string,
      }),
    }),
  }

  Register.defaultProps = {
    user: null,
  }

  return (
    <Dialog
      fullScreen
      open={registrationOpen}
      onClose={handleClose}
      TransitionComponent={Transition}
      PaperProps={{ style: { backgroundColor: '#333', opacity: 0.95 } }}
    >
      <AppBar className={classes.appBar}>
        <Toolbar>
          {isAnon && (
            <IconButton
              edge="start"
              color="inherit"
              onClick={handleClose}
              aria-label="close"
            >
              <CloseIcon />
            </IconButton>
          )}
          <Typography variant="h6" className={classes.title}>
            Welcome to Slatebox!
          </Typography>
          <Typography variant="body2">{registrationMessage}</Typography>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xs" className={classes.main}>
        <div className={classes.paper}>
          <Avatar className={classes.avatar}>
            <LockOutlinedIcon />
          </Avatar>
          <Typography component="h1" variant="h5">
            {isAnon ? <>Sign up</> : <>Verify Email</>}
          </Typography>
          {registrationMessage && <Box mt={3}>{registrationMessage}</Box>}
          <div className={classes.form}>
            <Grid container spacing={2}>
              {isAnon && (
                <>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      autoComplete="fname"
                      name="firstName"
                      variant="outlined"
                      required
                      fullWidth
                      id="firstName"
                      label="First Name"
                      value={formVals.firstName.value}
                      onChange={(e) => {
                        set('firstName', e.target.value)
                      }}
                      error={formVals.firstName.valid === false}
                      autoFocus
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      variant="outlined"
                      required
                      fullWidth
                      id="lastName"
                      label="Last Name"
                      name="lastName"
                      autoComplete="lname"
                      value={formVals.lastName.value}
                      onChange={(e) => {
                        set('lastName', e.target.value)
                      }}
                      error={formVals.lastName.valid === false}
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Grid>
                </>
              )}
              <Grid item xs={12}>
                <Tooltip
                  title="You will need to verify this address to continue"
                  placement="top"
                >
                  <TextField
                    variant="outlined"
                    required
                    fullWidth
                    id="email"
                    label="Email Address"
                    name="email"
                    autoComplete="email"
                    value={formVals.email.value}
                    onChange={(e) => {
                      set('email', e.target.value)
                    }}
                    error={formVals.email.valid === false}
                    InputLabelProps={{
                      style: { color: '#fff' },
                    }}
                  />
                </Tooltip>
              </Grid>
              {isAnon && (
                <Grid item xs={12}>
                  <Tooltip title="At least 8 characters long" placement="top">
                    <TextField
                      variant="outlined"
                      required
                      fullWidth
                      name="password"
                      label="Password"
                      type="password"
                      id="password"
                      autoComplete="current-password"
                      value={formVals.password.value}
                      onChange={(e) => {
                        set('password', e.target.value)
                      }}
                      error={formVals.password.valid === false}
                      InputLabelProps={{
                        style: { color: '#fff' },
                      }}
                    />
                  </Tooltip>
                </Grid>
              )}
            </Grid>
            <Button
              type="button"
              fullWidth
              variant="contained"
              color="primary"
              onClick={invokeRegistration}
              className={classes.submit}
            >
              {actionValue}
            </Button>
            {!isAnon && !isVerified && emailSent && (
              <Grid
                container
                alignItems="center"
                justify="space-evenly"
                spacing={10}
              >
                <Grid item style={{ color: '#fff' }}>
                  Waiting for verification...
                </Grid>
                <Grid item>
                  <CircularProgress color="secondary" />
                </Grid>
              </Grid>
            )}
          </div>
        </div>
      </Container>
    </Dialog>
  )
}
