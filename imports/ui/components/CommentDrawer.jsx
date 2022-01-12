import React, { useEffect, useState } from 'react';
import cloneDeep from 'lodash.clonedeep';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { makeStyles } from '@material-ui/core/styles';
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer';
import clsx from 'clsx';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';

import { NodeColor } from './node/NodeColor.jsx';
import { NodeText } from './node/NodeText.jsx';
import { NodeShape } from './node/NodeShape.jsx';
import { NodeImage } from './node/NodeImage.jsx';
import { NodeEffect } from './node/NodeEffect.jsx';

import { promisify } from '../../api/client/promisify.js';

import LockIcon from '@material-ui/icons/Lock';
import LockOpenIcon from '@material-ui/icons/LockOpen';
import EditIcon from '@material-ui/icons/Edit';
import DeleteIcon from '@material-ui/icons/Delete';
import CancelIcon from '@material-ui/icons/Cancel';
import DoneIcon from '@material-ui/icons/Done';
import WarningIcon from '@material-ui/icons/Warning';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import Tooltip from '@material-ui/core/Tooltip';
import { useDispatch, useSelector } from 'react-redux';
import { useTracker } from 'meteor/react-meteor-data';
import { Messages, Tags, Comments } from '../../api/common/models.js';
import { CONSTANTS } from '../../api/common/constants.js';
import TableContainer from '@material-ui/core/TableContainer';
import Table from '@material-ui/core/Table';
import TableRow from '@material-ui/core/TableRow';
import TableCell from '@material-ui/core/TableCell';
import IconButton from '@material-ui/core/IconButton';
import TableBody from '@material-ui/core/TableBody';
import Switch from '@material-ui/core/Switch';
import AuthManager from '../../api/common/AuthManager.js';
import { Mention, MentionsInput } from 'react-mentions';
import { getUserName } from '../../api/common/getUserName.js';
import Paper from '@material-ui/core/Paper';
import Button from '@material-ui/core/Button';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';
import Grid from '@material-ui/core/Grid';
import Container from '@material-ui/core/Container';
import Divider from '@material-ui/core/Divider';
import Chip from '@material-ui/core/Chip';
import { utils } from '../../api/common/utils.js';

import { useTheme } from '@material-ui/core/styles';


const useStyles = makeStyles((theme) => ({
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: "100vh",
    width: "300px"
  },
  content: {
    margin: theme.spacing(1)
  },
  whiteText: {
    color: '#fff'
  },
  iconTab: {
    minWidth: 50,
    width: 50,
  },
  lightRow: {
    background: "#424242"
  },
  darkRow: {
    background: "#303030"
  },
  mentionsInput: {
    color: "#fff",
    padding: "5px",
    margin: "3px",
    "& textarea": {
      color: "#fff",
      minHeight: "80px",
      "fontSize": "13pt"
    }
  }
}));

export const CommentDrawer = (props) => {

  const [editableComment, setEditableComment] = React.useState(null);
  const [comment, setComment] = React.useState("");
  const classes = useStyles();
  const dispatch = useDispatch();
  const theme = useTheme();

  const members = useTracker(() => {
    if (!Meteor.user() && props.orgId && props.slateId) {
      // console.log("getting members for guest", { orgId: props.orgId, slateId: props.slateId });
      Meteor.subscribe(CONSTANTS.publications.orgUsersForGuest, { orgId: props.orgId, slateId: props.slateId });
    }
    return Meteor.users.find({ _id: { $ne: Meteor.userId() } }).fetch().map((u) => { 
      return { id: u._id, display: getUserName(u._id) };
    });
  });

  // console.log("members are ", members);

  const tags = useTracker(() => {
    return Tags.find({ $or: [{ orgId: props.orgId }, { global: true }] }).fetch().map((t) => { 
      return { id: t._id, display: t.name }; 
    });
  });

  let comments = useTracker(() => {
    return Comments.find({ nodeId: props.nodeId }, { sort: { timestamp: -1 }}).fetch();
  });

  let resolveCommentSwitched = comments.every(c => c.resolved);

  // console.log("comments are resolved ", resolveCommentSwitched);

  async function resolveComments(e) {
    // console.log("resolving comments ", e.target.checked, props.slateId, props.nodeId);
    await promisify(Meteor.call, CONSTANTS.methods.comments.toggleResolve, { resolved: e.target.checked, slateId: props.slateId, nodeId: props.nodeId });
    return true;
  }

  async function deleteComment(c) {
    await promisify(Meteor.call, CONSTANTS.methods.comments.remove, { commentId: c._id });
  }

  function handleCommentChange(e) {
    setComment(e.target.value);
  }

  function sendComment() {
    if (comment.trim() !== "") {
      let comm = { timestamp: new Date().valueOf(), createdByUserId: Meteor.userId(), createdByUserName: getUserName(Meteor.userId()), mentionedTeamMembers: attachedTeamMembers(), text: comment, read: false, priority: 5, slateId: props.slateId, nodeId: props.nodeId, resolved: false };
      let commId = Comments.insert(comm);
      const note = `[${props.slateName}] from ${getUserName(Meteor.userId())}: ${cleanTextForDisplay(comment)}`
      attachedTeamMembers().forEach(tm => {
        Messages.insert({ timestamp: new Date().valueOf(), commentId: commId, userId: tm, text: note, read: false, priority: 5, slateId: props.slateId, nodeId: props.nodeId, action: { type: CONSTANTS.messageActionTypes.slate, toolTip: `Go to the slate to reply to this comment` } });
      });
      setComment("");
    } else {
      dispatch({ type: "canvas", globalMessage: { visible: true, text: `Oops, you forgot the comment`, severity: "error", autoHide: 10000 } });
    }
  }

  function editComment(c) {
    // console.log("editing comment", c);
    setEditableComment(c);
  }

  async function saveEditableComment() {
    Comments.update({ _id: editableComment._id }, { $set: { text: editableComment.text, resolved: false, mentionedTeamMembers: attachedTeamMembers() }});
    //remove all the old messages based on this commentId and recreate them
    await promisify(Meteor.call, CONSTANTS.methods.messages.recreateMessagesForComment, { commentId: editableComment._id, text: cleanTextForDisplay(editableComment.text), mentionedTeamMembers: attachedTeamMembers(), slateId: props.slateId, nodeId: props.nodeId, userId: Meteor.userId() });
    setEditableComment(null);
  }

  function discardEditableComment() {
    setEditableComment(null);
  }

  function attachedTeamMembers() {
    let base = editableComment ? editableComment.text : comment;
    let userIds = Meteor.users.find().fetch().map(m => m._id);
    // console.log("checking base filter ", base, userIds);
    // console.log("returning attached userIds", userIds.filter(u => base.includes(u)));
    return userIds.filter(u => base.includes(u));
  }

  function cleanTextForDisplay(text) {
    // console.log('text to clean is ', text);
    let usersReg = new RegExp("[(.*?)]", "g");
    let idReg = new RegExp(Meteor.users.find().fetch().map(m => m._id).join("|"), "g");
    return text.split(usersReg).map(u => {
      return u.replace("[", "").replace("]", "").replace(idReg, "").trim()
    }).join(" ").trim();
    //hey @[Anna Heckel](X5sFL2wYzS9cmfuMd) and @[Sam Heck](qarSy3yxbbpCkKf66) and @[Bob Thornton](vCwNbLejfYqA5d9HY) - let's do this
  }

  function updateComment(e) {
    let uc = cloneDeep(editableComment);
    uc.text = e.target.value;
    // console.log("update editable ", uc.text);
    setEditableComment(uc);
  }

  function renderUserSuggestion(entry, search, highlightedDisplay, index, focused) {
    return (
      <Box p={1}>
        <Typography color="secondary" variant="overline" className={`user ${focused ? 'focused' : ''}`}>
          {highlightedDisplay}
        </Typography>
      </Box>
    );
    //return (<div>{entry}</div>);
  }

  // function renderTagSuggestion() {

  // }

  const mentionInputStyle = {
    control: {
      backgroundColor: '#222',
      fontSize: 14,
      fontWeight: 'normal',
      padding: 0,
      margin: 0
    },
    '&multiLine': {
      highlighter: {
        padding: 9,
        border: '1px solid transparent',
      },
      input: {
        padding: 9,
        border: '1px solid silver',
      },
    },
    suggestions: {
      list: {
        backgroundColor: 'white',
        border: '1px solid rgba(0,0,0,0.15)',
        fontSize: 14,
      },
      item: {
        padding: '5px 15px',
        borderBottom: '1px solid rgba(0,0,0,0.15)',
        '&focused': {
          backgroundColor: '#cee4e5',
        },
      },
    },
  };

  let canRemoveComments = AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.canRemoveComments._id]);

  return (
    <SwipeableDrawer
      anchor="right"
      open={props.open}
      onClose={() => {
        if (props.closeDrawer) {
          props.closeDrawer();
        }
      }}
      onOpen={() => {}}
      disableBackdropTransition={true}
      disableDiscovery={false}
      disableSwipeToOpen={false}
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true
        }
      }}
    >
      <Container component="main" maxWidth="lg">
        <Grid container alignItems="center" justify="space-between">
          <Grid item xs={12}>
            <Box m={2}>
              <Typography variant="h5">Comment</Typography>
            </Box>
          </Grid>
          {Meteor.user() && comments.length > 0 ?
            <Grid item xs={12}>
              <Tooltip title="Mark once resolved" placement="top" aria-label="resolved">
                <Switch disabled={comments.length === 0} onChange={resolveComments} checked={resolveCommentSwitched} />
              </Tooltip>
              <Typography variant="overline" color="secondary">Is Resolved</Typography>
            </Grid>
            :
              <>
                {comments.length > 0 && 
                  <>
                    <Grid item xs={2} style={{ color: resolveCommentSwitched ? theme.palette.success.main : theme.palette.error.main }}>
                      {resolveCommentSwitched ? 
                        <CheckCircleIcon />
                      :
                        <WarningIcon />
                      }
                    </Grid>
                    <Grid item xs={10} style={{ color: resolveCommentSwitched ? theme.palette.success.main : theme.palette.error.main }}>
                      <Typography variant="overline">
                        {resolveCommentSwitched ? "Resolved" : "Not Resolved"}
                      </Typography>
                    </Grid>
                  </>
                }
              </>
          }
          <Grid item xs={10} style={{minHeight: "80px"}}>
            <MentionsInput value={comment} 
              onChange={handleCommentChange} 
              className={classes.mentionsInput}
              placeholder={"Mention team members using '@'"}
              style={mentionInputStyle}
            >
              <Mention
                trigger="@"
                data={members}
                style={{ }}
                renderSuggestion={renderUserSuggestion}
              />
            </MentionsInput>
          </Grid>
          <Grid item xs={2} style={{minHeight: "80px"}}>
            <Button variant="outlined" color="secondary" onClick={sendComment}>Go</Button>
          </Grid>
          <Grid item xs={12}>
            {comments.map((c, index) => (
              <Grid container alignItems="flex-start" justify="space-between" key={index}>
                <Grid item xs={12}>
                  <Box p={2}>
                    <Divider />
                  </Box>
                </Grid>
                <Grid item xs={9} style={{minHeight: "80px"}}>
                  {(editableComment && c._id === editableComment._id) ? 
                    <MentionsInput 
                      value={editableComment.text} 
                      onChange={updateComment} 
                      className={classes.mentionsInput}
                      placeholder={"Mention team members using '@'"}
                    >
                      <Mention
                        trigger="@"
                        data={members}
                        style={{ backgroundColor: theme.palette.secondary.main }}
                        renderSuggestion={renderUserSuggestion}
                      />
                    </MentionsInput>
                  :
                    <>
                      <Typography color="secondary" variant="body2">
                        {cleanTextForDisplay(c.text)}
                      </Typography>
                      <Typography variant="caption">
                        {c.createdByUserName}, {new Date(c.timestamp).toLocaleString()}
                      </Typography>
                    </>
                  }
                </Grid>
                <Grid item xs={3}>
                  {(editableComment && c._id === editableComment._id && c.createdByUserId === Meteor.userId()) ? 
                    <>
                      <Tooltip title="Update">
                          <IconButton size="small" onClick={saveEditableComment}>
                            <DoneIcon/>
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Cancel">
                          <IconButton size="small" onClick={discardEditableComment}>
                            <CancelIcon/>
                          </IconButton>
                        </Tooltip>
                    </>
                  :
                    <>
                      {Meteor.userId() === c.createdByUserId &&
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={(e) => { editComment(c) }}>
                            <EditIcon/>
                          </IconButton>
                        </Tooltip>
                      }
                      {(canRemoveComments || Meteor.userId() === c.createdByUserId) &&
                          <Tooltip title="Delete">
                            <IconButton size="small" style={{color: theme.palette.error.main }} aria-label="delete" onClick={(e) => { deleteComment(c) }}>
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                      }
                    </>
                  }
                </Grid>
              </Grid>
            ))}
          </Grid>
        </Grid>
      </Container>
    </SwipeableDrawer>
  )
}