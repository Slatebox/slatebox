// The project page's folder row: where you are (drive › folder › folder), the folders inside it as
// chips, and New folder for editors. Folders nest at most 3 below the drive; a folder's menu
// renames it (editors) or deletes it (managers), moving what is in it up a level first.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import Breadcrumbs from '@mui/material/Breadcrumbs'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined'
import { useTheme } from '@mui/material/styles'
import confirmService from '../../common/confirm'
import projectsApi from '../../../api/client/projects'
import { useProjectsChanged } from './useProjects'
import { NAME_MAX, breadcrumb, canNestUnder, childFolders, deleteFolderCopy, projectErrorWords, projectPath, validateProjectName } from './projectsModel.mjs'

function NameField({ initial = '', label, onSave, onCancel }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const check = validateProjectName(name)
  async function save(event) {
    event.preventDefault()
    if (!check.ok) { setError(check.error); return }
    setBusy(true)
    try { await onSave(check.value) } catch (e) { setError(projectErrorWords(e)); setBusy(false) }
  }
  return (
    <Box component="form" onSubmit={save} sx={{ display: 'inline-flex', gap: 1, alignItems: 'center' }}>
      <TextField size="small" label={label} value={name} autoFocus onChange={(e) => setName(e.target.value)} disabled={busy}
        error={Boolean(error)} helperText={error || undefined} slotProps={{ htmlInput: { maxLength: NAME_MAX } }}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} />
      <Button type="submit" size="small" variant="contained" disableElevation disabled={busy || !check.ok}>Save</Button>
      <Button size="small" onClick={onCancel} disabled={busy}>Cancel</Button>
    </Box>
  )
}

export default function ProjectFolders({ drive, folders, folderId, abilities, slateCount, onChanged, onLeaveFolder }) {
  const theme = useTheme()
  const changed = useProjectsChanged()
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState(null)
  const [menu, setMenu] = useState(null)
  const [error, setError] = useState('')
  const hereId = folderId || drive._id
  const here = folderId ? folders.find((f) => f._id === folderId) : drive
  const crumbs = breadcrumb(drive, folders, folderId)
  const inside = childFolders(folders, hereId)
  const done = () => { changed(); onChanged() }

  async function addFolder(name) {
    await projectsApi.create({ name, parentId: hereId })
    setAdding(false)
    done()
  }
  async function rename(folder, name) {
    await projectsApi.update({ projectId: folder._id, name })
    setRenaming(null)
    done()
  }
  async function remove(folder) {
    setMenu(null)
    const isHere = folder._id === folderId
    const parent = folder.parentId === drive._id ? drive : folders.find((f) => f._id === folder.parentId)
    const copy = deleteFolderCopy({
      slates: isHere ? slateCount : folder.slateCount,
      folders: childFolders(folders, folder._id).length,
      parentName: parent?.name ? `“${parent.name}”` : 'the project',
    })
    if (!await confirmService.show({ theme, title: copy.title, message: copy.body })) return
    try {
      await projectsApi.remove({ projectId: folder._id, ...(copy.moveContents && { moveContentsTo: folder.parentId }) })
      if (isHere) onLeaveFolder(folder.parentId === drive._id ? null : folder.parentId)
      done()
    } catch (e) { setError(projectErrorWords(e)) }
  }

  return (
    <Box data-project-folders="" sx={{ display: 'grid', gap: 1.5, mb: 2 }}>
      {crumbs.length > 1 && (
        <Breadcrumbs aria-label="Folders">
          {crumbs.map((c, i) => (i === crumbs.length - 1
            ? <Typography key={c.id} color="text.primary" aria-current="page">{c.name}</Typography>
            : <Link key={c.id} to={projectPath(drive._id, c.id)} style={{ color: 'inherit' }}>{c.name}</Link>))}
        </Breadcrumbs>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {inside.map((f) => (renaming === f._id
          ? <NameField key={f._id} initial={f.name} label="Folder name" onSave={(name) => rename(f, name)} onCancel={() => setRenaming(null)} />
          : (
            <Box key={f._id} sx={{ display: 'inline-flex', alignItems: 'center' }}>
              <Chip icon={<FolderOutlinedIcon />} label={f.name} component={Link} to={projectPath(drive._id, f._id)} clickable variant="outlined" />
              {abilities.renameFolder && (
                <IconButton size="small" aria-label={`Options for ${f.name}`} onClick={(e) => setMenu({ anchor: e.currentTarget, folder: f })}>
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              )}
            </Box>
          )))}
        {abilities.createFolder && canNestUnder(here) && (adding
          ? <NameField label="New folder" onSave={addFolder} onCancel={() => setAdding(false)} />
          : <Button size="small" startIcon={<CreateNewFolderOutlinedIcon />} onClick={() => setAdding(true)}>New folder</Button>)}
        {folderId && abilities.renameFolder && renaming !== folderId && (
          <Button size="small" onClick={(e) => setMenu({ anchor: e.currentTarget, folder: here })}>This folder…</Button>
        )}
        {folderId && renaming === folderId && <NameField initial={here?.name} label="Folder name" onSave={(name) => rename(here, name)} onCancel={() => setRenaming(null)} />}
      </Box>
      {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setRenaming(menu.folder._id); setMenu(null) }}>Rename</MenuItem>
        {abilities.deleteFolder && <MenuItem onClick={() => remove(menu.folder)}>Delete folder</MenuItem>}
      </Menu>
    </Box>
  )
}

ProjectFolders.propTypes = {
  drive: PropTypes.shape({ _id: PropTypes.string.isRequired, name: PropTypes.string }).isRequired,
  folders: PropTypes.arrayOf(PropTypes.object).isRequired,
  folderId: PropTypes.string,
  abilities: PropTypes.object.isRequired,
  slateCount: PropTypes.number,
  onChanged: PropTypes.func.isRequired,
  onLeaveFolder: PropTypes.func.isRequired,
}
