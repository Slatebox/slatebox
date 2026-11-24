// "Invite people" on the team page: paste one or many addresses, check the names (the server asks
// for a first and last name with each invitation, so the page guesses them from the address), and
// send them all in one users.invite call, as the old form's "Send Invites" did.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import CloseIcon from '@mui/icons-material/Close'
import CONSTANTS from '../../../api/common/constants'
import { invitesReady, readInvites } from './team-roles.mjs'

export default function InvitePeopleDialog({ teamName, taken, own, onClose, onSent }) {
  const fullScreen = useMediaQuery(useTheme().breakpoints.down('sm'))
  const [text, setText] = useState('')
  const [list, setList] = useState([])
  const [problems, setProblems] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  // the addresses in the box join the list; what could not be read stays in the box
  const absorb = () => {
    const { people, problems: found } = readInvites(text, { taken: [...taken, ...list.map((p) => p.email)], own })
    const next = [...list, ...people]
    setList(next)
    setProblems(found)
    setText('')
    return next
  }
  const edit = (email, field, value) => setList(list.map((p) => (p.email === email ? { ...p, [field]: value } : p)))

  const send = async (event) => {
    event.preventDefault()
    if (sending) return
    // addresses still in the box join the list first and nothing is sent: the person checks the
    // guessed names (and sees any address that could not be read) before sending
    if (text.trim()) { absorb(); setError(''); return }
    const people = list
    if (!invitesReady(people)) {
      setError(people.length ? 'Add a first and last name for each person.' : 'Add at least one email address.')
      return
    }
    setSending(true)
    setError('')
    try {
      const delivery = await Meteor.callAsync(CONSTANTS.methods.users.invite, {
        orgId: Meteor.user().orgId,
        invites: people.map(({ email, firstName, lastName }) => ({ email, firstName: firstName.trim(), lastName: lastName.trim() })),
      })
      onSent(delivery)
    } catch (err) {
      setError(`There was a problem inviting these people: ${err.reason || err.message}`)
    } finally {
      setSending(false)
    }
  }

  const count = list.length
  let sendLabel = count > 1 ? `Send ${count} invitations` : 'Send invitation'
  if (text.trim()) sendLabel = 'Add to the list'
  if (sending) sendLabel = 'Sending…'
  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="sm" fullScreen={fullScreen} aria-labelledby="team-invite-title" data-team-invite-dialog="">
      <Box component="form" onSubmit={send} noValidate sx={{ display: 'flex', flexDirection: 'column', minHeight: fullScreen ? '100%' : undefined }}>
        <DialogTitle id="team-invite-title" sx={{ pr: 6 }}>
          Invite people to {teamName}
          <IconButton aria-label="Close" onClick={onClose} disabled={sending} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each person gets an email to join. They show as invited until they accept.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
            <TextField autoFocus fullWidth multiline minRows={2} maxRows={6} label="Email addresses" value={text}
              onChange={(e) => { setText(e.target.value); setError('') }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); absorb() } }}
              helperText="Paste one or more, separated by commas or new lines." id="team-invite-emails" />
            <Button variant="outlined" onClick={absorb} disabled={!text.trim()} sx={{ mt: 1 }}>Add</Button>
          </Box>
          {problems.length > 0 && (
            <Box role="alert" sx={{ mt: 1 }}>
              {problems.map((p) => <Typography key={p} variant="body2" color="error">{p}</Typography>)}
            </Box>
          )}
          {count > 0 && (
            <Box component="ul" aria-label={`People to invite (${count})`} sx={{ m: 0, mt: 2, p: 0, display: 'grid', gap: 1.25 }}>
              {list.map((person) => (
                <Box component="li" key={person.email} sx={{ listStyle: 'none', p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: '10px' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Typography title={person.email} sx={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.email}</Typography>
                    <IconButton size="small" aria-label={`Remove ${person.email} from the list`} onClick={() => setList(list.filter((p) => p.email !== person.email))}><CloseIcon fontSize="small" /></IconButton>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
                    <TextField size="small" fullWidth required label="First name" value={person.firstName}
                      error={Boolean(error) && !person.firstName.trim()} onChange={(e) => edit(person.email, 'firstName', e.target.value)}
                      inputProps={{ 'aria-label': `First name for ${person.email}` }} />
                    <TextField size="small" fullWidth required label="Last name" value={person.lastName}
                      error={Boolean(error) && !person.lastName.trim()} onChange={(e) => edit(person.email, 'lastName', e.target.value)}
                      inputProps={{ 'aria-label': `Last name for ${person.email}` }} />
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {count > 0 && !error && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }} data-team-invite-review="">Check the names, then send.</Typography>
          )}
          {error && <Typography role="alert" color="error" variant="body2" sx={{ mt: 1.5 }}>{error}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <Button onClick={onClose} disabled={sending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={sending || (!count && !text.trim())} data-team-invite-send="">
            {sendLabel}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
InvitePeopleDialog.propTypes = {
  teamName: PropTypes.string.isRequired, taken: PropTypes.arrayOf(PropTypes.string).isRequired,
  own: PropTypes.arrayOf(PropTypes.string).isRequired, onClose: PropTypes.func.isRequired, onSent: PropTypes.func.isRequired,
}
