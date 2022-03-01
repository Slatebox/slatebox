import React from 'react'
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles'
import DeleteIcon from '@material-ui/icons/Delete'
import { useDispatch, useSelector } from 'react-redux'

import Table from '@material-ui/core/Table'
import TableBody from '@material-ui/core/TableBody'
import TableCell from '@material-ui/core/TableCell'
import TableContainer from '@material-ui/core/TableContainer'
import TableRow from '@material-ui/core/TableRow'
import Paper from '@material-ui/core/Paper'
import Button from '@material-ui/core/Button'
import TextField from '@material-ui/core/TextField'
import IconButton from '@material-ui/core/IconButton'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'

const useStyles = makeStyles(() => ({
  lightRow: {
    background: '#424242',
  },
  darkRow: {
    background: '#303030',
  },
}))

export default function InviteTeamMembers() {
  const dispatch = useDispatch()
  const classes = useStyles()
  const emptyInvite = { firstName: null, lastName: null, email: null }
  const invitees = useSelector((state) => state.currentInvites) || []
  const [nextInvite, setNextInvite] = React.useState(emptyInvite)
  const [nextEmail, setNextEmail] = React.useState({
    isError: false,
    helperText: '',
  })
  let emailCheck = null

  const handleInvite = () => {
    if (
      !nextEmail.isError &&
      nextInvite.firstName.trim() !== '' &&
      nextInvite.lastName.trim() !== ''
    ) {
      const currentInvites = invitees
      currentInvites.push(nextInvite)
      dispatch({ type: 'canvas', currentInvites })
      setNextInvite(emptyInvite)
    }
  }

  async function handleInviteChange(val, prop) {
    if (prop === 'email') {
      if (val.indexOf('@') === -1) {
        setNextEmail({ isError: true, helperText: 'Invalid Email' })
      } else if (val.trim() !== '') {
        window.clearTimeout(emailCheck)
        emailCheck = window.setTimeout(async () => {
          const others = await promisify(
            Meteor.call,
            CONSTANTS.methods.users.get,
            { email: val, count: true }
          )
          if (others > 0) {
            if (Meteor.user().emails[0].address === val) {
              setNextEmail({
                isError: true,
                helperText:
                  'This is your email. Invite OTHER users to your team!',
              })
            } else {
              setNextEmail({
                isError: true,
                helperText: 'This email is in use!',
              })
            }
          } else {
            setNextEmail({ isError: false, helperText: '' })
          }
        }, 500)
      }
    }
    const next = { ...nextInvite }
    next[prop] = val
    setNextInvite(next)
  }

  function removeInvite(invite) {
    let remove = invitees
    remove = remove.filter((n) => n.email !== invite.email)
    dispatch({ type: 'canvas', currentInvites: remove })
  }

  return (
    <TableContainer component={Paper}>
      <Table>
        <TableBody>
          {invitees.map((invite, index) => (
            <TableRow
              key={invite.email}
              className={index % 2 ? classes.darkRow : classes.lightRow}
            >
              <TableCell>
                <IconButton
                  aria-label="delete"
                  onClick={() => {
                    removeInvite(invite)
                  }}
                >
                  <DeleteIcon />
                </IconButton>
              </TableCell>
              <TableCell component="th" scope="row">
                {invite.firstName}
              </TableCell>
              <TableCell>{invite.lastName}</TableCell>
              <TableCell>{invite.email}</TableCell>
              <TableCell />
            </TableRow>
          ))}
          <TableRow key="inviteRow">
            <TableCell />
            <TableCell>
              <TextField
                size="small"
                variant="outlined"
                autoFocus
                fullWidth
                id="inviteFirstName"
                label="First Name"
                value={nextInvite.firstName || ''}
                error={nextInvite.firstName?.trim() === ''}
                helperText={nextEmail.isError ? ' ' : ''}
                onBlur={(e) => {
                  handleInviteChange(e.target.value, 'firstName')
                }}
                onChange={(e) => {
                  handleInviteChange(e.target.value, 'firstName')
                }}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </TableCell>
            <TableCell>
              <TextField
                size="small"
                variant="outlined"
                fullWidth
                id="inviteFirstName"
                label="Last Name"
                value={nextInvite.lastName || ''}
                error={nextInvite.lastName?.trim() === ''}
                helperText={nextEmail.isError ? ' ' : ''}
                onBlur={(e) => {
                  handleInviteChange(e.target.value, 'lastName')
                }}
                onChange={(e) => {
                  handleInviteChange(e.target.value, 'lastName')
                }}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </TableCell>
            <TableCell>
              <TextField
                size="small"
                variant="outlined"
                fullWidth
                id="inviteEmail"
                label="Email"
                value={nextInvite.email || ''}
                error={nextEmail.isError}
                helperText={nextEmail.helperText}
                required
                onBlur={(e) => {
                  handleInviteChange(e.target.value, 'email')
                }}
                onChange={(e) => {
                  handleInviteChange(e.target.value, 'email')
                }}
                InputLabelProps={{
                  style: { color: '#fff' },
                }}
              />
            </TableCell>
            <TableCell>
              <Button onClick={handleInvite}>Add User</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  )
}
