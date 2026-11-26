/* eslint-disable no-underscore-dangle */
// Admin (/admin): the home of a server administrator (the uberMensch claim alone; no team needed).
// The sections (Overview here, AI control, Library review) are linked at the top; the Overview
// dashboard comes first, then the tools. The route shows this page to administrators only
// (SBRoutes AdminRoute) and every method on it checks the claim again on the server.
import React, { useEffect } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import AppPage from '../common/AppPage'
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
import useServerAdmin from '../common/useServerAdmin'
import { ADMIN_SECTIONS, SELF_HOST_SECTIONS, selfHostedServer } from '../../api/common/server-admin.mjs'
import AdminOverview from './admin/AdminOverview'
import FreeBudget from './admin/FreeBudget'
import TeamImports from './admin/TeamImports'
import IntegrationsStatus from './admin/IntegrationsStatus'
import LibraryQueueCard from './admin/LibraryQueueCard'
import AIControlCard from './admin/ai/AIControlCard'
import UpdatesCard from './admin/updates/UpdatesCard'
import EnterpriseSlot from '../common/EnterpriseSlot'

export default function AdminTools() {
  const [txtSearch, setSearch] = React.useState('')
  const [users, setUsers] = React.useState([])
  const [filter, setFilter] = React.useState(
    CONSTANTS.educationCertification.requestStatuses.PENDING
  )
  const [, setGlobalMessage] = useAtom(globalMessage)
  const hasUberMenschClaim = useServerAdmin() === true

  const searchUsers = async () => {
    const allUsers = await Meteor.callAsync(CONSTANTS.methods.users.search, {
      search: txtSearch,
      filter,
    })
    setUsers(allUsers)
  }

  useEffect(() => {
    if (hasUberMenschClaim) searchUsers()
  }, [filter, hasUberMenschClaim])

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
    <AppPage title="Server admin" subtitle="How this Slatebox server is doing, and the tools to run it.">
      <Grid
        container
        alignItems="flex-start"
        justifyContent="center"
        spacing={3}
      >
        <Grid size={12}>
          <Box component="nav" aria-label="Admin sections" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} data-admin-sections="">
            {ADMIN_SECTIONS.map((section) => (
              <Button key={section.id} component={RouterLink} to={section.to} size="small" disableElevation
                variant={section.id === 'overview' ? 'contained' : 'outlined'} aria-current={section.id === 'overview' ? 'page' : undefined}
                data-admin-section={section.id}>
                {section.id === 'overview' ? 'Overview' : section.title}
              </Button>
            ))}
            {selfHostedServer(Meteor.settings) && SELF_HOST_SECTIONS.map((section) => (
              <Button key={section.id} component={RouterLink} to={section.to} size="small" disableElevation variant="outlined" data-admin-section={section.id}>
                {section.title}
              </Button>
            ))}
          </Box>
        </Grid>
        {Meteor.user() && hasUberMenschClaim && (
          <>
            <Grid size={12}>
              <AdminOverview />
            </Grid>
            <Grid size={12}>
              <Typography component="h2" variant="h5" sx={{ fontWeight: 750, mt: 2 }}>Tools</Typography>
            </Grid>
            {Meteor.settings.public.metered && (
              <Grid size={12}>
                <FreeBudget />
              </Grid>
            )}
            {selfHostedServer(Meteor.settings) && (
              <Grid size={12}>
                <UpdatesCard />
              </Grid>
            )}
            <Grid size={12}>
              <IntegrationsStatus />
            </Grid>
            <Grid size={12}>
              <LibraryQueueCard />
            </Grid>
            {/* Slatebox Cloud's team addresses (enterprise/client/TeamAddressesAdmin.jsx); empty elsewhere */}
            <Grid size={12}>
              <EnterpriseSlot name="admin.teamAddresses" />
            </Grid>
            <Grid size={12}>
              <AIControlCard />
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
    </AppPage>
  )
}
