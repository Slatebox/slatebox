/* eslint-disable no-underscore-dangle */
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import Container from '@mui/material/Container'
import Grid from '@mui/material/Grid2'
import InputAdornment from '@mui/material/InputAdornment'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Box from '@mui/material/Box'
import CONSTANTS from '../../api/common/constants'
import { globalMessage } from '../jotai/atoms'
import AuthManager from '../../api/common/AuthManager'
import FreeBudget from './admin/FreeBudget'
import TeamImports from './admin/TeamImports'
import EnterpriseLicense from './admin/EnterpriseLicense'

export default function AdminTools() {
  const [txtSearch, setSearch] = React.useState('')
  const [users, setUsers] = React.useState([])
  const [filter, setFilter] = React.useState(
    CONSTANTS.educationCertification.requestStatuses.PENDING
  )
  const [, setGlobalMessage] = useAtom(globalMessage)
  const [hasUberMenschClaim, setHasUberMenschClaim] = useState(false)

  const searchUsers = async () => {
    const allUsers = await Meteor.callAsync(CONSTANTS.methods.users.search, {
      search: txtSearch,
      filter,
    })
    setUsers(allUsers)
  }

  useEffect(() => {
    searchUsers()
  }, [filter])

  useEffect(() => {
    async function checkClaims() {
      if (Meteor.user()) {
        const hasUberMensch = await AuthManager.userHasClaim(
          Meteor.userId(),
          [CONSTANTS.claims.uberMensch._id],
          true
        )
        setHasUberMenschClaim(hasUberMensch)
      }
    }

    checkClaims()
  }, [])

  const certifyUserForEducation = (userId) => async () => {
    const copyUsers = [...users]
    const cert = await Meteor.callAsync(
      CONSTANTS.methods.users.certifyForEducation,
      {
        userId,
      }
    )
    const index = copyUsers.findIndex((u) => u._id === userId)

    copyUsers[index].isEducationCertified = cert
    setUsers(copyUsers)
    setGlobalMessage({
      visible: true,
      text: `Set this user to be certified for education: ${cert}`,
      severity: 'info',
      autoHide: 10000,
    })
  }

  const filterableCertifications = [
    {
      name: 'None',
      key: 'none',
      value: null,
    },
    {
      name: 'Already Certified',
      value: CONSTANTS.educationCertification.requestStatuses.CERTIFIED,
    },
    {
      name: 'Requested Certification',
      value: CONSTANTS.educationCertification.requestStatuses.PENDING,
    },
  ]

  return (
    <Container maxWidth="xl">
      <Grid
        container
        alignItems="flex-start"
        justifyContent="center"
        spacing={3}
      >
        <Grid size={12}>
          <Typography component="h1" variant="h5" color="text.primary">
            <Box p={1}>Admin Tools</Box>
          </Typography>
        </Grid>
        {Meteor.user() && hasUberMenschClaim && (
          <>
            {Meteor.settings.public.metered && (
              <Grid size={12}>
                <FreeBudget />
              </Grid>
            )}
            <Grid size={12}>
              <EnterpriseLicense />
            </Grid>
            <Grid size={12}>
              <TeamImports />
            </Grid>
            <Grid size={12}>
              <Grid container>
                <Grid>
                  <Box mb={5}>
                    <Select
                      minRows={4}
                      value={filter}
                      onChange={(e) => {
                        setFilter(e.target.value)
                      }}
                    >
                      {filterableCertifications?.map((v) => [
                        <MenuItem
                          key={v.key || v.value}
                          value={v.key || v.value}
                        >
                          <Typography variant="h6" color="secondary">
                            {v.name}
                          </Typography>
                        </MenuItem>,
                      ])}
                    </Select>
                  </Box>
                </Grid>
              </Grid>
              <TextField
                name="txtSearch"
                variant="outlined"
                fullWidth
                id="txtSearch"
                label="search for users"
                value={txtSearch}
                onChange={(e) => {
                  setSearch(e.target.value)
                }}
                autoFocus
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Button
                        color="secondary"
                        variant="outlined"
                        onClick={searchUsers}
                      >
                        Go
                      </Button>
                    </InputAdornment>
                  ),
                }}
              />
            </Grid>
            {users.map((user) => (
              // code for mapping over users
              <Grid size={12}>
                <Typography variant="h6" color="secondary">
                  <Box p={2}>
                    <Button onClick={certifyUserForEducation(user._id)}>
                      {user.isEducationCertified ? 'decertify' : 'certify'} for
                      education
                    </Button>{' '}
                    {user.profile?.firstName} {user.profile?.lastName} -{' '}
                    {user.emails?.[0]?.address || 'not yet invited'}
                  </Box>
                </Typography>
              </Grid>
            ))}
          </>
        )}
      </Grid>
    </Container>
  )
}
