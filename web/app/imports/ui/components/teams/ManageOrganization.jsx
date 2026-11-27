/* eslint-disable no-underscore-dangle */
// The team page for a person in a team (/team): a header with the member count and "Invite people",
// Slatebox Business as a compact card, and the people as rows (cards on a phone) with a plain-language
// role, a status and a "more" menu. Every action is the server method the old table called, checked
// the same way: users.update (names, address), users.changeRoles (roles, advanced permissions),
// users.invite / users.resendEnrollment, and organizations.removeMember (the slates and the account, one call).
import React, { useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSetAtom } from 'jotai'
import { Link as RouterLink } from 'react-router-dom'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PersonAddAlt1OutlinedIcon from '@mui/icons-material/PersonAddAlt1Outlined'
import SearchIcon from '@mui/icons-material/Search'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail'
import TuneIcon from '@mui/icons-material/Tune'
import SendOutlinedIcon from '@mui/icons-material/SendOutlined'
import PersonRemoveOutlinedIcon from '@mui/icons-material/PersonRemoveOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'

import { Permissions, Claims, Organizations } from '../../../api/common/models'
import CONSTANTS from '../../../api/common/constants'
import { enterpriseState } from '../../../api/common/edition.mjs'
import { globalMessage } from '../../jotai/atoms'
import BusinessPanel from './BusinessPanel'
import InvitePeopleDialog from './InvitePeopleDialog'
import memberShape from './member-shape'
import { AppPageHeader, PAGE_SPACE } from '../../common/AppPage'
import { AdvancedPermissionsDialog, ChangeEmailDialog, RemoveMemberDialog } from './MemberDialogs'
import {
  ADMIN, SERVER_ADMIN, assignableRoles, claimWords, displayName, extraClaims, holds, initials, memberStatus, roleChanges, roleOf,
} from './team-roles.mjs'

// The calm card the new pages share (Integrations, the AI control plane), from the shell palette.
export const teamCard = (theme) => ({
  bgcolor: 'shell.surface', border: '1px solid', borderColor: 'shell.border', borderRadius: '14px',
  ...theme.applyStyles('dark', { bgcolor: 'background.paper' }),
})

// Status chips with AA contrast in both modes (MUI's warning/success outlines are too light on cream).
const STATUS_SX = {
  active: (theme) => ({ bgcolor: '#dce9ce', color: '#183d28', ...theme.applyStyles('dark', { bgcolor: '#3c5344', color: '#e5f1dc' }) }),
  invited: (theme) => ({ bgcolor: '#fbecc8', color: '#5c3d00', ...theme.applyStyles('dark', { bgcolor: '#5a4519', color: '#ffe7b3' }) }),
  'not-invited': (theme) => ({ bgcolor: '#e9ebe4', color: '#3b4a40', ...theme.applyStyles('dark', { bgcolor: '#3a4a40', color: '#e3e8df' }) }),
  off: (theme) => ({ bgcolor: '#f3dcd8', color: '#6b2017', ...theme.applyStyles('dark', { bgcolor: '#5a2e29', color: '#ffd9d3' }) }),
}

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

const SEARCH_FROM = 7

const roleShape = PropTypes.shape({ id: PropTypes.string.isRequired, label: PropTypes.string.isRequired, blurb: PropTypes.string })

function NameEditor({ member, onDone }) {
  const [firstName, setFirstName] = useState(member.profile?.firstName || '')
  const [lastName, setLastName] = useState(member.profile?.lastName || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const save = async (event) => {
    event?.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const answer = await Meteor.callAsync(CONSTANTS.methods.users.update, { userId: member._id, firstName: firstName.trim(), lastName: lastName.trim() })
      if (typeof answer === 'string' && /successfully/.test(answer)) onDone()
      else setError(typeof answer === 'string' ? answer : 'The name was not saved. Try again.')
    } catch (err) {
      setError(err?.reason || 'The name was not saved. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Box component="form" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }}
      aria-label={`Edit the name of ${displayName(member)}`} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <TextField size="small" label="First name" value={firstName} autoFocus onChange={(e) => setFirstName(e.target.value)} sx={{ flex: '1 1 120px' }} />
      <TextField size="small" label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} sx={{ flex: '1 1 120px' }} />
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Button type="submit" size="small" variant="contained" disabled={saving}>Save</Button>
        <Button size="small" onClick={onDone} disabled={saving}>Cancel</Button>
      </Box>
      {error && <Typography role="alert" variant="body2" color="error" sx={{ flexBasis: '100%' }}>{error}</Typography>}
    </Box>
  )
}
NameEditor.propTypes = { member: memberShape.isRequired, onDone: PropTypes.func.isRequired }

function MemberRow({ member, me, claimIds, viewer, nouns, onAction, onRole, sending }) {
  const [anchor, setAnchor] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const name = displayName(member)
  const isSelf = member._id === me
  const role = roleOf({ isOrgOwner: member.isOrgOwner, claimIds })
  const status = memberStatus(member)
  const extras = extraClaims(claimIds)
  const targetIsAdmin = claimIds.includes(ADMIN)
  // the owner and the person themselves are shown, never changed here (as before: the old table left them out)
  const fixed = isSelf || member.isOrgOwner
  const mayEdit = !fixed && viewer.canEdit && (viewer.isAdmin || !targetIsAdmin)
  const mayResend = !fixed && viewer.canAdd && status.id === 'invited'
  // an admin is changed or removed only by an admin (the server's rule: server/team-guard.mjs)
  const mayRemove = !fixed && viewer.canRemove && (viewer.isAdmin || !targetIsAdmin)
  const menu = [
    mayEdit && { key: 'name', label: 'Edit name', icon: <EditOutlinedIcon fontSize="small" />, run: () => setEditingName(true) },
    mayEdit && member.emails?.[0]?.address && { key: 'email', label: 'Change email', icon: <AlternateEmailIcon fontSize="small" />, run: () => onAction('email', member) },
    mayEdit && { key: 'advanced', label: 'Advanced permissions', icon: <TuneIcon fontSize="small" />, run: () => onAction('advanced', member) },
    mayResend && { key: 'resend', label: 'Resend invite', icon: <SendOutlinedIcon fontSize="small" />, run: () => onAction('resend', member), disabled: sending },
    mayRemove && { key: 'remove', label: `Remove from ${nouns.team.toLowerCase()}`, icon: <PersonRemoveOutlinedIcon fontSize="small" color="error" />, run: () => onAction('remove', member), danger: true },
  ].filter(Boolean)
  const roles = assignableRoles({ viewerIsAdmin: viewer.isAdmin })
  const showCustom = role.id === 'custom'

  return (
    <Box component="li" data-team-member={member._id} data-member-status={status.id} data-member-role={role.id}
      sx={{
        listStyle: 'none', display: 'grid', alignItems: 'center', columnGap: 1.5, rowGap: 1, px: { xs: 1.75, sm: 2 }, py: 1.5,
        gridTemplateColumns: { xs: '40px minmax(0,1fr) auto', md: '40px minmax(0,1fr) 210px 200px 40px' },
        gridTemplateAreas: { xs: '"avatar who menu" "meta meta meta"', md: '"avatar who status role menu"' },
        '& + &': { borderTop: '1px solid', borderColor: 'divider' },
      }}>
      <Avatar aria-hidden sx={{ gridArea: 'avatar', width: 40, height: 40, fontSize: 15, fontWeight: 700, bgcolor: 'shell.selected', color: 'shell.selectedInk' }}>{initials(member)}</Avatar>
      <Box sx={{ gridArea: 'who', minWidth: 0 }}>
        {editingName ? <NameEditor member={member} onDone={() => setEditingName(false)} /> : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
              <Typography component="span" sx={{ fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Typography>
              {isSelf && <Chip size="small" label="You" sx={{ height: 20, fontSize: 12 }} />}
              {mayEdit && (
                <Tooltip title="Edit name">
                  <IconButton size="small" aria-label={`Edit the name of ${name}`} onClick={() => setEditingName(true)}
                    sx={{ opacity: { md: 0.4 }, '&:focus-visible': { opacity: 1 }, 'li:hover &': { opacity: 1 } }}>
                    <EditOutlinedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            <Typography variant="body2" color="text.secondary" title={member.emails?.[0]?.address}
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-member-email="">
              {member.emails?.[0]?.address || 'No email address yet (brought by a team import)'}
            </Typography>
          </>
        )}
      </Box>
      <Box sx={{ gridArea: { xs: 'meta', md: 'status' }, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: { xs: 'space-between', md: 'flex-start' } }}>
        <Chip size="small" label={status.label} sx={STATUS_SX[status.id]} data-member-status-chip="" />
        <Box sx={{ display: { xs: 'block', md: 'none' } }}>
          <RoleControl {...{ member, name, role, roles, mayEdit, showCustom, extras, onRole, onAction }} />
        </Box>
      </Box>
      <Box sx={{ gridArea: 'role', display: { xs: 'none', md: 'block' } }}>
        <RoleControl {...{ member, name, role, roles, mayEdit, showCustom, extras, onRole, onAction }} />
      </Box>
      <Box sx={{ gridArea: 'menu', justifySelf: 'end' }}>
        {menu.length > 0 && (
          <>
            <IconButton aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)}
              onClick={(e) => setAnchor(e.currentTarget)}><MoreHorizIcon /></IconButton>
            <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
              {menu.map((item) => [
                item.danger && menu.length > 1 && <Divider key={`${item.key}-divider`} />,
                <MenuItem key={item.key} disabled={item.disabled} onClick={() => { setAnchor(null); item.run() }}
                  sx={item.danger ? { color: 'error.main' } : undefined}>
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText>{item.label}{item.key === 'remove' || item.key === 'email' ? '…' : ''}</ListItemText>
                </MenuItem>,
              ])}
            </Menu>
          </>
        )}
      </Box>
    </Box>
  )
}
MemberRow.propTypes = {
  member: memberShape.isRequired, me: PropTypes.string.isRequired, claimIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  viewer: PropTypes.objectOf(PropTypes.bool).isRequired, nouns: PropTypes.objectOf(PropTypes.string).isRequired, onAction: PropTypes.func.isRequired,
  onRole: PropTypes.func.isRequired, sending: PropTypes.bool.isRequired,
}

function RoleControl({ member, name, role, roles, mayEdit, showCustom, extras, onRole, onAction }) {
  const [pendingRole, setPendingRole] = useState(null)
  const extraWords = extras.map((id) => claimWords({ _id: id }).label).join(', ')
  const more = extras.length > 0 && (
    <Tooltip title={`Also: ${extraWords}`}>
      <Typography component="span" variant="caption" color="text.secondary" tabIndex={0} aria-label={`Also: ${extraWords}`}
        sx={{ ml: 0.75, whiteSpace: 'nowrap', borderBottom: '1px dotted', borderColor: 'text.secondary', cursor: 'help' }}>
        +{extras.length} more
      </Typography>
    </Tooltip>
  )
  if (!mayEdit) {
    return <Typography variant="body2" sx={{ fontWeight: 600 }} data-member-role-label="">{role.label}{more}</Typography>
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <Select size="small" value={pendingRole || role.id}
        onChange={(e) => {
          const to = e.target.value
          if (to === 'custom') { onAction('advanced', member); return }
          // the choice shows at once; the server's rows take over when the call returns
          setPendingRole(to)
          Promise.resolve(onRole(member, to)).finally(() => setPendingRole(null))
        }}
        SelectDisplayProps={{ 'aria-label': `Role for ${name}` }} sx={{ minWidth: 140, fontSize: 14, '& .MuiSelect-select': { py: 0.75 } }}
        renderValue={(value) => (roles.find((r) => r.id === value) || role).label}
        MenuProps={{ slotProps: { paper: { sx: { maxWidth: 340 } } } }}>
        {roles.map((r) => (
          <MenuItem key={r.id} value={r.id} sx={{ whiteSpace: 'normal', alignItems: 'flex-start', display: 'block' }}>
            <Typography sx={{ fontWeight: 650 }}>{r.label}</Typography>
            <Typography variant="body2" color="text.secondary">{r.blurb}</Typography>
          </MenuItem>
        ))}
        {showCustom && (
          <MenuItem value="custom" sx={{ whiteSpace: 'normal', display: 'block' }}>
            <Typography sx={{ fontWeight: 650 }}>Custom</Typography>
            <Typography variant="body2" color="text.secondary">Open Advanced permissions</Typography>
          </MenuItem>
        )}
      </Select>
      {more}
    </Box>
  )
}
RoleControl.propTypes = {
  member: memberShape.isRequired, name: PropTypes.string.isRequired, role: roleShape.isRequired,
  roles: PropTypes.arrayOf(roleShape).isRequired, mayEdit: PropTypes.bool.isRequired, showCustom: PropTypes.bool.isRequired, extras: PropTypes.arrayOf(PropTypes.string).isRequired,
  onRole: PropTypes.func.isRequired, onAction: PropTypes.func.isRequired,
}

export default function ManageOrganization() {
  const setMessage = useSetAtom(globalMessage)
  const org = useTracker(() => Organizations.findOne())
  const me = useTracker(() => Meteor.userId())
  const edu = Boolean(org?.isEducationInstitution)
  const nouns = edu
    ? { team: 'Classroom', person: 'student', people: 'students' }
    : { team: 'Team', person: 'member', people: 'members' }

  const permissions = useTracker(() => Permissions.find({}, { fields: { userId: 1, claimId: 1 } }).fetch())
  const claimsOf = useMemo(() => {
    const map = new Map()
    permissions.forEach((row) => map.set(row.userId, [...(map.get(row.userId) || []), row.claimId]))
    return map
  }, [permissions])
  const mine = claimsOf.get(me) || []
  const meIsOwner = useTracker(() => Meteor.user()?.isOrgOwner === true)
  // the same reading AuthManager.userHasClaim gives on the client: the admin claim counts for every claim
  const viewer = {
    // the owner is always an admin (as on the server)
    isAdmin: meIsOwner || mine.includes(ADMIN),
    canEdit: holds(mine, 'canEditUsers'),
    canAdd: holds(mine, 'canAddUsers'),
    canRemove: holds(mine, 'canRemoveUsers'),
    // the server publishes the team list only to people with canViewUsers (orgUsers)
    canView: holds(mine, 'canViewUsers'),
  }
  // the claims Advanced permissions lists: admin only for an admin (as the old table's columns)
  const claims = useTracker(() => Claims.find(viewer.isAdmin
    ? { description: { $exists: true } }
    : { _id: { $ne: ADMIN }, description: { $exists: true } }).fetch(), [viewer.isAdmin])

  const people = useTracker(() => Meteor.users.find(org ? { orgId: org._id } : { _id: null }).fetch(), [org?._id])
  const sorted = useMemo(() => {
    const rank = (m) => {
      if (m.isOrgOwner) return 0
      if (m._id === me) return 1
      return memberStatus(m).id === 'active' ? 2 : 3
    }
    return [...people].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)))
  }, [people, me])
  const invitedCount = people.filter((m) => memberStatus(m).id === 'invited').length

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const shown = sorted.filter((m) => {
    if (filter !== 'all' && memberStatus(m).id !== filter) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    return `${displayName(m)} ${m.emails?.[0]?.address || ''}`.toLowerCase().includes(q)
  })

  const [inviting, setInviting] = useState(false)
  const [dialog, setDialog] = useState(null) // { kind: 'email' | 'remove' | 'advanced', member }
  const [sending, setSending] = useState(null) // the member whose invitation is being sent again

  const say = (text, severity = 'info') => setMessage({ visible: true, isSnackBar: true, text, severity, autoHide: 10000 })

  async function resend(member) {
    setSending(member._id)
    try {
      await Meteor.callAsync(CONSTANTS.methods.users.resendEnrollment, { users: [{ _id: member._id }] })
      say(`Invitation sent again to ${member.emails[0].address}.`)
    } catch (error) {
      say(error.reason || 'Could not resend the invitation.', 'error')
    } finally {
      setSending(null)
    }
  }

  async function changeRole(member, to) {
    const entries = roleChanges(claimsOf.get(member._id) || [], to)
    if (!entries.length) return
    try {
      const done = await Meteor.callAsync(CONSTANTS.methods.users.changeRoles, {
        users: entries.map((entry) => ({ orgId: member.orgId, userId: member._id, ...entry })),
      })
      if (!done) say('You do not have permission to change roles.', 'error')
    } catch (error) {
      say(error.reason || error.message || 'The role was not changed.', 'error')
    }
  }

  const onAction = (kind, member) => {
    if (kind === 'resend') resend(member)
    else setDialog({ kind, member })
  }

  const integrations = Boolean(me) && enterpriseState(Meteor.settings).unlocked
  const others = people.filter((m) => m._id !== me && !m.isOrgOwner)
  const count = people.length

  return (
    <Box data-team-page="" sx={{ display: 'grid', gap: PAGE_SPACE.section, pb: { xs: viewer.canAdd ? 10 : 0, sm: 0 } }}>
      <AppPageHeader
        sx={{ mb: 0 }}
        title={<>
          {nouns.team}
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}> · {org?.name}</Box>
        </>}
        subtitle={viewer.canView ? (
          <Box component="span" data-team-count={count}>
            {count} {count === 1 ? nouns.person : nouns.people}
            {invitedCount > 0 && ` · ${invitedCount} ${invitedCount === 1 ? 'invitation' : 'invitations'} not accepted yet`}
          </Box>
        ) : null}
        actions={(integrations || viewer.canAdd) ? <>
          {integrations && (
            <Button component={RouterLink} to="/integrations" startIcon={<HubOutlinedIcon />} data-team-integrations="">Agents and integrations</Button>
          )}
          {viewer.canAdd && (
            <Button variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setInviting(true)}
              sx={{ display: { xs: 'none', sm: 'inline-flex' } }} data-team-invite="">Invite people</Button>
          )}
        </> : null}
      />

      <BusinessPanel />

      <Box component="section" aria-labelledby="team-people-title" sx={(theme) => ({ ...teamCard(theme), overflow: 'hidden' })}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', px: { xs: 1.75, sm: 2 }, pt: 1.75, pb: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography id="team-people-title" variant="h6" component="h2" sx={{ fontWeight: 700, flex: 1, fontSize: 18 }}>People</Typography>
          {count >= SEARCH_FROM && (
            <>
              <TextField size="small" placeholder={`Search ${nouns.people}`} value={query} onChange={(e) => setQuery(e.target.value)}
                sx={{ flex: { xs: '1 1 100%', sm: '0 1 260px' } }}
                slotProps={{
                  htmlInput: { 'aria-label': `Search ${nouns.people} by name or email` },
                  input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> },
                }} />
              <Select size="small" value={filter} onChange={(e) => setFilter(e.target.value)} SelectDisplayProps={{ 'aria-label': 'Show' }} sx={{ minWidth: 150 }}>
                <MenuItem value="all">Everyone</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="invited">Invited</MenuItem>
                <MenuItem value="not-invited">Not invited yet</MenuItem>
              </Select>
            </>
          )}
        </Box>
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '40px minmax(0,1fr) 210px 200px 40px', columnGap: 1.5, px: 2, py: 0.75, bgcolor: 'shell.offset' }} aria-hidden>
          <span />
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Name</Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Status</Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Role</Typography>
          <span />
        </Box>
        <Box component="ul" aria-label={`${nouns.team} ${nouns.people}`} sx={{ m: 0, p: 0 }}>
          {shown.map((member) => (
            // eslint-disable-next-line react/jsx-no-bind
            <MemberRow key={member._id} {...{ member, me, viewer, nouns, onAction }} sending={sending === member._id} claimIds={claimsOf.get(member._id) || []} onRole={changeRole} />
          ))}
        </Box>
        {shown.length === 0 && count > 0 && (
          <Typography role="status" color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>No one matches that search.</Typography>
        )}
        {!viewer.canView && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 2, borderTop: '1px solid', borderColor: 'divider' }} data-team-list-hidden="">
            The {nouns.team.toLowerCase()}&apos;s owner, admins and managers see everyone on the {nouns.team.toLowerCase()}.
          </Typography>
        )}
        {viewer.canView && others.length === 0 && (
          <Box sx={{ px: 2, py: 3, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider' }} data-team-empty="">
            <Typography sx={{ fontWeight: 650 }}>It&apos;s just you so far</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: viewer.canAdd ? 1.5 : 0 }}>
              Invite {nouns.people} to work on slates together. They show here as invited until they accept.
            </Typography>
            {viewer.canAdd && <Button variant="outlined" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setInviting(true)}>Invite people</Button>}
          </Box>
        )}
      </Box>

      {viewer.canAdd && (
        <Box sx={(theme) => ({
          display: { xs: 'block', sm: 'none' }, position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 3, p: 1.5,
          pb: 'calc(12px + env(safe-area-inset-bottom))', bgcolor: 'shell.background', borderTop: '1px solid', borderColor: 'shell.border',
          ...theme.applyStyles('dark', { bgcolor: 'background.default' }),
        })}>
          <Button fullWidth size="large" variant="contained" startIcon={<PersonAddAlt1OutlinedIcon />} onClick={() => setInviting(true)} data-team-invite-sticky="">Invite people</Button>
        </Box>
      )}

      <Box component="span" sx={visuallyHidden} role="status" aria-live="polite">{sending ? 'Sending the invitation again…' : ''}</Box>

      {inviting && (
        <InvitePeopleDialog
          teamName={org?.name || ''}
          taken={people.map((m) => m.emails?.[0]?.address).filter(Boolean)}
          own={(Meteor.user()?.emails || []).map((e) => e.address)}
          onClose={() => setInviting(false)}
          onSent={(delivery) => { setInviting(false); say(delivery?.sent ? `${delivery.sent === 1 ? 'Invitation' : `${delivery.sent} invitations`} sent.` : 'These invitations were already sent.', 'success') }}
        />
      )}
      {dialog?.kind === 'email' && <ChangeEmailDialog member={dialog.member} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === 'remove' && <RemoveMemberDialog member={dialog.member} teamName={org?.name || ''} onClose={() => setDialog(null)} say={say} />}
      {dialog?.kind === 'advanced' && (
        <AdvancedPermissionsDialog member={dialog.member} claims={claims.filter((c) => c._id !== SERVER_ADMIN || (claimsOf.get(dialog.member._id) || []).includes(SERVER_ADMIN))}
          claimIds={claimsOf.get(dialog.member._id) || []}
          canEdit={viewer.canEdit && (viewer.isAdmin || !(claimsOf.get(dialog.member._id) || []).includes(ADMIN))} onClose={() => setDialog(null)} say={say} />
      )}
    </Box>
  )
}
