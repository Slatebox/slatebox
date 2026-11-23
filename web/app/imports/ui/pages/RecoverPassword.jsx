import React from 'react'
import { Meteor } from 'meteor/meteor'
import Avatar from '@mui/material/Avatar'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import Typography from '@mui/material/Typography'
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'
import Link from '@mui/material/Link'
import Container from '@mui/material/Container'
import { useSetAtom } from 'jotai'
import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'

import { globalMessage } from '../jotai/atoms'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'

export default function RecoverPassword(props) {
  const theme = useTheme()
  const history = useNavigate(props)
  const setMessage = useSetAtom(globalMessage)
  const { email } = useParams()
  const [userEmail, setEmail] = React.useState(email)
  const [recoverySent, sentRecovery] = React.useState(false)

  if (Meteor.user()) {
    history('/')
  }

  const handleEmail = (e) => {
    setEmail(e.target.value)
  }

  const recover = async () => {
    const sent = await Meteor.callAsync(CONSTANTS.methods.users.resetPassword, {
      email: userEmail,
    })
    if (sent) {
      sentRecovery(true)
    } else {
      setMessage({
        visible: true,
        severity: 'error',
        text: `Oops! There is no user associated with ${userEmail}`,
        autoHide: 60000,
      })
    }
  }

  return (
    <Container component="main" maxWidth="xs">
      <Box
        sx={{
          marginTop: theme.spacing(8),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Avatar
          sx={{
            margin: theme.spacing(1),
            backgroundColor: theme.palette.secondary.main,
          }}
        >
          <LockOutlinedIcon />
        </Avatar>
        <Typography component="h1" variant="h5">
          Forgot Your Password? No Problem.
        </Typography>
        {!recoverySent && (
          <Grid
            container
            alignItems="center"
            justifyContent="space-evenly"
            sx={{
              width: '100%',
              height: '250px',
              marginTop: theme.spacing(1),
            }}
          >
            <Grid size={12}>
              <Typography component="h1" variant="body2">
                Provide your email below and we&apos;ll send you a recovery
                email.
              </Typography>
            </Grid>
            <Grid size={12}>
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
              />
            </Grid>
            <Grid>
              <Button component={RouterLink} to="/login" color="secondary">
                Login
              </Button>
            </Grid>
            <Grid>
              <Button variant="contained" color="secondary" onClick={recover}>
                Send Recovery Email
              </Button>
            </Grid>
          </Grid>
        )}
        {recoverySent && (
          <Grid
            container
            alignItems="center"
            justifyContent="center"
            sx={{
              width: '100%',
              height: '250px',
              marginTop: theme.spacing(1),
            }}
          >
            <Grid size={12}>
              <Typography component="h1" variant="subtitle1">
                Email sent! Please check your email and use the link to reset
                your password.
              </Typography>
            </Grid>
          </Grid>
        )}
      </Box>
    </Container>
  )
}
