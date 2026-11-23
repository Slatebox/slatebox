/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Popover from '@mui/material/Popover'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import InfoIcon from '@mui/icons-material/Info'
import AnnouncementIcon from '@mui/icons-material/Announcement'
import NotificationsIcon from '@mui/icons-material/Notifications'
import Badge from '@mui/material/Badge'
import { Link as RouterLink } from 'react-router-dom'
import Link from '@mui/material/Link'
import Tooltip from '@mui/material/Tooltip'
import Button from '@mui/material/Button'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import CONSTANTS from '../../api/common/constants'
import { Messages } from '../../api/common/models'
import confirmService from '../common/confirm'

// The unread count is the notifications this list shows: system messages, nothing else.
export function useUnreadNotifications() {
  return useTracker(() => Messages.find({ type: CONSTANTS.messageTypes.system, read: false }).count())
}

// Readable on the dark and light header alike (about 4.8:1 against white text).
export const unreadColor = '#c2412d'

// Opening a notification (its slate, its details) counts it as read.
const markRead = (message) => { if (!message.read) Messages.updateAsync({ _id: message._id }, { $set: { read: true } }).catch(() => {}) }

// `onFollow` closes the list when a notification takes the person to its slate.
function RenderMessage({ message, onFollow }) {
  const theme = useTheme()
  const [url, setUrl] = React.useState(null)
  React.useEffect(() => {
    if (message.action?.type !== CONSTANTS.messageActionTypes.slate) return
    Meteor.callAsync(CONSTANTS.methods.users.getSlateAccessUrl, {
      userId: Meteor.userId(), slateId: message.slateId, nodeId: message.nodeId,
    }).then(setUrl, () => setUrl(null))
  }, [message._id])
  if (message.action?.type === CONSTANTS.messageActionTypes.slate) {
    return url
      ? <Link component={RouterLink} to={url} onClick={() => { markRead(message); onFollow?.() }} variant="body2" sx={{ fontWeight: message.read ? 400 : 700 }}>{message.text}</Link>
      : <Box><Typography variant="caption" color="error">You no longer have access to this slate.</Typography>
          <Typography variant="body2">{message.text}</Typography></Box>
  }
  if (message.action?.type === CONSTANTS.messageActionTypes.link && typeof message.action.url === 'string' && message.action.url.startsWith('/')) {
    return <Box>
      <Link component={RouterLink} to={message.action.url} onClick={() => { markRead(message); onFollow?.() }} variant="body2" sx={{ fontWeight: message.read ? 400 : 700 }}>{message.text}</Link>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{new Date(message.timestamp).toLocaleString()}</Typography>
    </Box>
  }
  if (message.action?.type === CONSTANTS.messageActionTypes.modal) {
    return <Button size="small" sx={{ p: 0, textTransform: 'none', textAlign: 'left', fontWeight: message.read ? 400 : 700 }}
      onClick={() => { markRead(message); confirmService.show({ theme, title: message.modalTitle, message: message.modalBody }) }}>{message.text}</Button>
  }
  return <Box>
    <Typography variant="body2" sx={{ fontWeight: message.read ? 400 : 700 }}>{message.text}</Typography>
    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{new Date(message.timestamp).toLocaleString()}</Typography>
  </Box>
}

RenderMessage.propTypes = {
  message: PropTypes.shape({
    _id: PropTypes.string, read: PropTypes.bool, modalTitle: PropTypes.string, timestamp: PropTypes.number,
    text: PropTypes.string, modalBody: PropTypes.string, slateId: PropTypes.string, nodeId: PropTypes.string,
    action: PropTypes.shape({ type: PropTypes.string, url: PropTypes.string }),
  }).isRequired,
  onFollow: PropTypes.func,
}

// Notifications: the bell in the header (`variant="button"`), or a row in the app menu on a narrow
// screen (`variant="row"`, whose menu `onFollow` closes when a notification opens its slate). Both open the same 360px list. Guests have none, so neither is shown to them.
export default function MessagesMenu({ variant = 'button', onOpen, onFollow }) {
  const messages = useTracker(() =>
    Messages.find({ type: CONSTANTS.messageTypes.system }, { sort: { timestamp: -1 } }).fetch())
  const unread = useUnreadNotifications()
  const [anchorEl, setAnchorEl] = React.useState(null)
  const name = unread ? `Notifications, ${unread} unread` : 'Notifications'
  const open = (e) => { setAnchorEl(e.currentTarget); onOpen?.() }
  const markAllRead = async () => {
    for (const m of messages.filter((x) => !x.read)) {
      await Messages.updateAsync({ _id: m._id }, { $set: { read: true } })
    }
  }

  const trigger = variant === 'row'
    ? <ListItemButton onClick={open} aria-haspopup="dialog" sx={{ mx: .5, borderRadius: 1, color: 'shell.ink' }}>
        <ListItemIcon sx={{ color: 'inherit' }}><NotificationsIcon /></ListItemIcon>
        <ListItemText primary="Notifications" sx={{ ml: -2 }} />
        {unread > 0 && <Box component="span" aria-label={`${unread} unread`} sx={{ minWidth: 22, height: 22, px: .75, borderRadius: 11,
          display: 'grid', placeItems: 'center', bgcolor: unreadColor, color: '#fff', fontSize: 12, fontWeight: 700 }}>{unread}</Box>}
      </ListItemButton>
    : <Tooltip title="Notifications">
        <IconButton color="inherit" aria-label={name} aria-haspopup="dialog" aria-expanded={Boolean(anchorEl)} onClick={open}>
          <Badge badgeContent={unread} overlap="circular"
            sx={{ '& .MuiBadge-badge': { bgcolor: unreadColor, color: '#fff', fontWeight: 700 } }}>
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>

  return (
    <>
      {trigger}
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: variant === 'row' ? 'left' : 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: variant === 'row' ? 'left' : 'right' }}
        slotProps={{ paper: { role: 'dialog', 'aria-label': 'Notifications',
          sx: { width: 360, maxWidth: 'calc(100vw - 24px)', maxHeight: '70dvh', mt: 1, py: 1 } } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', px: 2, pb: 1 }}>
          <Typography component="h2" variant="overline" sx={{ fontWeight: 700 }}>Notifications</Typography>
          {unread > 0 && <Typography variant="caption">{unread} unread</Typography>}
        </Box>
        {messages.length ? <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {messages.map((message) => <Box component="li" key={message._id || message.timestamp}
            sx={{ display: 'flex', gap: 1.5, px: 2, py: 1 }}>
            {message.priority === 10 ? <AnnouncementIcon fontSize="small" /> : <InfoIcon fontSize="small" />}
            <RenderMessage message={message} onFollow={() => { setAnchorEl(null); onFollow?.() }} />
          </Box>)}
        </Box> : <Typography variant="body2" sx={{ px: 2, py: 1 }}>No notifications yet.</Typography>}
        {unread > 0 && <Box sx={{ borderTop: 1, borderColor: 'divider', mt: 1, pt: 1, textAlign: 'center' }}>
          <Button onClick={markAllRead}>Mark all as read</Button>
        </Box>}
      </Popover>
    </>
  )
}
