/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Container from '@material-ui/core/Container'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button'
import Box from '@material-ui/core/Box'
import Typography from '@material-ui/core/Typography'
import { useHistory } from 'react-router-dom'
import { Organizations } from '../../api/common/models'
import CreateOrganization from '../components/teams/CreateOrganization'
import ManageOrganization from '../components/teams/ManageOrganization'
import AuthManager from '../../api/common/AuthManager'
import CONSTANTS from '../../api/common/constants'

export default function Team() {
  let org = null
  const history = useHistory()
  useTracker(() => {
    if (Meteor.user() && Meteor.user().orgId) {
      org = Organizations.findOne({ _id: Meteor.user().orgId })
    }
  })

  const uid = Meteor.userId()
  const verb = AuthManager.userHasClaim(uid, [
    CONSTANTS.claims.canEditUsers._id,
    CONSTANTS.claims.canAddUsers._id,
  ])
    ? 'Manage'
    : 'View'
  let abilities = []
  if (AuthManager.userHasClaim(uid, CONSTANTS.claims.admin._id)) {
    abilities = abilities.concat([
      'add new ones',
      'edit their info and change their roles',
      'remove them',
    ])
  } else {
    if (AuthManager.userHasClaim(uid, CONSTANTS.claims.canAddUsers._id)) {
      abilities.push('add new ones')
    }
    if (AuthManager.userHasClaim(uid, CONSTANTS.claims.canEditUsers._id)) {
      abilities.push('edit their info and change their roles')
    }
    if (AuthManager.userHasClaim(uid, CONSTANTS.claims.canRemoveUsers._id)) {
      abilities.push('remove them')
    }
  }
  if (!org) {
    // nothing
  } else if (abilities.length === 0) {
    abilities.push(`${verb} existing team members below.`)
  } else {
    abilities.unshift(`${verb} existing team members`)
    abilities.push(' -- all below.')
  }

  const createTeam = () => {
    history.push('/team')
  }

  return (
    <Container component="main" maxWidth="lg">
      <Grid container spacing={4} alignItems="center" justify="flex-end">
        <Grid item xs={12} />
        <Grid item xs={12}>
          {!org &&
          Meteor.user() &&
          (Meteor.user().isAnonymous || !Meteor.user().emails[0].verified) ? (
            <>
              <Typography variant="h5" color="secondary">
                You don&apos;t have a team yet. Create one now!
              </Typography>
              <Box m={3}>
                <Button size="large" variant="outlined" onClick={createTeam}>
                  Create your team!
                </Button>
              </Box>
            </>
          ) : (
            <>
              <Typography variant="h5" color="secondary">
                {!org ? (
                  <>Create your team below</>
                ) : (
                  <>
                    {verb} your team - Below are the {org.name} member(s):
                  </>
                )}
              </Typography>
              <Typography variant="subtitle1" color="textPrimary">
                {abilities.slice(0, abilities.length - 1).join(', ')}{' '}
                {abilities
                  .slice(abilities.length - 1, abilities.length)
                  .join('')}
              </Typography>
            </>
          )}
        </Grid>
        <Grid item xs={12}>
          {!org ? <CreateOrganization /> : <ManageOrganization />}
        </Grid>
      </Grid>
    </Container>
  )
}
