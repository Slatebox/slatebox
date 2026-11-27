// Help and support: a row in the navigation that opens a short menu (common/supportLinks.mjs): the help center, the
// community, a bug report filled in with the app version and browser, and the contact form. When the support chat is
// loaded on this deployment, it is offered first. What's new (common/whatsNew.mjs) opens slatebox.com/changelog at this
// release line, with a dot on it and on the row until it has been opened on this line.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import BugReportOutlinedIcon from '@mui/icons-material/BugReportOutlined'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import NewReleasesOutlinedIcon from '@mui/icons-material/NewReleasesOutlined'
import { helpLinks } from '../common/supportLinks.mjs'
import { isUnread, markSeen, readSeen, whatsNewUrl } from '../common/whatsNew.mjs'
import release from '../common/release.json'

const icons = { docs: MenuBookOutlinedIcon, community: ForumOutlinedIcon, bug: BugReportOutlinedIcon, contact: MailOutlineIcon }
const storage = () => (typeof window === 'undefined' ? undefined : window.localStorage)

// A small dot that says "something new here"; the words for screen readers go with the item it sits on.
function UnreadDot({ sx }) {
  return <Box component="span" aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'primary.main', flex: 'none', ...sx }} />
}
UnreadDot.propTypes = { sx: PropTypes.shape({}) }
UnreadDot.defaultProps = { sx: undefined }

export default function HelpMenu({ collapsed = false, onDone }) {
  const [anchor, setAnchor] = useState(null)
  const close = () => setAnchor(null)
  const done = () => { close(); onDone?.() }
  const chat = typeof window !== 'undefined' && window.$chatwoot
  const [unread, setUnread] = useState(false)
  useEffect(() => { setUnread(isUnread(readSeen(storage()), release.version)) }, [])
  const openWhatsNew = () => { markSeen(storage(), release.version); setUnread(false); done() }
  const links = anchor ? helpLinks({ commit: Meteor.gitCommitHash, userAgent: navigator.userAgent, host: window.location.hostname }) : []
  return <Box component="li" sx={{ listStyle: 'none' }}>
    <Tooltip placement="right" title={collapsed ? `Help and support${unread ? ': something new' : ''}` : ''}>
      <ListItemButton id="help-menu-button" aria-haspopup="menu" aria-expanded={anchor ? 'true' : undefined} aria-controls={anchor ? 'help-menu' : undefined}
        aria-label={unread ? 'Help and support, something new' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)} sx={{ mx: .5, borderRadius: 1, color: 'shell.ink' }}>
        {/* The row's dot sits on the icon, collapsed or not: at the 205px drawer the label fills the row, and a dot
            after it overlapped the "t" of "support". */}
        <ListItemIcon sx={{ color: 'inherit', position: 'relative' }}><HelpOutlineIcon />
          {unread && <UnreadDot sx={{ position: 'absolute', top: 0, left: 18 }} />}</ListItemIcon>
        <ListItemText primary="Help and support" sx={{ ml: -2 }} />
      </ListItemButton>
    </Tooltip>
    <Menu id="help-menu" anchorEl={anchor} open={Boolean(anchor)} onClose={close}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      MenuListProps={{ 'aria-labelledby': 'help-menu-button', dense: true }}>
      {chat && <MenuItem onClick={() => { done(); window.$chatwoot.toggle() }}>
        <ListItemIcon><ChatBubbleOutlineIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="Chat with us" secondary="Talk to a person now" />
      </MenuItem>}
      <MenuItem component="a" href={whatsNewUrl(release.version)} target="_blank" rel="noopener noreferrer" onClick={openWhatsNew}
        data-help="whats-new" data-unread={unread ? 'true' : 'false'} aria-label={unread ? "What's new, unread" : undefined}>
        <ListItemIcon><NewReleasesOutlinedIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="What's new" secondary={`What changed in Slatebox ${release.version.split('.').slice(0, 2).join('.')}`} />
        {unread && <UnreadDot sx={{ ml: 1.5 }} />}
      </MenuItem>
      {links.map(({ id, label, detail, href }) => {
        const Icon = icons[id]
        return <MenuItem key={id} component="a" href={href} target="_blank" rel="noopener noreferrer" onClick={done} data-help={id}>
          <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
          <ListItemText primary={label} secondary={detail} />
        </MenuItem>
      })}
    </Menu>
  </Box>
}

HelpMenu.propTypes = { collapsed: PropTypes.bool, onDone: PropTypes.func }
HelpMenu.defaultProps = { collapsed: false, onDone: undefined }
