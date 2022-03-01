/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Menu from '@material-ui/core/Menu'
import MenuItem from '@material-ui/core/MenuItem'
import IconButton from '@material-ui/core/IconButton'
import Typography from '@material-ui/core/Typography'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import InfoIcon from '@material-ui/icons/Info'
import AnnouncementIcon from '@material-ui/icons/Announcement'
import NotificationsIcon from '@material-ui/icons/Notifications'
import Badge from '@material-ui/core/Badge'
import { Link as RouterLink } from 'react-router-dom'
import Link from '@material-ui/core/Link'
import Tooltip from '@material-ui/core/Tooltip'
import Button from '@material-ui/core/Button'
import { useTheme } from '@material-ui/core/styles'
import Box from '@material-ui/core/Box'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'
import { Messages } from '../../api/common/models'
import confirmService from '../../ui/common/confirm'

export default function MessagesMenu() {
  const theme = useTheme()
  const messages = useTracker(() =>
    Messages.find({}, { sort: { timestamp: -1 } }).fetch()
  )

  const [anchorEl, setAnchorEl] = React.useState(null)
  const showMenu = (e) => {
    setAnchorEl(e.currentTarget)
  }
  const handleClose = () => {
    setAnchorEl(null)
    messages.forEach((m) =>
      Messages.update({ _id: m._id }, { $set: { read: true } })
    )
  }

  function formatTimestamp(timestamp) {
    return `${new Date(timestamp).toLocaleDateString()} ${new Date(
      timestamp
    ).toLocaleTimeString()}`
  }

  // eslint-disable-next-line react/no-unstable-nested-components
  function RenderMessage({ message }) {
    const [url, setUrl] = React.useState(null)
    async function getAccessUrl() {
      const gurl = await promisify(
        Meteor.call,
        CONSTANTS.methods.users.getSlateAccessUrl,
        {
          userId: Meteor.userId(),
          slateId: message.slateId,
          nodeId: message.nodeId,
        }
      )
      setUrl(gurl)
    }
    if (message.action) {
      switch (message.action.type) {
        case CONSTANTS.messageActionTypes.slate: {
          getAccessUrl()
          // need to go get potential accessKey for this user
          return (
            <div>
              {url ? (
                <Tooltip title={message.action.toolTip}>
                  <Link
                    component={RouterLink}
                    to={url}
                    style={{
                      color: message.read
                        ? '#fff'
                        : theme.palette.secondary.main,
                    }}
                    variant="body2"
                  >
                    <Typography variant="inherit">{message.text}</Typography>
                  </Link>
                </Tooltip>
              ) : (
                <Box>
                  <Typography
                    variant="overline"
                    style={{ color: theme.palette.error.main }}
                  >
                    NOTE: Sorry, you no longer have access to this slate.
                  </Typography>
                  <Typography variant="inherit">
                    Original Comment: {message.text}
                  </Typography>
                </Box>
              )}
            </div>
          )
        }
        case CONSTANTS.messageActionTypes.modal: {
          return (
            <Tooltip title={message.toolTip}>
              <Button
                component={Link}
                onClick={async () => {
                  await confirmService.show({
                    theme,
                    title: message.modalTitle,
                    message: message.modalBody,
                  })
                }}
              >
                <Typography
                  variant="inherit"
                  color={message.read ? 'secondary' : ''}
                >
                  {message.text}
                </Typography>
              </Button>
            </Tooltip>
          )
        }
        default: {
          break
        }
      }
    } else {
      return (
        <Typography variant="inherit" color={message.read ? '' : 'secondary'}>
          {formatTimestamp(message.timestamp)} - {message.text}
        </Typography>
      )
    }
  }

  RenderMessage.propTypes = {
    message: PropTypes.shape({
      read: PropTypes.bool,
      modalTitle: PropTypes.string,
      timestamp: PropTypes.number,
      text: PropTypes.string,
      modalBody: PropTypes.string,
      slateId: PropTypes.string,
      nodeId: PropTypes.string,
      toolTip: PropTypes.string,
      action: PropTypes.shape({
        toolTip: PropTypes.string,
        type: PropTypes.string,
      }),
    }).isRequired,
  }

  return (
    <>
      <IconButton
        aria-controls="messages-menu"
        aria-haspopup="true"
        color="inherit"
        onClick={showMenu}
      >
        <Badge
          badgeContent={Messages.find({ read: false }).count()}
          color="secondary"
        >
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Menu
        id="messages-menu"
        anchorEl={anchorEl}
        keepMounted
        open={Boolean(anchorEl)}
        onClose={handleClose}
        getContentAnchorEl={null}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        style={{ marginTop: '10px' }}
      >
        {messages.map((message) => (
          <MenuItem
            key={message.timestamp}
            onClick={handleClose}
            style={{ whiteSpace: 'normal', width: '500px' }}
          >
            <ListItemIcon>
              {message.priority === 10 ? (
                <AnnouncementIcon fontSize="small" />
              ) : (
                <InfoIcon fontSize="small" />
              )}
            </ListItemIcon>
            <RenderMessage message={message} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
