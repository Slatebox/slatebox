/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-underscore-dangle */
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import Container from '@mui/material/Container'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@mui/material/Grid2'
import Button from '@mui/material/Button'
import { Alert } from '@mui/material'
import Typography from '@mui/material/Typography'
import CreateOrganization from '../components/teams/CreateOrganization'
import ManageOrganization from '../components/teams/ManageOrganization'
import BusinessPanel from '../components/teams/BusinessPanel'
import AuthManager from '../../api/common/AuthManager'
import CONSTANTS from '../../api/common/constants'
import { Organizations } from '../../api/common/models'
import { registrationDetails } from '../jotai/atoms'

export default function Team() {
  // const [org, setOrg] = useState(null)
  const setRegistrationDetails = useSetAtom(registrationDetails)

  const org = useTracker(() => Organizations.findOne())

  // const [privateBetaAccess, setPrivateBetaAccess] = React.useState(false)
  const privateBetaAccess = true

  // console.log('org is now', org, Meteor.user()?.orgId)

  const orgNameType = Meteor.user()?.isEducationCertified ? 'Classroom' : 'Team'
  const orgPeopleType = Meteor.user()?.isEducationCertified
    ? 'students'
    : 'members'

  // useEffect(() => {
  //   async function allowedInPrivateBeta() {
  //     const allowed = await Meteor.callAsync(
  //       CONSTANTS.methods.users.allowedInPrivateBeta
  //     )
  //     setPrivateBetaAccess(allowed)
  //   }
  //   allowedInPrivateBeta()
  // }, [])

  const [verb, setVerb] = useState('View')
  const [abilities, setAbilities] = useState([])
  const uid = Meteor.userId()

  useEffect(() => {
    async function checkPermissions() {
      const canManage = await AuthManager.userHasClaim(uid, [
        CONSTANTS.claims.canEditUsers._id,
        CONSTANTS.claims.canAddUsers._id,
      ])
      setVerb(canManage ? 'Manage' : 'View')

      let newAbilities = []
      if (await AuthManager.userHasClaim(uid, CONSTANTS.claims.admin._id)) {
        newAbilities = newAbilities.concat([
          'add new ones',
          'edit their info and change their roles',
          'remove them',
        ])
      } else {
        if (
          await AuthManager.userHasClaim(uid, CONSTANTS.claims.canAddUsers._id)
        ) {
          newAbilities.push('add new ones')
        }
        if (
          await AuthManager.userHasClaim(uid, CONSTANTS.claims.canEditUsers._id)
        ) {
          newAbilities.push('edit their info and change their roles')
        }
        if (
          await AuthManager.userHasClaim(
            uid,
            CONSTANTS.claims.canRemoveUsers._id
          )
        ) {
          newAbilities.push('remove them')
        }
      }
      setAbilities(newAbilities)
    }

    checkPermissions()
  }, [uid])

  if (!org) {
    // nothing
  } else if (abilities.length === 0) {
    abilities.push(
      `${verb} existing ${orgNameType.toLowerCase()} ${orgPeopleType} below.`
    )
  } else {
    abilities.unshift(
      `${verb} existing ${orgNameType.toLowerCase()} ${orgPeopleType}`
    )
    if (!abilities.includes(' -- all below.')) {
      abilities.push(' -- all below.')
    }
  }

  const handleRegisterOrVerify = async function () {
    setRegistrationDetails({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: Meteor.user()?.isAnonymous
        ? `Save your work before creating a ${orgNameType.toLowerCase()}.`
        : `Before you can create a ${orgNameType.toLowerCase()}, you must verify your email`,
    })
  }

  const handleRegisterOrVerifyClick = () => handleRegisterOrVerify()

  return (
    <Container component="main" maxWidth="lg">
      <Grid container spacing={4} alignItems="center" justifyContent="flex-end">
        <Grid size={12} />

        {!org &&
        Meteor.user() &&
        (Meteor.user()?.isAnonymous ||
          !Meteor.user()?.emails?.[0]?.verified) ? (
          <>
            <Grid size={12}>
              <Alert severity="info">
                Save your work and verify your email before making a{' '}
                {orgNameType.toLowerCase()}!
              </Alert>
            </Grid>
            <Grid size={12}>
              <Button variant="contained" onClick={handleRegisterOrVerifyClick}>
                {Meteor.user()?.isAnonymous ? (
                  <>Save My Slatebox</>
                ) : (
                  <>Verify Email</>
                )}
              </Button>
            </Grid>
          </>
        ) : (
          <>
            <Grid size={12}>
              <Typography variant="h5" color="secondary">
                {privateBetaAccess && (
                  <>
                    {!org ? (
                      <>Create your {orgNameType.toLowerCase()} below</>
                    ) : (
                      <>
                        {verb} your {orgNameType.toLowerCase()} - Below are the{' '}
                        {org.name} {orgPeopleType}:
                      </>
                    )}
                  </>
                )}
              </Typography>
              <Typography variant="subtitle1" color="textPrimary">
                {abilities.slice(0, abilities.length - 1).join(', ')}{' '}
                {abilities
                  .slice(abilities.length - 1, abilities.length)
                  .join('')}
              </Typography>
            </Grid>
            {org && (
              <Grid size={12}>
                <BusinessPanel />
              </Grid>
            )}
            <Grid size={12}>
              {!org ? (
                <CreateOrganization privateBetaAccess />
              ) : (
                <ManageOrganization privateBetaAccess />
              )}
            </Grid>
          </>
        )}
      </Grid>
    </Container>
  )
}
