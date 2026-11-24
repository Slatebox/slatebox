// /team: a person in a team manages it here (ManageOrganization: the header, Slatebox Business and
// the people); a person without one makes one (CreateOrganization), once they have saved their work
// and verified their email.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import { useTracker } from 'meteor/react-meteor-data'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import CreateOrganization from '../components/teams/CreateOrganization'
import ManageOrganization from '../components/teams/ManageOrganization'
import { Organizations } from '../../api/common/models'
import CONSTANTS from '../../api/common/constants'
import { registrationDetails } from '../jotai/atoms'

export default function Team() {
  const setRegistrationDetails = useSetAtom(registrationDetails)
  const org = useTracker(() => Organizations.findOne())
  const user = useTracker(() => Meteor.user())
  // the account's team field comes with users.me (the same subscription InitSubscriptions holds)
  const meReady = useTracker(() => Boolean(Meteor.userId()) && Meteor.subscribe(CONSTANTS.publications.users.me).ready())
  const orgNameType = user?.isEducationCertified ? 'Classroom' : 'Team'
  const lower = orgNameType.toLowerCase()

  const page = (children) => (
    <Box data-team-route="" sx={{ maxWidth: 1040, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>{children}</Box>
  )

  if (org) return page(<ManageOrganization />)
  // in a team whose details have not arrived yet: wait, never flash "Create your team"
  if (!meReady || user?.orgId) {
    return page(<Box role="status" aria-label="Loading your team" sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress size={28} /></Box>)
  }

  const blocked = user && (user.isAnonymous || !user.emails?.[0]?.verified)
  const registerOrVerify = () => setRegistrationDetails({
    type: 'registration',
    registrationOpen: true,
    registrationMessage: user?.isAnonymous
      ? `Save your work before creating a ${lower}.`
      : `Before you can create a ${lower}, you must verify your email`,
  })

  return page(
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box component="header">
        <Typography variant="h4" component="h1" sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 } }}>Create your {lower}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Work on slates together, share them with everyone on the {lower}, and manage who can do what.
        </Typography>
      </Box>
      {blocked ? (
        <Box sx={(theme) => ({ bgcolor: 'shell.surface', border: '1px solid', borderColor: 'shell.border', borderRadius: '14px', p: 2,
          ...theme.applyStyles('dark', { bgcolor: 'background.paper' }) })}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>Save your work and verify your email before making a {lower}.</Typography>
          <Button variant="contained" onClick={registerOrVerify}>{user?.isAnonymous ? 'Save my Slatebox' : 'Verify email'}</Button>
        </Box>
      ) : (
        <CreateOrganization privateBetaAccess />
      )}
    </Box>
  )
}
