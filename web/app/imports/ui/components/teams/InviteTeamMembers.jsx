import React, { useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { organizationInvites } from '../../jotai/atoms'

const emptyInvite = { firstName: '', lastName: '', email: '' }

export default function InviteTeamMembers() {
  const [invitees, setInvitees] = useAtom(organizationInvites)
  const [draft, setDraft] = useState(emptyInvite)
  const [error, setError] = useState('')

  function change(event) {
    setDraft({ ...draft, [event.target.name]: event.target.value })
    setError('')
  }

  function addPerson(event) {
    event.preventDefault()
    const firstName = draft.firstName.trim()
    const lastName = draft.lastName.trim()
    const email = draft.email.trim().toLowerCase()
    if (!firstName || !lastName || !email) return
    if (Meteor.user()?.emails?.some((address) => address.address.toLowerCase() === email)) {
      setError('This is your email address. Enter the address of the person you want to invite.')
      return
    }
    if (invitees.some((invite) => invite.email.toLowerCase() === email)) {
      setError('This person is already on your invitation list.')
      return
    }
    setInvitees([...invitees, { firstName, lastName, email }])
    setDraft(emptyInvite)
    setError('')
  }

  return (
    <Stack spacing={2}>
      {invitees.length > 0 && (
        <Stack component="ul" aria-label="People to invite" spacing={1} sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {invitees.map((person) => (
            <Stack key={person.email} component="li" direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{person.firstName} {person.lastName} · {person.email}</Typography>
              <Button size="small" aria-label={`Remove ${person.email}`}
                onClick={() => setInvitees(invitees.filter((invite) => invite.email !== person.email))}>Remove</Button>
            </Stack>
          ))}
        </Stack>
      )}
      <Stack component="form" onSubmit={addPerson} spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField size="small" label="First name" id="inviteFirstName" name="firstName" required fullWidth
            value={draft.firstName} onChange={change} />
          <TextField size="small" label="Last name" id="inviteLastName" name="lastName" required fullWidth
            value={draft.lastName} onChange={change} />
        </Stack>
        <TextField size="small" label="Email" id="inviteEmail" name="email" type="email" required fullWidth
          value={draft.email} onChange={change} error={Boolean(error)}
          helperText={error || undefined} />
        <Button type="submit" variant="outlined" sx={{ alignSelf: 'flex-start' }}
          disabled={!draft.firstName.trim() || !draft.lastName.trim() || !draft.email.trim()}>Add to invitation list</Button>
      </Stack>
    </Stack>
  )
}
