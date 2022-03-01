import React from 'react'
import { Meteor } from 'meteor/meteor'
import Avatar from '@material-ui/core/Avatar'
import LockOutlinedIcon from '@material-ui/icons/LockOutlined'
import Typography from '@material-ui/core/Typography'
import { makeStyles } from '@material-ui/core/styles'
import { Link as RouterLink, useHistory, useParams } from 'react-router-dom'
import Link from '@material-ui/core/Link'
import Container from '@material-ui/core/Container'
import { useDispatch } from 'react-redux'
import Button from '@material-ui/core/Button'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
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
    height: '250px',
    marginTop: theme.spacing(1),
  },
  submit: {
    margin: theme.spacing(3, 0, 2),
  },
  register: {
    margin: theme.spacing(3, 0, 2),
  },
}))

export default function RecoverPassword(props) {
  const classes = useStyles()
  const history = useHistory(props)
  const dispatch = useDispatch()
  const { email } = useParams()
  const [userEmail, setEmail] = React.useState(email)
  const [recoverySent, sentRecovery] = React.useState(false)

  if (Meteor.user()) {
    history.push('/')
  }

  const handleEmail = (e) => {
    setEmail(e.target.value)
  }

  const recover = async () => {
    const sent = await promisify(
      Meteor.call,
      CONSTANTS.methods.users.resetPassword,
      {
        email: userEmail,
      }
    )
    if (sent) {
      sentRecovery(true)
    } else {
      dispatch({
        type: 'canvas',
        globalMessage: {
          visible: true,
          severity: 'error',
          text: `Oops! There is no user associated with ${userEmail}`,
          autoHide: 60000,
        },
      })
    }
  }

  return (
    <Container component="main" maxWidth="xs">
      <div className={classes.paper}>
        <Avatar className={classes.avatar}>
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
          Forgot Your Password? No Problem.
        </Typography>
        {!recoverySent && (
          <Grid
            container
            alignItems="center"
            justify="space-evenly"
            className={classes.form}
          >
            <Grid item xs={12}>
              <Typography
                component="h1"
                variant="body2"
                style={{ color: '#fff' }}
              >
                Provide your email below and we&apos;ll send you a recovery
                email.
              </Typography>
            </Grid>
            <Grid item xs={12}>
              <TextField
                variant="outlined"
                required
                fullWidth
                id="email"
                label="Email Address"
                name="email"
                autoComplete="email"
                value={userEmail}
                onChange={handleEmail}
                error={userEmail && userEmail.indexOf('@') === -1}
                autoFocus
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </Grid>
            <Grid item>
              <Link
                component={RouterLink}
                to="/login"
                variant="body2"
                style={{ color: '#fff' }}
              >
                Login
              </Link>
            </Grid>
            <Grid item>
              <Button variant="outlined" color="secondary" onClick={recover}>
                Send Recovery Email
              </Button>
            </Grid>
          </Grid>
        )}
        {recoverySent && (
          <Grid
            container
            alignItems="center"
            justify="center"
            className={classes.form}
          >
            <Grid item xs={12}>
              <Typography
                component="h1"
                variant="subtitle1"
                style={{ color: '#fff' }}
              >
                Email sent! Please check your email and use the link to reset
                your password.
              </Typography>
            </Grid>
          </Grid>
        )}
      </div>
    </Container>
  )
}
