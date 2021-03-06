/* eslint-disable react/jsx-props-no-spreading */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles'
import { useDispatch, useSelector } from 'react-redux'

import Typography from '@material-ui/core/Typography'
import Stepper from '@material-ui/core/Stepper'
import Step from '@material-ui/core/Step'
import StepLabel from '@material-ui/core/StepLabel'
import Button from '@material-ui/core/Button'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
import Snackbar from '@material-ui/core/Snackbar'
import Alert from '@material-ui/lab/Alert'
import Box from '@material-ui/core/Box'
import Avatar from '@material-ui/core/Avatar'
import { deepOrange } from '@material-ui/core/colors'
import CircularProgress from '@material-ui/core/CircularProgress'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import InviteTeamMembers from './InviteTeamMembers'
import { Organizations } from '../../../api/common/models'

const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
  },
  button: {
    marginRight: theme.spacing(1),
  },
  instructions: {
    color: '#fff',
    marginTop: theme.spacing(5),
    marginBottom: theme.spacing(5),
  },
  orange: {
    color: theme.palette.getContrastText(deepOrange[500]),
    backgroundColor: deepOrange[500],
  },
}))

function getSteps() {
  return ['Create Your Team', 'Add Team Members', 'Send Invites']
}

export default function CreateOrganization() {
  const dispatch = useDispatch()
  const currentInvites = useSelector((state) => state.currentInvites) || []
  const [warningOpen, setWarningOpen] = React.useState(false)
  const [warning, setWarningText] = React.useState('')
  const classes = useStyles()
  const [activeStep, setActiveStep] = React.useState(0)
  const steps = getSteps()
  const noSpecialChars = /^[_A-z0-9]*((-|\s| )*[_A-z0-9])*$/g
  const [teamName, setTeamName] = React.useState('')
  const closeWarning = () => {
    setWarningOpen(false)
  }

  async function finalize() {
    try {
      // create org (removes planType from user, attaches planType to user, attaches orgId to user)
      const orgId = await promisify(
        Meteor.call,
        CONSTANTS.methods.organizations.create,
        { name: teamName, createdByUserId: Meteor.userId() }
      )

      // explicitly update the user with the orgId
      await promisify(Meteor.call, CONSTANTS.methods.users.update, {
        userId: Meteor.userId(),
        orgId,
      })

      // invite users
      await promisify(Meteor.call, CONSTANTS.methods.users.invite, {
        orgId,
        invites: currentInvites,
      })
      dispatch({ type: 'canvas', currentInvites: [] })
    } catch (err) {
      setWarningText(`There was a problem inviting these users: ${err.message}`)
      setWarningOpen(true)
      setActiveStep(2)
    }
  }

  const handleNext = () => {
    if (activeStep === 0 && teamName.trim() === '') {
      setWarningText('You must specify a team name.')
      setWarningOpen(true)
    } else if (activeStep === 1 && currentInvites.length === 0) {
      setWarningText('You have to add at least one team member!')
      setWarningOpen(true)
    } else {
      setWarningText('')
      setWarningOpen(false)
      setActiveStep((prevActiveStep) => prevActiveStep + 1)
    }
    if (activeStep === 2) {
      finalize()
    }
  }

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1)
  }

  if (Meteor.user() && Meteor.user().isAnonymous) {
    dispatch({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: `Before you can create a team, please register and verify your email!`,
      paymentWillBeRequested: false,
    })
    return null
  }

  const handleTeamNameChange = (e) => {
    setTeamName(e.target.value)
    if (e.target.value.trim() === '') {
      setWarningText('You must specify a team name.')
      setWarningOpen(true)
    } else if (
      e.target.value.match(noSpecialChars) ||
      e.target.value.endsWith(' ')
    ) {
      setWarningOpen(false)
    } else {
      setWarningText('Sorry, no special characters allowed in team name.')
      setWarningOpen(true)
    }
  }

  function getStepContent(step) {
    switch (step) {
      case 0:
        return (
          <TextField
            name="teamName"
            variant="outlined"
            fullWidth
            id="teamName"
            label="Name Your Team"
            value={teamName}
            error={!teamName.match(noSpecialChars) && !teamName.endsWith(' ')}
            onChange={handleTeamNameChange}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
            autoFocus
          />
        )
      case 1: {
        return (
          <Box>
            <Box m={2}>
              <Typography variant="body1">
                Next, add some team members to join you at{' '}
                <Typography color="secondary" component="span">
                  {teamName}
                </Typography>
                . You will send the email invites on the next step.
              </Typography>
            </Box>
            <Box m={2}>
              <InviteTeamMembers />
            </Box>
          </Box>
        )
      }
      case 2:
      case 3: {
        return (
          <Grid container spacing={4} alignItems="center" justify="flex-start">
            {step === 2 ? (
              <Grid item xs={12}>
                Hooray, team{' '}
                <Typography color="secondary" component="span">
                  {teamName}
                </Typography>{' '}
                is ready! You have {currentInvites.length} member(s) ready to be
                emailed:
              </Grid>
            ) : (
              <Grid item xs={12}>
                Invites are on the way!
              </Grid>
            )}
            {currentInvites.map((i) => (
              <>
                <Grid item xs={1}>
                  <Box pl={5}>
                    <Avatar className={classes.orange} alt={i.firstName}>
                      {i.firstName.substring(0, 1).toUpperCase()}
                    </Avatar>
                  </Box>
                </Grid>
                <Grid item xs={3}>
                  {i.email} - {i.firstName} {i.lastName}
                </Grid>
              </>
            ))}
          </Grid>
        )
      }
      default:
        return 'Unknown step'
    }
  }

  return (
    <>
      {warningOpen && (
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          open={warningOpen}
          onClose={closeWarning}
        >
          <Alert severity="error">{warning}</Alert>
        </Snackbar>
      )}
      <Stepper activeStep={activeStep}>
        {steps.map((label) => {
          const stepProps = {}
          const labelProps = {}
          return (
            <Step key={label} {...stepProps}>
              <StepLabel {...labelProps}>{label}</StepLabel>
            </Step>
          )
        })}
      </Stepper>
      <div>
        <Typography className={classes.instructions}>
          {getStepContent(activeStep)}
        </Typography>
        <div>
          {activeStep === steps.length ? (
            <Grid container alignItems="center" justify="center" spacing={10}>
              <Grid item style={{ color: '#fff' }}>
                Sending invites...
              </Grid>
              <Grid item>
                <CircularProgress color="secondary" />
              </Grid>
            </Grid>
          ) : (
            <>
              <Button
                disabled={activeStep === 0}
                onClick={handleBack}
                className={classes.button}
              >
                Back
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleNext}
                className={classes.button}
              >
                {activeStep === steps.length - 1 ? 'Send Invites' : 'Next'}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
