/* eslint-disable no-underscore-dangle */
import React, { useState, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useTheme } from '@mui/material/styles'
import DeleteIcon from '@mui/icons-material/Delete'
import { useAtom } from 'jotai'

import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Paper from '@mui/material/Paper'

import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import IconButton from '@mui/material/IconButton'
import Checkbox from '@mui/material/Checkbox'
import Tooltip from '@mui/material/Tooltip'
import MailOutlineIcon from '@mui/icons-material/MailOutline'

import Box from '@mui/material/Box'
import confirmService from '../../common/confirm'
import {
  Permissions,
  Claims,
  Organizations,
} from '../../../api/common/models'
import AuthManager from '../../../api/common/AuthManager'
import CONSTANTS from '../../../api/common/constants'
import InviteTeamMembers from './InviteTeamMembers'

import { globalMessage, organizationInvites } from '../../jotai/atoms'

// Replace useStyles with sx prop
const tableStyles = {
  root: {
    width: '100%',
    marginTop: 3,
    overflowX: 'auto',
  },
  table: {
    minWidth: 2400,
  },
  sticky: {
    width: 350,
    position: 'sticky',
    left: 0,
    // backgroundColor: '#424242',
    zIndex: 999,
    boxShadow: '2px 2px 2px #000',
  },
}

export default function ManageOrganization() {
  const theme = useTheme()
  const org = useTracker(() => Organizations.findOne())
  const orgNameType = org?.isEducationInstitution ? 'Classroom' : 'Team'
  const orgPeopleType = org?.isEducationInstitution ? 'students' : 'members'
  const [sendingInvites, setSendingInvites] = useState(false)
  const [currentInvites, setCurrentInvites] = useAtom(organizationInvites)
  const [message, setMessage] = useAtom(globalMessage)
  const handleChangeDefer = React.useRef(null)
  const [localMemberUpdates, setLocalMemberUpdates] = useState({})

  // State for permissions
  const [permissionsLoaded, setPermissionsLoaded] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [canEditUsers, setCanEditUsers] = useState(false)
  const [canRemoveUsers, setCanRemoveUsers] = useState(false)
  const [canAddUsers, setCanAddUsers] = useState(false)
  const [memberPermissions, setMemberPermissions] = useState({})

  // Get permissions from Meteor collection - this will reactively update
  // when permissions change in the database
  const permissions = useTracker(() => Permissions.find().fetch())

  // Get members from Meteor collection with local updates overlay
  const members = useTracker(() => {
    const serverMembers = Meteor.users
      .find({ _id: { $ne: Meteor.userId() }, isOrgOwner: { $ne: true } })
      .fetch()

    // Overlay local updates on top of server data
    return serverMembers.map((member) => {
      const localUpdates = localMemberUpdates[member._id] || {}
      return {
        ...member,
        profile: {
          ...member.profile,
          ...localUpdates,
        },
      }
    })
  }, [localMemberUpdates])

  // Get claims - depend on isAdmin state
  const claims = useTracker(() => {
    if (isAdmin) {
      return Claims.find({ description: { $exists: true } }).fetch()
    }
    return Claims.find({
      _id: { $ne: CONSTANTS.claims.admin._id },
      description: { $exists: true },
    }).fetch()
  }, [isAdmin])

  // Consolidated permission loading
  useEffect(() => {
    // Skip if already loaded or no members/claims yet
    if (permissionsLoaded || !claims.length) return

    // Flag to prevent concurrent loading
    let isMounted = true

    async function loadAllPermissions() {
      try {
        // 1. Check current user permissions
        const hasAdminClaim = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.admin._id,
        ])
        const editUsers = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.canEditUsers._id,
        ])
        const removeUsers = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.canRemoveUsers._id,
        ])
        const addUsers = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.canAddUsers._id,
        ])

        // Only update state if component is still mounted
        if (!isMounted) return

        setIsAdmin(hasAdminClaim)
        setCanEditUsers(editUsers)
        setCanRemoveUsers(removeUsers)
        setCanAddUsers(addUsers)

        // 2. Batch load all member permissions
        const permissionsMap = {}

        // Prepare all permission check promises
        const allPermissionChecks = []

        members.forEach((member) => {
          permissionsMap[member._id] = {}

          claims.forEach((claim) => {
            // Add each permission check to our batch
            allPermissionChecks.push({
              memberId: member._id,
              claimId: claim._id,
              promise: AuthManager.userHasClaim(member._id, [claim._id]),
            })
          })
        })

        // Wait for all permission checks in parallel
        const results = await Promise.all(
          allPermissionChecks.map((check) => check.promise)
        )

        // Map results back to their corresponding members and claims
        results.forEach((result, index) => {
          const { memberId, claimId } = allPermissionChecks[index]
          if (!permissionsMap[memberId]) permissionsMap[memberId] = {}
          permissionsMap[memberId][claimId] = result
        })

        if (!isMounted) return

        // Update state once with all permissions
        setMemberPermissions(permissionsMap)
        setPermissionsLoaded(true)
      } catch (error) {
        console.error('Error loading permissions:', error)
      }
    }

    loadAllPermissions()

    // Cleanup function to prevent state updates if component unmounts
    // eslint-disable-next-line
    return () => {
      isMounted = false
    }
  }, [members, claims, permissions])

  // Reset permissions loaded flag when permissions change
  useEffect(() => {
    setPermissionsLoaded(false)
  }, [permissions])

  async function removeMember(member) {
    const userDetails = await Meteor.callAsync(CONSTANTS.methods.users.get, {
      _id: member._id,
      includeSlateCounts: true,
    })
    const res = await confirmService.show({
      theme,
      title: 'Remove user?',
      message: `<p>Are you certain you want to remove ${member.profile.firstName} ${member.profile.lastName} (${member.emails?.[0]?.address || 'not yet invited'})? Note that the ${userDetails[0].slateCount} slate(s) attached to them will be also be removed.</p><p><b>This delete CANNOT be undone.</b></p>`,
      actionItems: [
        { label: 'Cancel', return: false },
        { label: 'OK', return: true },
      ],
    })
    if (res) {
      // Their slates first (the server checks this admin may), then the account.
      await Meteor.callAsync('organizations.removeMemberSlates', member._id)
      await Meteor.users.removeAsync({ _id: member._id })
    }
  }

  async function handleChange(member, prop, val) {
    // Update local state immediately
    setLocalMemberUpdates((prev) => ({
      ...prev,
      [member._id]: {
        ...(prev[member._id] || {}),
        [prop]: val,
      },
    }))

    // Debounce server update
    clearTimeout(handleChangeDefer.current)
    handleChangeDefer.current = setTimeout(async () => {
      const update = await Meteor.callAsync(CONSTANTS.methods.users.update, {
        [prop]: val,
        userId: member._id,
      })
      if (!update) {
        setMessage({
          visible: false,
          isSnackBar: true,
          text: update,
          severity: 'error',
          autoHide: 10000,
        })
        // Revert local state on error
        setLocalMemberUpdates((prev) => {
          const newState = { ...prev }
          delete newState[member._id][prop]
          if (Object.keys(newState[member._id]).length === 0) {
            delete newState[member._id]
          }
          return newState
        })
      }
    }, 500)
  }

  async function handleEmailChange(member, prop) {
    const result = await confirmService.show({
      theme,
      title: `Change Email`,
      message: `Change the user's email from <b>${member.emails[0].address}</b> to: <div style="padding:10px"><input type="email" style="width: 300px;height:30px;" id="txtNewEmail" value="${member.emails[0].address}"/></div>`,
      actionItems: [
        { label: 'Send New Enrollment Email', return: true },
        { label: 'Cancel', return: false },
      ],
    })
    if (result) {
      const newEmail = document.getElementById('txtNewEmail').value
      if (newEmail === member.emails[0].address) {
        setMessage({
          visible: true,
          isSnackBar: true,
          text: `No enrollment email sent: the email stayed the same (${newEmail}).`,
          severity: 'error',
          autoHide: 10000,
        })
      } else {
        // ensure email is not used elsewhere
        const others = await Meteor.callAsync(CONSTANTS.methods.users.get, {
          email: newEmail,
          count: true,
        })
        if (others > 0) {
          setMessage({
            visible: true,
            isSnackBar: true,
            text: `This email is already in use, please choose a different one or contact support`,
            severity: 'error',
            autoHide: 50000,
          })
        } else {
          const update = await Meteor.callAsync(
            CONSTANTS.methods.users.update,
            { [prop]: newEmail, userId: member._id }
          )
          if (update) {
            setMessage({
              visible: false,
              isSnackBar: true,
              text: update,
              severity: 'info',
              autoHide: 10000,
            })
          } else {
            setMessage({
              visible: true,
              isSnackBar: true,
              text: update,
              severity: 'error',
              autoHide: 50000,
            })
          }
        }
      }
    }
  }

  async function handlePermission(member, claim, chk) {
    const pOpts = {
      users: [
        {
          orgId: member.orgId,
          userId: member._id,
          claimIds: [claim._id],
          action: chk ? 'add' : 'delete',
        },
      ],
    }
    const update = await Meteor.callAsync(
      CONSTANTS.methods.users.changeRoles,
      pOpts
    )
    if (!update) {
      setMessage({
        visible: true,
        isSnackBar: true,
        text: update,
        severity: 'error',
        autoHide: 10000,
      })
    }
  }

  const inviteNewMembers = async () => {
    if (sendingInvites) return
    setSendingInvites(true)
    try {
      if (currentInvites.length > 0) {
        const delivery = await Meteor.callAsync(CONSTANTS.methods.users.invite, {
          orgId: Meteor.user().orgId,
          invites: currentInvites,
        })
        setMessage({
          visible: true, severity: 'success',
          text: delivery.sent ? 'Enrollment email sent.' : 'These invitations were already sent.',
        })
        setCurrentInvites([])
      } else {
        setMessage({
          visible: true,
          isSnackBar: true,
          text: `You haven't added any ${
            org?.isEducationInstitution ? 'classroom' : 'team'
          } ${
            org?.isEducationInstitution ? 'students' : 'members'
          } to invite yet!`,
          severity: 'error',
          autoHide: 10000,
        })
      }
    } catch (err) {
      setMessage({
        visible: true,
        isSnackBar: true,
        text: `There was a problem inviting these users: ${err.message}`,
        severity: 'error',
        autoHide: 10000,
      })
    } finally {
      setSendingInvites(false)
    }
  }

  async function resendEnrollment(user) {
    const res = await confirmService.show({
      theme,
      title: 'Resend enrollment email?',
      message: `<p>Click OK to resend the user's enrollment email to ${user.emails[0].address}.</p>`,
      actionItems: [
        { label: 'Cancel', return: false },
        { label: 'OK', return: true },
      ],
    })
    if (res) {
      setSendingInvites(true)
      try {
        await Meteor.callAsync(CONSTANTS.methods.users.resendEnrollment, { users: [{ _id: user._id }] })
        setMessage({ visible: true, severity: 'info', text: 'Enrollment email resent to ' + user.emails[0].address })
      } catch (error) {
        setMessage({ visible: true, severity: 'error', text: error.reason || 'Could not resend the invitation.' })
      } finally {
        setSendingInvites(false)
      }
    }
  }

  return (
    <>
      <TableContainer component={Paper} sx={tableStyles.root}>
        <Table sx={tableStyles.table} size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={tableStyles.sticky}>Name / Email</TableCell>
              {claims.map((claim) => (
                <TableCell key={claim._id}>
                  {claim.label} <br />{' '}
                  <Typography color="secondary" variant="caption">
                    {claim.description}
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {members.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="secondary">
                    You have no{' '}
                    {org?.isEducationInstitution ? 'classroom' : 'team'}{' '}
                    {org?.isEducationInstitution ? 'students' : 'members'}{' '}
                    defined. Invite some below!
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {members.map((member, index) => (
              <TableRow
                key={member._id}
                sx={{
                  bgcolor: index % 2 ? 'background.paper' : 'shell.offset',
                }}
              >
                {canEditUsers ? (
                  <TableCell sx={tableStyles.sticky}>
                    <Grid
                      container
                      alignItems="top"
                      justifyContent="flex-start"
                      spacing={2}
                    >
                      <Grid size={1}>
                        {canRemoveUsers && (
                          <IconButton
                            aria-label="delete"
                            size="small"
                            onClick={() => {
                              removeMember(member)
                            }}
                          >
                            <DeleteIcon />
                          </IconButton>
                        )}
                      </Grid>
                      <Grid size={2}>
                        {canAddUsers && member &&
                          member.emails &&
                          member.emails[0] &&
                          !member.emails[0].verified && (
                            <Tooltip
                              color="secondary"
                              title={`${
                                org?.isEducationInstitution ? 'Student' : 'User'
                              } has not enrolled in the ${
                                org?.isEducationInstitution
                                  ? 'classroom'
                                  : 'team'
                              } yet. Click to resend the enrollment email.`}
                            >
                              <IconButton
                                aria-label={'Resend invitation to ' + member.emails[0].address}
                                disabled={sendingInvites}
                                size="small"
                                sx={{ ml: 1 }}
                                onClick={() => {
                                  resendEnrollment(member)
                                }}
                              >
                                <MailOutlineIcon color="error" />
                              </IconButton>
                            </Tooltip>
                          )}
                      </Grid>
                      <Grid size={4}>
                        <TextField
                          placeholder="First Name"
                          size="small"
                          variant="standard"
                          fullWidth
                          value={member.profile ? member.profile.firstName : ''}
                          onChange={(e) =>
                            handleChange(member, 'firstName', e.target.value)
                          }
                        />
                      </Grid>
                      <Grid size={5}>
                        <TextField
                          placeholder="Last Name"
                          size="small"
                          variant="standard"
                          fullWidth
                          value={member.profile ? member.profile.lastName : ''}
                          onChange={(e) =>
                            handleChange(member, 'lastName', e.target.value)
                          }
                        />
                      </Grid>
                      <Grid size={12}>
                        {member.emails?.[0] ? (
                          <Button
                            variant="text"
                            color="secondary"
                            onClick={() => handleEmailChange(member, 'email')}
                          >
                            {member.emails[0].address}
                          </Button>
                        ) : (
                          // A person a team import brought, not invited yet: no address to change.
                          <Typography color="secondary" variant="caption">
                            Not yet invited
                          </Typography>
                        )}
                      </Grid>
                    </Grid>
                  </TableCell>
                ) : (
                  <TableCell sx={tableStyles.sticky}>
                    {member.profile?.firstName} {member.profile?.lastName}
                    <br />
                    {member.emails?.[0]?.address || 'Not yet invited'}
                    {canAddUsers && member.emails?.[0] && !member.emails[0].verified && <Button disabled={sendingInvites}
                      onClick={() => resendEnrollment(member)}>Resend invitation</Button>}
                  </TableCell>
                )}
                {claims.map((claim) => (
                  <TableCell key={claim._id}>
                    <Tooltip
                      title={
                        !canEditUsers ? (
                          <>
                            You do not have permission to change{' '}
                            {claim.label.toLowerCase()}
                          </>
                        ) : (
                          <>{claim.label} </>
                        )
                      }
                    >
                      <Checkbox
                        name={claim._id}
                        checked={
                          memberPermissions[member._id]?.[claim._id] || false
                        }
                        onClick={(e) => {
                          handlePermission(member, claim, e.target.checked)
                        }}
                        disabled={!canEditUsers}
                      />
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {canAddUsers && (
        <Box m={2} p={2}>
          <Grid
            container
            spacing={2}
            alignItems="center"
            justifyContent="center"
          >
            <Grid size={12}>
              <Typography color="secondary">
                Invite New{' '}
                {org?.isEducationInstitution ? 'Students' : 'Members'}
              </Typography>
            </Grid>
            <Grid size={12}>
              <InviteTeamMembers />
            </Grid>
            {currentInvites.length > 0 && (
              <Grid>
                <Button
                  variant="contained"
                  color="secondary"
                  disabled={sendingInvites}
                  onClick={inviteNewMembers}
                >
                  Send Invites
                </Button>
              </Grid>
            )}
          </Grid>
        </Box>
      )}
    </>
  )
}
