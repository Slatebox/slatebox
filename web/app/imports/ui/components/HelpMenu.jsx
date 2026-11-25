// Help and support: a row in the navigation that opens a short menu (common/supportLinks.mjs): the help center, the
// community, a bug report filled in with the app version and browser, and the contact form. When the support chat is
// loaded on this deployment, it is offered first.
import React, { useState } from 'react'
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
import { helpLinks } from '../common/supportLinks.mjs'

const icons = { docs: MenuBookOutlinedIcon, community: ForumOutlinedIcon, bug: BugReportOutlinedIcon, contact: MailOutlineIcon }

export default function HelpMenu({ collapsed = false, onDone }) {
  const [anchor, setAnchor] = useState(null)
  const close = () => setAnchor(null)
  const done = () => { close(); onDone?.() }
  const chat = typeof window !== 'undefined' && window.$chatwoot
  const links = anchor ? helpLinks({ commit: Meteor.gitCommitHash, userAgent: navigator.userAgent, host: window.location.hostname }) : []
  return <Box component="li" sx={{ listStyle: 'none' }}>
    <Tooltip placement="right" title={collapsed ? 'Help and support' : ''}>
      <ListItemButton id="help-menu-button" aria-haspopup="menu" aria-expanded={anchor ? 'true' : undefined} aria-controls={anchor ? 'help-menu' : undefined}
        onClick={(e) => setAnchor(e.currentTarget)} sx={{ mx: .5, borderRadius: 1, color: 'shell.ink' }}>
        <ListItemIcon sx={{ color: 'inherit' }}><HelpOutlineIcon /></ListItemIcon>
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
