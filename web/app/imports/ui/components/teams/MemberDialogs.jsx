/* eslint-disable no-underscore-dangle */
// The team page's dialogs for one person: change their email address, remove them (and the slates
// they own), and Advanced permissions (every stored claim, one switch each). The server calls are
// the ones the old table made: users.update, users.get, organizations.removeMemberSlates then the
// account removal, users.changeRoles.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../../api/common/constants'
import memberShape from './member-shape'
import { ADMIN, SERVER_ADMIN, claimWords, displayName, roleOf, sortClaims } from './team-roles.mjs'

const useFullScreen = () => useMediaQuery(useTheme().breakpoints.down('sm'))

export function ChangeEmailDialog({ member, onClose, say }) {
  const current = member.emails[0].address
  const [email, setEmail] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fullScreen = useFullScreen()
  const save = async (event) => {
    event.preventDefault()
    const next = email.trim()
    if (next === current) { setError('That is their address already.'); return }
    setBusy(true)
    setError('')
    try {
      // the address must not be in use elsewhere (as before)
      const others = await Meteor.callAsync(CONSTANTS.methods.users.get, { email: next, count: true })
      if (others > 0) { setError('This address is already in use. Choose a different one or contact support.'); return }
      const answer = await Meteor.callAsync(CONSTANTS.methods.users.update, { email: next, userId: member._id })
      if (typeof answer === 'string' && /updated/.test(answer)) { say(answer, 'info'); onClose() } else setError(answer || 'The address was not changed.')
    } catch (err) {
      setError(err?.reason || 'The address was not changed. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" fullScreen={fullScreen} aria-labelledby="team-email-title">
      <Box component="form" onSubmit={save} noValidate>
        <DialogTitle id="team-email-title">Change {displayName(member)}&apos;s email</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            They get a new enrollment email at the new address. The old address stops working for sign-in.
          </Typography>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <TextField autoFocus fullWidth type="email" label="Email address" value={email} onChange={(e) => { setEmail(e.target.value); setError('') }}
            error={Boolean(error)} helperText={error || ' '} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !email.trim()}>Change and send email</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
ChangeEmailDialog.propTypes = { member: memberShape.isRequired, onClose: PropTypes.func.isRequired, say: PropTypes.func.isRequired }

export function RemoveMemberDialog({ member, teamName, onClose, say }) {
  const [slateCount, setSlateCount] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fullScreen = useFullScreen()
  useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.users.get, { _id: member._id, includeSlateCounts: true })
      .then((details) => { if (live) setSlateCount(details?.[0]?.slateCount ?? 0) })
      .catch(() => { if (live) setSlateCount(0) })
    return () => { live = false }
  }, [member._id])
  const name = displayName(member)
  let slatesLine = 'Counting their slates…'
  if (slateCount === 1) slatesLine = 'The 1 slate they own is removed too.'
  else if (slateCount !== null) slatesLine = `The ${slateCount} slates they own are removed too.`
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      // their slates first (the server checks this person may), then the account
      await Meteor.callAsync('organizations.removeMemberSlates', member._id)
      await Meteor.users.removeAsync({ _id: member._id })
      say(`${name} was removed from ${teamName}.`, 'success')
      onClose()
    } catch (err) {
      setError(err?.reason || err?.message || 'They were not removed. Try again.')
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" fullScreen={fullScreen} role="alertdialog"
      aria-labelledby="team-remove-title" aria-describedby="team-remove-body">
      <DialogTitle id="team-remove-title">Remove {name}?</DialogTitle>
      <DialogContent id="team-remove-body">
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
          {name} ({member.emails?.[0]?.address || 'not invited yet'}) leaves {teamName}.{' '}
          {slatesLine}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 700 }}>This can&apos;t be undone.</Typography>
        {error && <Typography role="alert" variant="body2" color="error" sx={{ mt: 1.5 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <Button onClick={onClose} disabled={busy} autoFocus>Cancel</Button>
        <Button variant="contained" color="error" onClick={remove} disabled={busy || slateCount === null} data-team-remove-confirm="">Remove</Button>
      </DialogActions>
    </Dialog>
  )
}
RemoveMemberDialog.propTypes = { member: memberShape.isRequired, teamName: PropTypes.string.isRequired, onClose: PropTypes.func.isRequired, say: PropTypes.func.isRequired }

export function AdvancedPermissionsDialog({ member, claims, claimIds, canEdit, onClose, say }) {
  const [busy, setBusy] = useState(null)
  // the switch moves at once; the server's rows take over when the call returns
  const [pending, setPending] = useState({})
  const fullScreen = useFullScreen()
  const isAdmin = claimIds.includes(ADMIN)
  const role = roleOf({ isOrgOwner: member.isOrgOwner, claimIds })
  const toggle = async (claim, on) => {
    setBusy(claim._id)
    setPending({ [claim._id]: on })
    try {
      const done = await Meteor.callAsync(CONSTANTS.methods.users.changeRoles, {
        users: [{ orgId: member.orgId, userId: member._id, claimIds: [claim._id], action: on ? 'add' : 'delete' }],
      })
      if (!done) say('You do not have permission to change roles.', 'error')
    } catch (err) {
      say(err?.reason || err?.message || 'That permission was not changed.', 'error')
    } finally {
      setBusy(null)
      setPending({})
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="team-advanced-title" data-team-advanced={member._id}>
      <DialogTitle id="team-advanced-title" sx={{ pb: 0.5 }}>Advanced permissions</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {displayName(member)} is {role.id === 'admin' ? 'an' : 'a'} <b>{role.label}</b>. Turn single permissions on or off; the role follows.
          {isAdmin && ' An admin has every permission.'}
        </Typography>
        <Box component="ul" sx={{ m: 0, p: 0 }}>
          {sortClaims(claims).map((claim) => {
            const words = claimWords(claim)
            const held = pending[claim._id] ?? claimIds.includes(claim._id)
            const included = isAdmin && claim._id !== ADMIN && claim._id !== SERVER_ADMIN
            const id = `team-claim-${claim._id}`
            return (
              <Box component="li" key={claim._id} sx={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 2, py: 1, '& + &': { borderTop: '1px solid', borderColor: 'divider' } }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography id={id} sx={{ fontWeight: 600 }}>{words.label}</Typography>
                  <Typography variant="body2" color="text.secondary">{included ? 'Included with Admin.' : words.description}</Typography>
                </Box>
                <Switch checked={held || included} disabled={!canEdit || included || claim._id === SERVER_ADMIN || busy !== null}
                  onChange={(e) => toggle(claim, e.target.checked)} inputProps={{ 'aria-labelledby': id }} />
              </Box>
            )
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}
AdvancedPermissionsDialog.propTypes = {
  member: memberShape.isRequired, claims: PropTypes.arrayOf(PropTypes.shape({ _id: PropTypes.string.isRequired, label: PropTypes.string, description: PropTypes.string })).isRequired, claimIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  canEdit: PropTypes.bool.isRequired, onClose: PropTypes.func.isRequired, say: PropTypes.func.isRequired,
}
