/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSelector } from 'react-redux'
import IconButton from '@material-ui/core/IconButton'
import InputAdornment from '@material-ui/core/InputAdornment'
import { makeStyles, useTheme } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import Divider from '@material-ui/core/Divider'
import Paper from '@material-ui/core/Paper'
import SendIcon from '@material-ui/icons/Send'
import DeleteIcon from '@material-ui/icons/Delete'
import Box from '@material-ui/core/Box'
import { Grid, TextField } from '@material-ui/core'

import { Messages } from '../../api/common/models'
import CONSTANTS from '../../api/common/constants'
import getUserName from '../../api/common/getUserName'

const useStyles = makeStyles(() => ({
  inputRoot: {
    '& .MuiFormLabel-root': {
      color: '#fff',
    },
    '& fieldset': {
      border: '1px solid #fff',
    },
    '& .MuiOutlinedInput-notchedOutline-focused': {
      borderColor: '#fff',
    },
    '& input': {
      color: '#fff',
    },
  },
}))

export default function Chat() {
  const classes = useStyles()
  const slate = useSelector((state) => state.slate)
  const chatOpen = useSelector((state) => state.chatOpen)
  const messages = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.messages, {
      type: CONSTANTS.messageTypes.chat,
      slateShareId: slate?.shareId,
    })
    return Messages.find(
      { type: CONSTANTS.messageTypes.chat },
      { sort: { timestamp: -1 } }
    ).fetch()
  })

  const [txtMessage, setMessage] = React.useState('')

  const deleteMessage = (_id) => {
    Messages.remove({ _id })
  }

  const handleMessage = (e) => {
    setMessage(e.target.value)
  }

  const postMessage = () => {
    Messages.insert({
      author: getUserName(Meteor.userId()),
      timestamp: new Date().valueOf(),
      slateShareId: slate.shareId,
      userId: Meteor.userId(),
      text: txtMessage,
      type: CONSTANTS.messageTypes.chat,
    })
    setMessage('')
    // post
  }

  // Chat.propTypes = {
  //   message: PropTypes.shape({
  //     read: PropTypes.bool,
  //     modalTitle: PropTypes.string,
  //     timestamp: PropTypes.number,
  //     text: PropTypes.string,
  //     modalBody: PropTypes.string,
  //     slateId: PropTypes.string,
  //     nodeId: PropTypes.string,
  //     toolTip: PropTypes.string,
  //     action: PropTypes.shape({
  //       toolTip: PropTypes.string,
  //       type: PropTypes.string,
  //     }),
  //   }).isRequired,
  // }

  return chatOpen ? (
    <Paper
      style={{
        position: 'absolute',
        backgroundColor: '#000',
        right: 0,
        bottom: 0,
        padding: 0,
        margin: 0,
        width: 200,
        height: '500px',
      }}
      elevation={0}
      square
    >
      <Grid
        container
        direction="row"
        justifyContent="center"
        alignItems="stretch"
        style={{ height: '100%' }}
      >
        <Grid
          item
          xs={12}
          style={{
            height: '75%',
            'overflow-y': 'auto',
          }}
        >
          <Grid container>
            {messages?.map((message) => (
              <Grid item xs={12} key={message.timestamp}>
                <Grid
                  container
                  spacing={2}
                  alignItems="center"
                  justifyContent="center"
                >
                  <Grid item xs={2}>
                    {Meteor.userId() === message.userId && (
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          deleteMessage(message._id)
                        }}
                      >
                        <DeleteIcon
                          style={{
                            color: 'red',
                            width: '20px',
                            cursor: 'pointer',
                          }}
                        />
                      </IconButton>
                    )}
                  </Grid>
                  <Grid item xs={10} key={message.timestamp}>
                    <Box mt={1}>
                      <Typography variant="caption">
                        <i>
                          {new Date(message.timestamp).toLocaleTimeString()}
                        </i>
                      </Typography>
                    </Box>
                    <Box mt={0}>
                      <Typography variant="subtitle1">
                        <b>{message.author}</b>
                      </Typography>
                    </Box>
                    <Box mt={0}>
                      <Typography variant="subtitle2">
                        {message.text}
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
                <Divider />
              </Grid>
            ))}
          </Grid>
        </Grid>
        <Grid item xs={12}>
          <TextField
            multiline
            placeholder="To chat, type your message here..."
            rows={4}
            value={txtMessage}
            variant="outlined"
            onChange={handleMessage}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                postMessage()
                ev.preventDefault()
              }
            }}
            className={classes.inputRoot}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton>
                    <SendIcon style={{ color: '#fff' }} onClick={postMessage} />
                  </IconButton>
                </InputAdornment>
              ),
              style: { padding: 3, margin: 3 },
            }}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
            autoFocus
            onFocus={(e) => {
              const self = e.target
              setTimeout(() => {
                // eslint-disable-next-line no-multi-assign
                self.selectionStart = self.selectionEnd = 10000
              }, 0)
            }}
          />
        </Grid>
      </Grid>
    </Paper>
  ) : null
}
