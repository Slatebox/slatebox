/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-underscore-dangle */
import React, { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import cloneDeep from 'lodash.clonedeep'
import { Meteor } from 'meteor/meteor'
import { createTheme, styled } from '@mui/material/styles'
import { useAtom } from 'jotai'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import CancelIcon from '@mui/icons-material/Cancel'
import DoneIcon from '@mui/icons-material/Done'
import WarningIcon from '@mui/icons-material/Warning'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import Tooltip from '@mui/material/Tooltip'
import { useTracker } from 'meteor/react-meteor-data'
import IconButton from '@mui/material/IconButton'
import Switch from '@mui/material/Switch'
import { Mention, MentionsInput } from 'react-mentions'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Grid from '@mui/material/Grid2'
import Container from '@mui/material/Container'
import Divider from '@mui/material/Divider'
import { getExternalUserName, getUserName } from '../../api/common/getUserName'
import AuthManager from '../../api/common/AuthManager'
import CONSTANTS from '../../api/common/constants'
import { Messages, Comments } from '../../api/common/models'
import promisify from '../../api/client/promisify'

import { globalMessage } from '../jotai/atoms'

const StyledSwipeableDrawer = styled(SwipeableDrawer)(({ theme }) => ({
  '& .MuiDrawer-paper': {
    backgroundColor: theme.palette.primary.main,
    height: '100vh',
    width: '300px',
  },
}))

const StyledContent = styled('div')(({ theme }) => ({
  margin: theme.spacing(1),
}))

const StyledMentionsInput = styled(MentionsInput)(({ theme }) => ({
  color: '#fff',
  padding: '5px',
  margin: '3px',
  '& textarea': {
    color: '#fff',
    minHeight: '80px',
    fontSize: '13pt',
  },
}))

export default function CommentDrawer({
  shareId,
  // The slate's comment role (COMMENT or EDIT by its sharing): readers see comments, never post.
  canComment = true,
  orgId,
  slateId,
  slateName,
  nodeId,
  closeDrawer,
  open,
}) {
  const [message, setMessage] = useAtom(globalMessage)
  const [editableComment, setEditableComment] = React.useState(null)
  const [comment, setComment] = React.useState('')
  const theme = createTheme()
  const [canRemoveComments, setCanRemoveComments] = useState(false)

  useEffect(() => {
    async function checkPermissions() {
      const hasPermission = await AuthManager.userHasClaim(Meteor.userId(), [
        CONSTANTS.claims.canRemoveComments._id,
      ])
      setCanRemoveComments(hasPermission)
    }

    checkPermissions()
  }, [])

  const mentionInputStyle = {
    control: {
      backgroundColor: '#222',
      fontSize: 14,
      fontWeight: 'normal',
      padding: 0,
      margin: 0,
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
  }

  function attachedTeamMembers() {
    const base = editableComment ? editableComment.text : comment
    const userIds = Meteor.users
      .find()
      .fetch()
      .map((m) => m._id)
    // console.log("checking base filter ", base, userIds);
    // console.log("returning attached userIds", userIds.filter(u => base.includes(u)));
    return userIds.filter((u) => base.includes(u))
  }

  function cleanTextForDisplay(text) {
    // console.log('text to clean is ', text);
    const usersReg = /[(.*?)]/g
    const idReg = new RegExp(
      Meteor.users
        .find()
        .fetch()
        .map((m) => m._id)
        .join('|'),
      'g'
    )
    return text
      .split(usersReg)
      .map((u) => u.replace('[', '').replace(']', '').replace(idReg, '').trim())
      .join(' ')
      .trim()
    // hey @[Ada Lovelace](aB3dE5fG7hJ9kL1mN) and @[Alan Turing](pQ2rS4tU6vW8xY0zA) and @[Grace Hopper](cD4eF6gH8iJ0kL2mN) - let's do this
  }

  const updateComment = (e) => {
    const uc = cloneDeep(editableComment)
    uc.text = e.target.value
    setEditableComment(uc)
  }

  const renderUserSuggestion = (
    entry,
    search,
    highlightedDisplay,
    index,
    focused
  ) => (
    <Box p={1}>
      <Typography
        color="secondary"
        variant="overline"
        className={`user ${focused ? 'focused' : ''}`}
      >
        {highlightedDisplay}
      </Typography>
    </Box>
  )
  // return (<div>{entry}</div>);

  const members = useTracker(async () => {
    if (!Meteor.user() && orgId && slateId) {
      Meteor.subscribe(CONSTANTS.publications.orgUsersForGuest, {
        orgId,
        slateId,
      })
    }
    const commenters = []
    for (const u of Meteor.users
      .find({ _id: { $ne: Meteor.userId() } })
      .fetch()) {
      commenters.push({
        id: u._id,
        display: await getExternalUserName(u._id),
      })
    }
    return commenters
  })

  const comments = useTracker(() =>
    Comments.find({ nodeId }, { sort: { timestamp: -1 } }).fetch()
  )

  const resolveCommentSwitched = comments.every((c) => c.resolved)

  const resolveComments = async (e) => {
    await Meteor.callAsync(CONSTANTS.methods.comments.toggleResolve, {
      resolved: e.target.checked,
      slateId,
      nodeId,
    })
    return true
  }

  const deleteComment = async (c) => {
    await Meteor.callAsync(CONSTANTS.methods.comments.remove, {
      commentId: c._id,
    })
  }

  const handleCommentChange = (e) => {
    setComment(e.target.value)
  }

  const sendComment = async () => {
    if (comment.trim() !== '') {
      // Posted on the server (comments.add): the slate's comment role decides, and "@Slatebox …"
      // asks the Slatebox agent there, the same as from the API, MCP or exec.
      let posted
      try {
        posted = await Meteor.callAsync('comments.add', { shareId, noteId: nodeId, text: comment })
      } catch (e) {
        setMessage({ visible: true, text: e.reason || e.message || 'The comment could not be posted.', severity: 'error' })
        return
      }
      const commId = posted.commentId
      const mentioned = attachedTeamMembers()
      if (mentioned.length) await Comments.updateAsync({ _id: commId }, { $set: { mentionedTeamMembers: mentioned } })
      if (posted.agentNote) setMessage({ visible: true, text: posted.agentNote, severity: 'info' })
      const note = `[${slateName}] from ${getUserName()}: ${cleanTextForDisplay(
        comment
      )}`

      await Promise.all(
        attachedTeamMembers().map((tm) =>
          Messages.insertAsync({
            timestamp: new Date().valueOf(),
            commentId: commId,
            userId: tm,
            text: note,
            read: false,
            priority: 5,
            slateId,
            nodeId,
            type: CONSTANTS.messageTypes.system,
            action: {
              type: CONSTANTS.messageActionTypes.slate,
              toolTip: `Go to the slate to reply to this comment`,
            },
          })
        )
      )

      setComment('')
    } else {
      setMessage({
        visible: true,
        text: `Oops, you forgot the comment`,
        severity: 'error',
        autoHide: 10000,
      })
    }
  }

  function editComment(c) {
    // console.log("editing comment", c);
    setEditableComment(c)
  }

  const saveEditableComment = async () => {
    Comments.updateAsync(
      { _id: editableComment._id },
      {
        $set: {
          text: editableComment.text,
          resolved: false,
          mentionedTeamMembers: attachedTeamMembers(),
        },
      }
    )
    // remove all the old messages based on this commentId and recreate them
    await Meteor.callAsync(
      CONSTANTS.methods.messages.recreateMessagesForComment,
      {
        commentId: editableComment._id,
        text: cleanTextForDisplay(editableComment.text),
        mentionedTeamMembers: attachedTeamMembers(),
        slateId,
        nodeId,
        userId: Meteor.userId(),
      }
    )
    setEditableComment(null)
  }

  const discardEditableComment = () => {
    setEditableComment(null)
  }

  CommentDrawer.propTypes = {
    orgId: PropTypes.string,
    slateId: PropTypes.string,
    shareId: PropTypes.string,
    canComment: PropTypes.bool,
    nodeId: PropTypes.string,
    closeDrawer: PropTypes.func,
    open: PropTypes.bool.isRequired,
  }

  return (
    <StyledSwipeableDrawer
      anchor="right"
      open={open}
      onClose={() => {
        if (closeDrawer) {
          closeDrawer()
        }
      }}
      onOpen={() => {}}
      disableBackdropTransition
      disableDiscovery={true}
      disableSwipeToOpen={true}
      ModalProps={{
        BackdropProps: {
          invisible: true,
        },
      }}
    >
      <StyledContent>
        <Container component="main" maxWidth="lg">
          <Grid container alignItems="center" justifyContent="space-between">
            <Grid size={12}>
              <Box m={2}>
                <Typography variant="h5">Comment</Typography>
              </Box>
            </Grid>
            {Meteor.user() && canComment && comments.length > 0 ? (
              <Grid size={12}>
                <Tooltip
                  title="Mark once resolved"
                  placement="top"
                  aria-label="resolved"
                >
                  <Switch
                    disabled={comments.length === 0}
                    onChange={resolveComments}
                    checked={resolveCommentSwitched}
                  />
                </Tooltip>
                <Typography variant="overline" color="secondary">
                  Is Resolved
                </Typography>
              </Grid>
            ) : (
              <div>
                {comments.length > 0 && (
                  <>
                    <Grid
                      style={{
                        color: resolveCommentSwitched
                          ? theme.palette.success.main
                          : theme.palette.error.main,
                      }}
                      size={2}
                    >
                      {resolveCommentSwitched ? (
                        <CheckCircleIcon />
                      ) : (
                        <WarningIcon />
                      )}
                    </Grid>
                    <Grid
                      style={{
                        color: resolveCommentSwitched
                          ? theme.palette.success.main
                          : theme.palette.error.main,
                      }}
                      size={10}
                    >
                      <Typography variant="overline">
                        {resolveCommentSwitched ? 'Resolved' : 'Not Resolved'}
                      </Typography>
                    </Grid>
                  </>
                )}
              </div>
            )}
            {canComment ? (<>
            <Grid style={{ minHeight: '80px' }} size={10}>
              <StyledMentionsInput
                value={comment}
                onChange={handleCommentChange}
                placeholder="Mention team members using '@'"
              >
                <Mention
                  trigger="@"
                  data={members}
                  renderSuggestion={renderUserSuggestion}
                />
              </StyledMentionsInput>
            </Grid>
            <Grid style={{ minHeight: '80px' }} size={2}>
              <Button
                variant="outlined"
                color="secondary"
                onClick={async () => sendComment()}
              >
                Go
              </Button>
            </Grid>
            </>) : (
              <Grid size={12}>
                <Typography variant="body2" color="text.secondary" sx={{ mx: 2, mb: 2 }}>
                  You can read the comments here. Commenting needs the comment role on this slate: ask its owner.
                </Typography>
              </Grid>
            )}
            <Grid size={12}>
              {comments.map((c) => (
                <Grid
                  container
                  alignItems="flex-start"
                  justifyContent="space-between"
                  key={c._id}
                >
                  <Grid size={12}>
                    <Box p={2}>
                      <Divider />
                    </Box>
                  </Grid>
                  <Grid style={{ minHeight: '80px' }} size={9}>
                    {editableComment && c._id === editableComment._id ? (
                      <MentionsInput
                        value={editableComment.text}
                        onChange={updateComment}
                        className={classes.mentionsInput}
                        placeholder="Mention team members using '@'"
                      >
                        <Mention
                          trigger="@"
                          data={members}
                          style={{
                            backgroundColor: theme.palette.secondary.main,
                          }}
                          renderSuggestion={renderUserSuggestion}
                        />
                      </MentionsInput>
                    ) : (
                      <>
                        <Typography color="secondary" variant="body2">
                          {cleanTextForDisplay(c.text)}
                        </Typography>
                        <Typography variant="caption">
                          {c.createdByUserName},{' '}
                          {new Date(c.timestamp).toLocaleString()}
                        </Typography>
                      </>
                    )}
                  </Grid>
                  <Grid size={3}>
                    {editableComment &&
                    c._id === editableComment._id &&
                    c.createdByUserId === Meteor.userId() ? (
                      <>
                        <Tooltip title="Update">
                          <IconButton
                            size="small"
                            onClick={saveEditableComment}
                          >
                            <DoneIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Cancel">
                          <IconButton
                            size="small"
                            onClick={discardEditableComment}
                          >
                            <CancelIcon />
                          </IconButton>
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        {Meteor.userId() === c.createdByUserId && (
                          <Tooltip title="Edit">
                            <IconButton
                              size="small"
                              onClick={() => {
                                editComment(c)
                              }}
                            >
                              <EditIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                        {(canRemoveComments ||
                          Meteor.userId() === c.createdByUserId) && (
                          <Tooltip title="Delete">
                            <IconButton
                              size="small"
                              style={{ color: theme.palette.error.main }}
                              aria-label="delete"
                              onClick={() => {
                                deleteComment(c)
                              }}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Tooltip>
                        )}
                      </>
                    )}
                  </Grid>
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Container>
      </StyledContent>
    </StyledSwipeableDrawer>
  )
}

// You can use these styled components for other parts of your component as needed
const WhiteText = styled('span')({
  color: '#fff',
})

const IconTab = styled('div')({
  minWidth: 50,
  width: 50,
})

const LightRow = styled('div')({
  background: '#424242',
})

const DarkRow = styled('div')({
  background: '#303030',
})
