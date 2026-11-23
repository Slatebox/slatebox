/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable react/jsx-props-no-spreading */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom, useSetAtom } from 'jotai'
import Typography from '@mui/material/Typography'
import Stepper from '@mui/material/Stepper'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import Snackbar from '@mui/material/Snackbar'
import { Alert } from '@mui/material'
import Box from '@mui/material/Box'

import Avatar from '@mui/material/Avatar'
import { deepOrange } from '@mui/material/colors'
import CircularProgress from '@mui/material/CircularProgress'
import CONSTANTS from '../../../api/common/constants'
import InviteTeamMembers from './InviteTeamMembers'
import RequestPrivateBeta from './RequestPrivateBeta'

import { organizationInvites, orgCreated } from '../../jotai/atoms'

const styles = {
  root: {
    width: '100%',
  },
  button: {
    marginRight: (theme) => theme.spacing(1),
    color: (theme) => theme.palette.secondary.main,
  },
  instructions: {
    marginTop: (theme) => theme.spacing(5),
    marginBottom: (theme) => theme.spacing(5),
  },
  orange: {
    color: (theme) => theme.palette.getContrastText(deepOrange[500]),
    backgroundColor: deepOrange[500],
  },
}

function getSteps() {
  const isEd = Meteor.user()?.isEducationCertified
  return [
    `Create Your ${isEd ? 'Classroom' : 'Team'}`,
    `Add ${isEd ? 'Classroom Students' : 'Team Members'}`,
    `Send Invites`,
  ]
}

export default function CreateOrganization({ privateBetaAccess }) {
  const isEd = Meteor.user()?.isEducationCertified
  const [currentInvites, setCurrentInvites] = useAtom(organizationInvites)
  const setOrgCreated = useSetAtom(orgCreated)
  const [warningOpen, setWarningOpen] = React.useState(false)
  const [warning, setWarningText] = React.useState('')
  const [activeStep, setActiveStep] = React.useState(0)
  const steps = getSteps()
  const noSpecialChars = /^[_A-z0-9]*((-|\s| )*[_A-z0-9])*$/g
  const [teamName, setTeamName] = React.useState('')
  const closeWarning = () => {
    setWarningOpen(false)
  }

  async function finalize() {
    try {
      // create the team and attach it to this person
      const orgId = Meteor.user()?.orgId || await Meteor.callAsync(
        CONSTANTS.methods.organizations.create,
        { name: teamName, createdByUserId: Meteor.userId() }
      )

      // explicitly update the user with the orgId
      await Meteor.callAsync(CONSTANTS.methods.users.update, {
        userId: Meteor.userId(),
        orgId,
      })

      // invite users
      await Meteor.callAsync(CONSTANTS.methods.users.invite, {
        orgId,
        invites: currentInvites,
      })
      setCurrentInvites([])
      setOrgCreated({ orgId, name: teamName })
      // setActiveStep(3)
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
      setWarningText(
        `You have to add at least one ${isEd ? 'student' : 'team member'}!`
      )
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

  const handleTeamNameChange = (e) => {
    setTeamName(e.target.value)
    if (e.target.value.trim() === '') {
      setWarningText(`You must specify a ${isEd ? 'team' : 'classroom'} name.`)
      setWarningOpen(true)
    } else if (
      e.target.value.match(noSpecialChars) ||
      e.target.value.endsWith(' ')
    ) {
      setWarningOpen(false)
    } else {
      setWarningText(
        `Sorry, no special characters allowed in ${
          isEd ? 'team' : 'classroom'
        } name.`
      )
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
            color="secondary"
            id="teamName"
            label={`Name Your ${isEd ? 'Classroom' : 'Team'}`}
            value={teamName}
            error={!teamName.match(noSpecialChars) && !teamName.endsWith(' ')}
            onChange={handleTeamNameChange}
            autoFocus
          />
        )
      case 1: {
        return (
          <>
            <Box p={1} m={2}>
              <Typography variant="body1">
                Next, add some {isEd ? 'classroom' : 'team'}{' '}
                {isEd ? 'students' : 'members'} to join you at{' '}
                <Typography color="secondary" component="span">
                  <b>{teamName}</b>
                </Typography>
                . You will send the email invites on the next step.
                {Meteor.user().isEducationCertified
                  ? <> You can add as many classroom students as you&apos;d like!</>
                  : <> Invite as many people as you like. Each member can create unlimited slates.</>}
              </Typography>
            </Box>
            <Box m={2}>
              <InviteTeamMembers />
            </Box>
          </>
        )
      }
      case 2:
      case 3: {
        return (
          <Grid
            container
            spacing={4}
            alignItems="center"
            justifyContent="flex-start"
          >
            {step === 2 ? (
              <Grid size={12}>
                Hooray, {isEd ? 'classroom' : 'team'}{' '}
                <Typography color="secondary" component="span">
                  {teamName}
                </Typography>{' '}
                is ready! You have {currentInvites.length}{' '}
                {isEd ? 'student(s)' : 'member(s)'} ready to be emailed:
              </Grid>
            ) : (
              <Grid size={12}>Invites are on the way!</Grid>
            )}
            {currentInvites.map((i) => (
              <>
                <Grid size={1}>
                  <Box pl={5}>
                    <Avatar className={styles.orange} alt={i.firstName}>
                      {i.firstName.substring(0, 1).toUpperCase()}
                    </Avatar>
                  </Box>
                </Grid>
                <Grid size={3}>
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
      {privateBetaAccess ? (
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
            <Typography sx={styles.instructions}>
              {getStepContent(activeStep)}
            </Typography>
            <div>
              {activeStep === steps.length ? (
                <Grid
                  container
                  alignItems="center"
                  justifyContent="center"
                  spacing={10}
                >
                  <Grid sx={{ color: '#fff' }}>Sending invites…</Grid>
                  <Grid>
                    <CircularProgress color="secondary" />
                  </Grid>
                </Grid>
              ) : (
                <>
                  <Button disabled={activeStep === 0} onClick={handleBack}>
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    sx={{ ml: 1 }}
                    onClick={handleNext}
                  >
                    {activeStep === steps.length - 1 ? 'Send Invites' : 'Next'}
                  </Button>
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <RequestPrivateBeta />
      )}
    </>
  )
}

// CreateOrganization.propTypes = {
//   privateBetaAccess: PropTypes.bool,
// }

// CreateOrganization.PropTypes.defaultProps = {
//   privateBetaAccess: false,
// }
