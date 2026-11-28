// The sidebar's projects, under "Projects": the person's own drives first, then those shared with
// them, then "New project" (not on a phone, where projects are viewed). Each opens its project page.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import AddIcon from '@mui/icons-material/Add'
import usePhoneView from '../../common/usePhoneView'
import useProjects, { useProjectsChanged } from './useProjects'
import NewProjectDialog from './NewProjectDialog'
import { PROJECT_COLORS, projectPath, sortDrives } from './projectsModel.mjs'

// At most this many drives each way in the sidebar; the rest are on /projects.
export const NAV_DRIVES = 8

export default function ProjectsNav({ onNavigate }) {
  const projects = useProjects()
  const phone = usePhoneView()
  const location = useLocation()
  const history = useNavigate()
  const changed = useProjectsChanged()
  const [making, setMaking] = useState(false)
  const { owned, shared } = sortDrives(projects || [], Meteor.userId())
  const rowSx = { mx: .5, mb: .25, pl: 6.5, py: .25, borderRadius: 1, color: 'shell.ink',
    '&.Mui-selected, &.Mui-selected:hover': { color: 'shell.selectedInk', bgcolor: 'shell.selected' } }
  const row = (d) => {
    const to = projectPath(d._id)
    const selected = location.pathname === to || location.pathname.startsWith(`${to}/`)
    return (
      <Box component="li" key={d._id} sx={{ listStyle: 'none' }}>
        <ListItemButton component={Link} to={to} onClick={onNavigate} selected={selected} aria-current={selected ? 'page' : undefined} sx={rowSx} data-nav-project={d._id}>
          <Box aria-hidden="true" sx={{ width: 8, height: 8, borderRadius: '50%', mr: 1.25, flex: 'none', bgcolor: PROJECT_COLORS[d.color] || 'shell.secondaryInk' }} />
          <ListItemText primary={d.name} slotProps={{ primary: { noWrap: true, fontSize: 14 } }} />
        </ListItemButton>
      </Box>
    )
  }
  const more = owned.length > NAV_DRIVES || shared.length > NAV_DRIVES
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <List dense disablePadding aria-label="Your projects">
        {owned.slice(0, NAV_DRIVES).map(row)}
        {shared.slice(0, NAV_DRIVES).map(row)}
        {more && (
          <Box component="li" sx={{ listStyle: 'none' }}>
            <ListItemButton component={Link} to="/projects" onClick={onNavigate} sx={rowSx}><ListItemText primary="All projects" slotProps={{ primary: { fontSize: 14 } }} /></ListItemButton>
          </Box>
        )}
        {!phone && (
          <Box component="li" sx={{ listStyle: 'none' }}>
            <ListItemButton onClick={() => setMaking(true)} sx={rowSx} data-nav-new-project="">
              <AddIcon sx={{ fontSize: 16, mr: 1, ml: -0.25 }} />
              <ListItemText primary="New project" slotProps={{ primary: { fontSize: 14 } }} />
            </ListItemButton>
          </Box>
        )}
      </List>
      {!phone && <NewProjectDialog open={making} onClose={() => setMaking(false)}
        onCreated={(p) => { setMaking(false); changed(); onNavigate?.(); history(projectPath(p._id)) }} />}
    </Box>
  )
}

ProjectsNav.propTypes = { onNavigate: PropTypes.func }
