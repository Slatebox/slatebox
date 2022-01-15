import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useHistory } from "react-router-dom";
import { useLocation } from "react-router";
import { useTracker } from 'meteor/react-meteor-data';
import { makeStyles } from '@material-ui/core/styles';
import { useDispatch, useSelector } from 'react-redux'

import Typography from '@material-ui/core/Typography';
import Stepper from '@material-ui/core/Stepper';
import Step from '@material-ui/core/Step';
import StepLabel from '@material-ui/core/StepLabel';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import TextField from '@material-ui/core/TextField';
import Snackbar from '@material-ui/core/Snackbar';
import Alert from '@material-ui/lab/Alert';
import { InviteTeamMembers } from './InviteTeamMembers';
import Box from '@material-ui/core/Box';
import Avatar from '@material-ui/core/Avatar';
import { deepOrange } from '@material-ui/core/colors';
import { CONSTANTS } from '../../../api/common/constants.js' 
import { promisify } from '../../../api/client/promisify.js';
import CircularProgress from '@material-ui/core/CircularProgress';
import { Organizations } from '../../../api/common/models';


const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
  },
  button: {
    marginRight: theme.spacing(1),
  },
  instructions: {
    color: "#fff",
    marginTop: theme.spacing(5),
    marginBottom: theme.spacing(5),
  },
  orange: {
    color: theme.palette.getContrastText(deepOrange[500]),
    backgroundColor: deepOrange[500],
  },
}));

function getSteps() {
  return ['Create Your Team', 'Add Team Members', 'Send Invites'];
}

export const CreateOrganization = () => {
  const dispatch = useDispatch();

  if (Meteor.user() && Meteor.user().isAnonymous) {
    dispatch({
      type: "registration"
      , registrationOpen: true
      , registrationMessage: `Before you can create a team, please register and verify your email!`
      , paymentWillBeRequested: false
    });
    return null;
  }

  const classes = useStyles();
  const [activeStep, setActiveStep] = React.useState(0);
  const steps = getSteps();
  let noSpecialChars = new RegExp("^[_A-z0-9]*((-|\\s| )*[_A-z0-9])*$", "g");

  const [teamName, setTeamName] = React.useState("");
  const handleTeamNameChange = (e) => {
    setTeamName(e.target.value);
    console.log("match?", e.target.value, e.target.value.match(noSpecialChars));
    if (e.target.value.trim() === "") {
      setWarningText("You must specify a team name.");
      setWarningOpen(true);
    } else if (e.target.value.match(noSpecialChars) || e.target.value.endsWith(" ")) {
      setWarningOpen(false);
    } else {
      setWarningText("Sorry, no special characters allowed in team name.");
      setWarningOpen(true);
    }
  }

  const currentInvites = useSelector(state => state.currentInvites) || [];

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
            error={!teamName.match(noSpecialChars) && !teamName.endsWith(" ")}
            onChange={handleTeamNameChange}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
            autoFocus
          />
        );
      case 1: {
        return (
          <Box>
            <Box m={2}>
              <Typography variant="body1">
                Next, add some team members to join you at <Typography color="secondary" component="span">{teamName}</Typography>. You will send the email invites on the next step.
              </Typography>
            </Box>
            <Box pl={2} pr={2} m={2}>
              <Typography variant="subtitle2">
                { !Organizations.findOne() || Organizations.findOne()?.planType === "free"
                ? <>You can add as many team members as you'd like on the forever free team plan. You have access to 3 private slates and unlimited public slates.</>
                : <>Congratulations, you&apos;ve already upgraded to Slatebox Pro! Team members are $5/mo (billed annually).</>
                }
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
              {step === 2 
                ? (
                  <Grid item xs={12}>
                    Hooray, team <Typography color="secondary" component="span">{teamName}</Typography> is ready! You have {currentInvites.length} member(s) ready to be emailed:
                  </Grid>
                )
                : (
                  <Grid item xs={12}>
                    Invites are on the way!
                  </Grid>
                )
              }
              {currentInvites.map((i) => (
                <>
                  <Grid item xs={1}>
                    <Box pl={5}>
                      <Avatar className={classes.orange} alt={i.firstName}>{i.firstName.substring(0,1).toUpperCase()}</Avatar>
                    </Box>
                  </Grid>
                  <Grid item xs={3}>
                    {i.email} - {i.firstName} {i.lastName}
                  </Grid>
                </>
              ))}
            </Grid>
        );
      }
      default:
        return 'Unknown step';
    }
  }

  async function finalize() {
    try {

      //create org (removes planType from user, attaches planType to user, attaches orgId to user)
      let orgId = await promisify(Meteor.call, CONSTANTS.methods.organizations.create, { name: teamName, createdByUserId: Meteor.userId() });

      //explicitly update the user with the orgId
      await promisify(Meteor.call, CONSTANTS.methods.users.update, { userId: Meteor.userId(), orgId: orgId });

      //invite users
      console.log("sending invites ", currentInvites);
      await promisify(Meteor.call, CONSTANTS.methods.users.invite, { orgId: orgId, invites: currentInvites });
      dispatch({ type: "canvas", currentInvites: [] });

    } catch (err) {
      setWarningText(`There was a problem inviting these users: ${err.message}`);
      setWarningOpen(true);
      setActiveStep(2);
    }
  }

  const handleNext = () => {
    if (activeStep === 0 && teamName.trim() === "") {
      setWarningText("You must specify a team name.");
      setWarningOpen(true);
    } else if (activeStep === 1 && currentInvites.length === 0) {
      setWarningText("You have to add at least one team member!");
      setWarningOpen(true);
    } else {
      setWarningText("");
      setWarningOpen(false);
      setActiveStep((prevActiveStep) => prevActiveStep + 1);
    }
    if (activeStep === 2) {
      finalize();
    }
  };

  const handleBack = () => {
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const [warningOpen, setWarningOpen] = React.useState(false);
  const [warning, setWarningText] = React.useState('');
  const closeWarning = (e) => {
    setWarningOpen(false);
  }

  return (
    <>
      {warningOpen && <Snackbar anchorOrigin={{vertical: 'top', horizontal: 'center'}} open={warningOpen} onClose={closeWarning}>
        <Alert severity="error">
          {warning}
        </Alert>
      </Snackbar>}
      <Stepper activeStep={activeStep}>
        {steps.map((label, index) => {
          const stepProps = {};
          const labelProps = {};
          return (
            <Step key={label} {...stepProps}>
              <StepLabel {...labelProps}>{label}</StepLabel>
            </Step>
          );
        })}
      </Stepper>
      <div>
        <Typography className={classes.instructions}>{getStepContent(activeStep)}</Typography>
        <div>
          {activeStep === steps.length
          ? (
            <Grid container alignItems="center" justify="center" spacing={10}>
              <Grid item style={{color:"#fff"}}>
                Sending invites...
              </Grid>
              <Grid item>
                <CircularProgress color="secondary" />
              </Grid>
            </Grid>
          )
          : (
            <>
              <Button disabled={activeStep === 0} onClick={handleBack} className={classes.button}>
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
    </>);
}