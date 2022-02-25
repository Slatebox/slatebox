import React from 'react';
import { Meteor } from 'meteor/meteor';
import { useHistory } from "react-router-dom";
import { useLocation } from "react-router";
import { useTracker } from 'meteor/react-meteor-data';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import DeleteIcon from '@material-ui/icons/Delete';
import { useDispatch, useSelector } from 'react-redux'


import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableContainer from '@material-ui/core/TableContainer';
import TableHead from '@material-ui/core/TableHead';
import TableRow from '@material-ui/core/TableRow';
import Paper from '@material-ui/core/Paper';

import Typography from '@material-ui/core/Typography';
import Stepper from '@material-ui/core/Stepper';
import Step from '@material-ui/core/Step';
import StepLabel from '@material-ui/core/StepLabel';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import TextField from '@material-ui/core/TextField';
import Snackbar from '@material-ui/core/Snackbar';
import Alert from '@material-ui/lab/Alert';
import IconButton from '@material-ui/core/IconButton';
import Checkbox from '@material-ui/core/Checkbox';
import Tooltip from '@material-ui/core/Tooltip';
import InfoIcon from '@material-ui/icons/Info';
import MailOutlineIcon from '@material-ui/icons/MailOutline';

import confirmService from '../../common/confirm';
import { Permissions, Claims, Slates, Organizations } from '../../../api/common/models.js';
import AuthManager from '../../../api/common/AuthManager.js';
import { CONSTANTS } from '../../../api/common/constants.js';
import { promisify } from '../../../api/client/promisify.js';
import { InviteTeamMembers } from './InviteTeamMembers.jsx';
import Box from '@material-ui/core/Box';

const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
    marginTop: theme.spacing(3),
    overflowX: "auto"
  },
  table: {
    minWidth: 2400
  },
  lightRow: {
    background: "#424242"
  },
  darkRow: {
    background: "#303030"
  },
  sticky: {
    width: 300,
    position: "sticky",
    left: 0,
    backgroundColor: "#424242",
    zIndex: 999,
    boxShadow: "2px 2px 2px #000"
  }
}));

export const ManageOrganization = (props) => {
  const classes = useStyles();
  const theme = useTheme();
  const dispatch = useDispatch();
  const currentInvites = useSelector(state => state.currentInvites) || [];
  const members = useTracker(() => {
    return Meteor.users.find({ _id: { $ne: Meteor.userId() }, isOrgOwner: { $ne: true } }).fetch();
  });

  const claims = useTracker(() => {
    if (AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.admin._id])) {
      return Claims.find({ description: { $exists: true } }).fetch();
    } else {
      return Claims.find({ _id: { $ne: CONSTANTS.claims.admin._id }, description: { $exists: true } }).fetch();
    }
  });

  const permissions = useTracker(() => {
    return Permissions.find().fetch();
  });

  async function removeMember(member) {
    const userDetails = await promisify(Meteor.call, CONSTANTS.methods.users.get, { _id: member._id, includeSlateCounts: true });
    const res = await confirmService.show({
      theme: theme,
      title: "Remove user?",
      message: `<p>Are you certain you want to remove ${member.profile.firstName} ${member.profile.lastName} (${member.emails[0].address})? Note that the ${userDetails[0].slateCount} slate(s) attached to them will be also be removed. <b>This delete CANNOT be undone.</b></p>`,
      actionItems: [
        { label: "Cancel", return: false },
        { label: "OK", return: true }
      ]
    });
    if (res) {
      //remove user
      Meteor.users.remove({ _id: member._id });
      Slates.find({ userId: member.userId }).fetch().forEach((s) => {
        Slates.remove({ _id: s._id });
      });
    }
    
  }

  function isDisabled(member, claim) {
    // if (AuthManager.userHasClaim(member._id, [CONSTANTS.claims.admin._id]) && !Meteor.user().isOrgOwner) {
    //   return true;
    // } else {
      return !AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canEditUsers._id]);
    //}
  }

  function isChecked(member, claim) {
    return AuthManager.userHasClaim(member._id, [claim._id]);
  }

  async function handleChange(member, prop, val) {
    const update = await promisify(Meteor.call, CONSTANTS.methods.users.update, { [prop]: val, userId: member._id });
    if (update) {
      //dispatch({ type: "canvas", globalMessage: { visible: false, isSnackBar: true, text: update, severity: "info", autoHide: 10000 } });
    } else {
      dispatch({ type: "canvas", globalMessage: { visible: false, isSnackBar: true, text: update, severity: "error", autoHide: 10000 } });
    }
  }

  async function handleEmailChange(member, prop) {
    const result = await confirmService.show({
      theme: theme,
      title: `Change Email`,
      message: `Change the user's email from <b>${member.emails[0].address}</b> to: <div style="padding:10px"><input type="email" style="width: 300px;height:30px;" id="txtNewEmail" value="${member.emails[0].address}"/></div>`,
      actionItems: [{ label: "Send New Enrollment Email", return: true }, { label: "Cancel", return: false }]
    });
    if (result) {
      let newEmail = document.getElementById('txtNewEmail').value;
      if (newEmail === member.emails[0].address) {
        dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, text: `No enrollment email sent: the email stayed the same (${newEmail}).`, severity: "error", autoHide: 10000 } });
      } else {
        // ensure email is not used elsewhere
        let others = await promisify(Meteor.call, CONSTANTS.methods.users.get, { email: newEmail, count: true });
        if (others > 0) {
          dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, text: `This email is already in use, please choose a different one or contact support`, severity: "error", autoHide: 50000 } });
        } else {
          console.log("changing user email", member._id, prop, newEmail);
          const update = await promisify(Meteor.call, CONSTANTS.methods.users.update, { [prop]: newEmail, userId: member._id });
          if (update) {
            dispatch({ type: "canvas", globalMessage: { visible: false, isSnackBar: true, text: update, severity: "info", autoHide: 10000 } });
          } else {
            dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, text: update, severity: "error", autoHide: 50000 } });
          }
        }
      }
    }
  }

  async function handlePermission(member, claim, isChecked) {
    let update = await promisify(Meteor.call, CONSTANTS.methods.users.changeRoles, {
      users: [
        {
          orgId: member.orgId,
          userId: member._id,
          claimIds: [claim._id],
          action: isChecked ? "add" : "delete"
        }
      ]
    });
    if (update) {
      //dispatch({ type: "canvas", globalMessage: { visible: false, isSnackBar: true, text: update, severity: "info", autoHide: 10000 } });
    } else {
      dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, text: update, severity: "error", autoHide: 10000 } });
    }
  }

  async function inviteNewMembers() {
    try {
      if (currentInvites.length > 0) {
        //free plans can invite as many users as they want
        await promisify(Meteor.call, CONSTANTS.methods.users.invite, { orgId: Meteor.user().orgId, invites: currentInvites });
        dispatch({ type: "canvas", currentInvites: [] });
      } else {
        dispatch({ type: "canvas", theme: theme, globalMessage: { visible: true, isSnackBar: true, text: `You haven't added any team members to invite yet!`, severity: "error", autoHide: 10000 } });
      }
    } catch (err) {
      dispatch({ type: "canvas", theme: theme, globalMessage: { visible: true, isSnackBar: true, text: `There was a problem inviting these users: ${err.message}`, severity: "error", autoHide: 10000 } });
    }
  }

  async function resendEnrollment(user) {
    const res = await confirmService.show({
      theme: theme,
      title: "Resend enrollment email?",
      message: `<p>Click OK to resend the user's enrollment email to ${user.emails[0].address}.</p>`,
      actionItems: [
        { label: "Cancel", return: false },
        { label: "OK", return: true }
      ]
    });
    if (res) {
      await promisify(Meteor.call, CONSTANTS.methods.users.resendEnrollment, { users: [user] });
      dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, severity: "info", text: `Enrollment email resent to ${user.emails[0].address}`, autoHide: 10000 } });
    }
  }

  return (
    <>
    <TableContainer component={Paper} className={classes.root}>
      <Table className={classes.table} stickyHeader size="small">
        <TableHead>
          <TableRow>
            <TableCell className={classes.sticky}>
              Name / Email
            </TableCell>
            {claims.map((claim) => (
              <TableCell key={claim._id}>
                {claim.label} <br/> <Typography color="secondary" variant="caption">{claim.description}</Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {members.length === 0 && 
             <TableRow>
               <TableCell colSpan={6} align="center">
                 <Typography color="secondary">You have no team members defined. Invite some below!</Typography>
               </TableCell>
             </TableRow>
          }
          {members.map((member, index) => (
            <TableRow key={index} className={index % 2 ? classes.darkRow : classes.lightRow}>
              {AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canEditUsers._id]) ? 
                <TableCell className={classes.sticky}>
                  <Grid container alignItems="top" justify="flex-end">
                    <Grid item xs={2}>
                      {AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canRemoveUsers._id]) &&
                        <IconButton aria-label="delete" onClick={(e) => { removeMember(member) }}>
                          <DeleteIcon />
                        </IconButton>
                      }
                    </Grid>
                    <Grid item xs={2}>
                      { member && member.emails && member.emails[0] && !member.emails[0].verified &&
                          <Tooltip color="secondary" title="User has not enrolled in the team yet. Click to resend the enrollment email.">
                            <IconButton aria-label="resendEnrollment" onClick={(e) => { resendEnrollment(member) }}>
                              <MailOutlineIcon color="error" />
                            </IconButton>
                          </Tooltip>
                        }
                    </Grid>
                    <Grid item xs={4}>
                      <TextField 
                        placeholder="First Name"
                        fullWidth 
                        value={ member.profile ? member.profile.firstName : "" } onChange={(e) => handleChange(member, "firstName", e.target.value)}
                        InputLabelProps={{
                          style: { color: '#fff' },
                        }}
                      /> 
                    </Grid>
                    <Grid item xs={4}>
                      <TextField 
                        placeholder="Last Name"
                        fullWidth 
                        value={ member.profile ? member.profile.lastName : "" } onChange={(e) => handleChange(member, "lastName", e.target.value)}
                        InputLabelProps={{
                          style: { color: '#fff' },
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Button variant="text" onClick={(e) => handleEmailChange(member, "email")}>{ member.emails && member.emails[0] ? member.emails[0].address : "" }</Button> 
                    </Grid>
                  </Grid>
                </TableCell>
              :
                <TableCell className={classes.sticky}>
                  {member.profile.firstName} {member.profile.lastName}<br/>
                  {member.emails[0].address}
                </TableCell>
              }
              {claims.map((claim) => (
                <TableCell key={claim._id}>
                  <Tooltip title={isDisabled(member, claim) ? <>You do not have permission to change {claim.label.toLowerCase()}</> : <>{claim.label} </>}>
                    <Checkbox name={claim._id} checked={isChecked(member, claim)} onClick={(e) => { handlePermission(member, claim, e.target.checked); }} disabled={isDisabled(member, claim)} />
                  </Tooltip>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
    {AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canAddUsers._id]) &&
      <Box m={2} p={2}>
        <Grid container spacing={2} alignItems="center" justify="center">
          <Grid item xs={12}>
            <Typography color="secondary">Invite New Member(s)</Typography>
          </Grid>
          <Grid item xs={12}>
            <InviteTeamMembers/>
          </Grid>
          <Grid item>
            <Button variant="contained" color="secondary" onClick={inviteNewMembers}>Send Invites</Button>
          </Grid>
        </Grid>
      </Box>
    }
    </>
  );
}