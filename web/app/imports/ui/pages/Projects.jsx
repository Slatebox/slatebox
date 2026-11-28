// /projects — every project the person has: their own drives, then the ones shared with them. On a
// phone the list is read only (projects are made and shared on a computer or tablet).
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import AppPage, { PAGE_SPACE } from '../common/AppPage'
import EmptyState from '../components/EmptyState'
import usePhoneView from '../common/usePhoneView'
import useProjects, { useProjectsChanged } from '../components/projects/useProjects'
import NewProjectDialog from '../components/projects/NewProjectDialog'
import { PROJECT_COLORS, ROLE_WORDS, projectPath, sortDrives } from '../components/projects/projectsModel.mjs'
import { Meteor } from 'meteor/meteor'

function DriveCard({ drive, shared }) {
  return (
    <Box component={Link} to={projectPath(drive._id)} data-project-card={drive._id}
      sx={{ display: 'grid', gap: 0.5, p: 2, border: 1, borderColor: 'divider', borderRadius: 2, color: 'text.primary', textDecoration: 'none',
        '&:hover': { borderColor: 'primary.main' }, '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box aria-hidden="true" sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: PROJECT_COLORS[drive.color] || 'text.disabled', flex: 'none' }} />
        <Typography fontWeight={700} noWrap>{drive.name}</Typography>
      </Box>
      {drive.description && <Typography variant="body2" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{drive.description}</Typography>}
      <Typography variant="caption" color="text.secondary">
        {[shared ? `${ROLE_WORDS[drive.role] || 'Viewer'} · shared by ${drive.ownerName || 'someone'}` : null,
          Number.isInteger(drive.slateCount) ? `${drive.slateCount} ${drive.slateCount === 1 ? 'slate' : 'slates'}` : null].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  )
}

export default function Projects() {
  const projects = useProjects()
  const phone = usePhoneView()
  const history = useNavigate()
  const changed = useProjectsChanged()
  const [making, setMaking] = useState(false)
  const { owned, shared } = sortDrives(projects || [], Meteor.userId())
  const grid = { display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', mb: PAGE_SPACE.section }
  return (
    <AppPage data-projects-page="" title="Projects" subtitle="Slates kept together, in folders, and shared like a drive."
      actions={!phone && <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => setMaking(true)}>New project</Button>}>
      {projects === null && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress aria-label="Finding your projects" /></Box>}
      {projects && !owned.length && !shared.length && (
        <EmptyState title="No projects yet"
          body={phone ? 'Projects you make or are invited to on a computer or tablet show up here.' : 'Make a project to keep slates together and share them all at once.'}>
          {!phone && <Button variant="contained" disableElevation size="large" sx={{ borderRadius: 6, px: 3 }} onClick={() => setMaking(true)}>New project</Button>}
        </EmptyState>
      )}
      {owned.length > 0 && (
        <Box component="section" aria-labelledby="own-projects">
          <Typography id="own-projects" component="h2" variant="h6" sx={{ mb: 1 }}>Your projects</Typography>
          <Box sx={grid}>{owned.map((d) => <DriveCard key={d._id} drive={d} />)}</Box>
        </Box>
      )}
      {shared.length > 0 && (
        <Box component="section" aria-labelledby="shared-projects">
          <Typography id="shared-projects" component="h2" variant="h6" sx={{ mb: 1 }}>Shared with you</Typography>
          <Box sx={grid}>{shared.map((d) => <DriveCard key={d._id} drive={d} shared />)}</Box>
        </Box>
      )}
      {!phone && <NewProjectDialog open={making} onClose={() => setMaking(false)} onCreated={(p) => { setMaking(false); changed(); history(projectPath(p._id)) }} />}
    </AppPage>
  )
}
