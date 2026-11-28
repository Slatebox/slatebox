// Share a project like a drive: people (any Slatebox account, or an email that has none yet), a
// whole team, and a link. Everyone given a role gets it on every slate in the drive and its folders.
// Modeled on the slate's Share dialog (components/slate/SlateSharing.jsx). Owners and managers share;
// a manager hands out at most manager. Each change is one projects.share call, checked and recorded
// in the activity log on the server.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import CloseIcon from '@mui/icons-material/Close'
import { Organizations } from '../../../api/common/models'
import projectsApi from '../../../api/client/projects'
import { useProjectsChanged } from './useProjects'
import {
  LINK_ROLES, LINK_WORDS, ROLE_HELP, ROLE_WORDS, accessRows, linkGrant, looksLikeEmail, projectErrorWords, projectLinkUrl, shareRoleOptions,
} from './projectsModel.mjs'

function RoleSelect({ value, options, onChange, label, disabled }) {
  return (
    <Select size="small" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} inputProps={{ 'aria-label': label }}
      renderValue={(v) => ROLE_WORDS[v]}>
      {options.map((role) => (
        <MenuItem key={role} value={role} sx={{ display: 'block' }}>
          <Typography>{ROLE_WORDS[role]}</Typography>
          {ROLE_HELP[role] && <Typography variant="caption" color="text.secondary">{ROLE_HELP[role]}</Typography>}
        </MenuItem>
      ))}
    </Select>
  )
}

export default function ProjectShareDialog({ open, drive, role, onClose }) {
  const changed = useProjectsChanged()
  const team = useTracker(() => {
    const orgId = Meteor.user()?.orgId
    return orgId ? { orgId, name: Organizations.findOne(orgId)?.name || 'your team' } : null
  }, [])
  const [grants, setGrants] = useState(null)
  const [who, setWho] = useState('')
  const [newRole, setNewRole] = useState('editor')
  const [teamRole, setTeamRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const options = shareRoleOptions(role)
  useEffect(() => {
    if (!open || !drive?._id) return undefined
    let live = true
    setGrants(null); setError(''); setCopied(''); setWho('')
    projectsApi.access({ projectId: drive._id }).then((a) => { if (live) setGrants(a?.grants ?? []) }, (e) => { if (live) { setGrants([]); setError(projectErrorWords(e)) } })
    return () => { live = false }
  }, [open, drive?._id])
  async function share(change) {
    setBusy(true)
    setError('')
    try {
      const answer = await projectsApi.share({ projectId: drive._id, ...change })
      if (Array.isArray(answer?.grants)) setGrants(answer.grants)
      else setGrants((await projectsApi.access({ projectId: drive._id }))?.grants ?? [])
      changed()
      return true
    } catch (e) {
      setError(projectErrorWords(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  async function invite(event) {
    event.preventDefault()
    if (!looksLikeEmail(who)) { setError('Enter the email address of the person to invite.'); return }
    if (await share({ email: who.trim(), role: newRole })) setWho('')
  }
  const rows = grants ? accessRows({ drive, grants }) : []
  const link = linkGrant(grants)
  const linkUrl = projectLinkUrl(window.location.origin, link.accessKey)
  const teamGrant = team && grants?.find((g) => g.kind === 'team' && g.orgId === team.orgId)
  async function copyLink() {
    try { await navigator.clipboard.writeText(linkUrl); setCopied('Link copied.') } catch { setCopied('Select the link and copy it.') }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="project-share-title">
      <DialogTitle id="project-share-title">Share “{drive?.name}”</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Everyone here gets their role on every slate in this project and its folders. Slates stay their owner’s.
        </Typography>
        {options.length > 0 && (
          <Box component="form" onSubmit={invite} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField size="small" label="Invite by email" type="email" value={who} onChange={(e) => setWho(e.target.value)} sx={{ flex: '1 1 220px' }} />
            <RoleSelect value={newRole} options={options} onChange={setNewRole} label="Role for the person invited" disabled={busy} />
            <Button type="submit" variant="contained" disableElevation disabled={busy || !who.trim()}>Invite</Button>
          </Box>
        )}
        <Box component="ul" aria-label="People with access" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
          {grants === null && <Typography component="li" sx={{ listStyle: 'none' }} color="text.secondary">Finding who has access…</Typography>}
          {grants && rows.map((row) => (
            <Box component="li" key={row.key} sx={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap>{row.name}</Typography>
                {row.detail && <Typography variant="caption" color="text.secondary" noWrap component="div">{row.detail}</Typography>}
              </Box>
              {row.removable && options.length > 0 && options.includes(row.role) ? (
                <>
                  <RoleSelect value={row.role} options={options} disabled={busy} label={`Role for ${row.name}`}
                    onChange={(next) => share(row.kind === 'team' ? { orgId: row.orgId, role: next } : row.userId ? { userId: row.userId, role: next } : { email: row.email, role: next })} />
                  <IconButton aria-label={`Remove ${row.name}`} disabled={busy}
                    onClick={() => share(row.kind === 'team' ? { orgId: row.orgId, role: 'none' } : row.userId ? { userId: row.userId, role: 'none' } : { email: row.email, role: 'none' })}>
                    <CloseIcon />
                  </IconButton>
                </>
              ) : <Typography color="text.secondary">{ROLE_WORDS[row.role]}</Typography>}
            </Box>
          ))}
        </Box>
        {team && options.length > 0 && (
          <>
            <Divider />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography sx={{ flex: '1 1 220px' }}>{teamGrant ? `Everyone in ${team.name} has access` : `Give everyone in ${team.name} access`}</Typography>
              {!teamGrant && <RoleSelect value={teamRole} options={options} onChange={setTeamRole} label="Role for the team" disabled={busy} />}
              {!teamGrant && <Button variant="outlined" disabled={busy} onClick={() => share({ orgId: team.orgId, role: teamRole })}>Add team</Button>}
            </Box>
          </>
        )}
        {options.length > 0 && (
          <>
            <Divider />
            <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'start' }}>
              <Typography fontWeight={650}>Link</Typography>
              <Select size="small" value={link.role} disabled={busy} inputProps={{ 'aria-label': 'Who the link lets in' }}
                onChange={(e) => share({ link: e.target.value })}>
                {LINK_ROLES.map((r) => <MenuItem key={r} value={r}>{LINK_WORDS[r]}</MenuItem>)}
              </Select>
              {link.role !== 'none' && linkUrl && (
                <>
                  <Box component="input" aria-label="Project link" readOnly value={linkUrl} onFocus={(e) => e.target.select()}
                    sx={{ width: '100%', boxSizing: 'border-box', color: 'text.primary', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, font: 'inherit', p: 1 }} />
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="contained" disableElevation onClick={copyLink} disabled={busy}>Copy link</Button>
                    {/* A new link: the old one stops working at once. */}
                    <Button onClick={() => share({ link: link.role, rotate: true })} disabled={busy}>Make a new link</Button>
                  </Box>
                  {copied && <Typography role="status" variant="body2">{copied}</Typography>}
                </>
              )}
            </Box>
          </>
        )}
        {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={busy}>Done</Button></DialogActions>
    </Dialog>
  )
}

ProjectShareDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  drive: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, ownerName: PropTypes.string }),
  role: PropTypes.string,
  onClose: PropTypes.func.isRequired,
}
