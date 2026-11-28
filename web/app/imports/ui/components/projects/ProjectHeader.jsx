// The project page's title row: the project's name and description (renamed in place by managers),
// Share, the page's own actions, and the tabs. The Recipes tab is enterprise code's
// (<EnterpriseSlot name="project.recipesTab"/>): it shows only where recipes are switched on, so no
// tab leads nowhere.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Chip from '@mui/material/Chip'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import AddIcon from '@mui/icons-material/Add'
import confirmService from '../../common/confirm'
import EnterpriseSlot from '../../common/EnterpriseSlot'
import projectsApi from '../../../api/client/projects'
import { useProjectsChanged } from './useProjects'
import {
  DESCRIPTION_MAX, NAME_MAX, PROJECT_COLORS, ROLE_WORDS, deleteDriveCopy, newSlatePath, projectErrorWords, validateDescription, validateProjectName,
} from './projectsModel.mjs'

export function ProjectTab({ id, selected, onSelect, children }) {
  return (
    <Box component="button" type="button" role="tab" id={`project-tab-${id}`} aria-selected={selected} aria-controls={`project-panel-${id}`}
      onClick={onSelect}
      sx={{ border: 0, borderBottom: 2, borderColor: selected ? 'primary.main' : 'transparent', bgcolor: 'transparent', color: selected ? 'text.primary' : 'text.secondary',
        font: 'inherit', fontWeight: 650, px: 1.5, py: 1, cursor: 'pointer', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      {children}
    </Box>
  )
}

export default function ProjectHeader({ drive, here, role, abilities, tab, onTab, onShare, onMoveHere, onChanged, linkKey }) {
  const theme = useTheme()
  const history = useNavigate()
  const changed = useProjectsChanged()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(drive.name)
  const [description, setDescription] = useState(drive.description || '')
  const [menu, setMenu] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameCheck = validateProjectName(name)
  const descriptionCheck = validateDescription(description)

  async function save(event) {
    event.preventDefault()
    if (!nameCheck.ok || !descriptionCheck.ok) { setError(nameCheck.error || descriptionCheck.error); return }
    setBusy(true)
    try {
      await projectsApi.update({ projectId: drive._id, name: nameCheck.value, description: descriptionCheck.value })
      setEditing(false); setError(''); changed(); onChanged()
    } catch (e) { setError(projectErrorWords(e)) } finally { setBusy(false) }
  }

  async function deleteDrive() {
    setMenu(null)
    let slates = []
    try { slates = (await projectsApi.slates({ projectId: drive._id, folders: true }))?.slates ?? [] } catch (e) { setError(projectErrorWords(e)); return }
    const copy = deleteDriveCopy(slates, Meteor.userId())
    if (!await confirmService.show({ theme, title: copy.title, message: copy.body })) return
    try {
      await projectsApi.remove({ projectId: drive._id })
      changed()
      history('/projects', { replace: true })
    } catch (e) { setError(projectErrorWords(e)) }
  }

  const dot = PROJECT_COLORS[drive.color] || null
  return (
    <Box component="header" data-project-header="" sx={{ display: 'grid', gap: 1.5, mb: 2 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          {editing ? (
            <Box component="form" onSubmit={save} sx={{ display: 'grid', gap: 1, maxWidth: 560 }}>
              <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={busy}
                slotProps={{ htmlInput: { maxLength: NAME_MAX } }} error={!nameCheck.ok} />
              <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} disabled={busy}
                slotProps={{ htmlInput: { maxLength: DESCRIPTION_MAX } }} />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button type="submit" variant="contained" disableElevation disabled={busy || !nameCheck.ok}>Save</Button>
                <Button onClick={() => { setEditing(false); setName(drive.name); setDescription(drive.description || '') }} disabled={busy}>Cancel</Button>
              </Box>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {dot && <Box aria-hidden="true" sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: dot, flex: 'none' }} />}
                <Typography variant="h4" component="h1" data-app-page-title=""
                  sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 }, lineHeight: 1.15, letterSpacing: '-.01em', overflowWrap: 'anywhere', cursor: abilities.rename ? 'text' : 'default' }}
                  onDoubleClick={abilities.rename ? () => setEditing(true) : undefined}>
                  {drive.name}
                </Typography>
                {role && role !== 'owner' && <Chip size="small" variant="outlined" label={linkKey ? `${ROLE_WORDS[role]} by link` : ROLE_WORDS[role]} />}
              </Box>
              {drive.description && <Typography color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-line' }}>{drive.description}</Typography>}
              {here && here._id !== drive._id && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>In the folder “{here.name}”</Typography>}
            </>
          )}
        </Box>
        {!editing && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            {abilities.addSlates && <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => history(newSlatePath(here?._id || drive._id))}>Add a slate</Button>}
            {abilities.moveOwnSlates && <Button variant="outlined" onClick={onMoveHere}>Move slates here</Button>}
            {abilities.share && <Button variant="outlined" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={onShare}>Share</Button>}
            {(abilities.rename || abilities.deleteDrive) && (
              <IconButton aria-label="Project options" onClick={(e) => setMenu(e.currentTarget)}><MoreVertIcon /></IconButton>
            )}
          </Box>
        )}
      </Box>
      {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
      <Box role="tablist" aria-label="Project" sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
        <ProjectTab id="slates" selected={tab === 'slates'} onSelect={() => onTab('slates')}>Slates</ProjectTab>
        {/* Recipes: agents that keep this project's slates up to date (enterprise code; nothing where it does not run). */}
        <EnterpriseSlot name="project.recipesTab" projectId={drive._id} role={role} selected={tab === 'recipes'} onSelect={() => onTab('recipes')} Tab={ProjectTab} />
      </Box>
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {abilities.rename && <MenuItem onClick={() => { setMenu(null); setEditing(true) }}>Rename and describe</MenuItem>}
        {abilities.deleteDrive && <MenuItem onClick={deleteDrive} sx={{ color: 'error.main' }}>Delete project</MenuItem>}
      </Menu>
    </Box>
  )
}

ProjectHeader.propTypes = {
  drive: PropTypes.shape({ _id: PropTypes.string.isRequired, name: PropTypes.string.isRequired, description: PropTypes.string, color: PropTypes.number }).isRequired,
  here: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string }),
  role: PropTypes.string,
  abilities: PropTypes.object.isRequired,
  tab: PropTypes.string.isRequired,
  onTab: PropTypes.func.isRequired,
  onShare: PropTypes.func.isRequired,
  onMoveHere: PropTypes.func.isRequired,
  onChanged: PropTypes.func.isRequired,
  linkKey: PropTypes.string,
}
