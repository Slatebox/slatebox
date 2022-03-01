/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Translation from '../common/Translation'
import Container from '@material-ui/core/Container'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button'
import Box from '@material-ui/core/Box'
import Typography from '@material-ui/core/Typography'
import { useTheme } from '@material-ui/core'
import InputAdornment from '@material-ui/core/InputAdornment'
import TextField from '@material-ui/core/TextField'
import Divider from '@material-ui/core/Divider'

import CONSTANTS from '../../api/common/constants'
import { Organizations } from '../../api/common/models'
import GuestViewReport from '../components/teams/GuestViewReport'
import promisify from '../../api/client/promisify'
import confirmService from '../common/confirm'

export default function TeamSettings() {
  const theme = useTheme()
  const noSpecialChars = /^[_A-z0-9]*((-|\s| )*[_A-z0-9])*$/g

  const [orgName, setOrgName] = React.useState('')

  useTracker(() => {
    setOrgName(Organizations.findOne()?.name)
  }, [Organizations.findOne()?.name])

  const updateOrgName = async () => {
    Organizations.update(
      { _id: Organizations.findOne()._id },
      { $set: { name: orgName } }
    )
  }

  const handleAccountDeletion = async () => {
    const implications = await promisify(
      Meteor.call,
      CONSTANTS.methods.organizations.getCancellationImplications
    )
    if (!Meteor.user().isOrgOwner) {
      await confirmService.show({
        theme,
        title: `Unable To Delete`,
        message: `Sorry, only the original team creator of ${
          Organizations.findOne().name
        } can remove your account. The owner is ${
          implications.orgOwner.name
        } (${implications.orgOwner.email})`,
        actionItems: [{ label: 'OK', return: true }],
      })
      return
    }
    // if this is a paid plan, get the end date of the subscription.
    if (implications.otherUsers > 0 || implications.otherSlates > 0) {
      await confirmService.show({
        theme,
        title: `Unable To Delete`,
        message: `Your team still has ${implications.otherUsers} member(s) with ${implications.otherSlates} slate(s) that require explicit deleting. Go to the mange teams page to explicitly remove them prior to deleting your account here.`,
        actionItems: [{ label: 'OK', return: true }],
      })
    } else {
      const res = await confirmService.show({
        theme,
        title: `Confirm the permanent removal of the ${
          Organizations.findOne().name
        } team.`,
        message: `<p>There are no attached team members or slates other than your own. You can PERMANENTLY DELETE your team and all your slates by confirming below, which will also remove any future billing.</p><p>This action CANNOT be undone, and you'll be logged out afterwards.</p>`,
        actionItems: [
          {
            label: `Yes, completely delete ${orgName} and my account.`,
            return: true,
          },
          { label: `Cancel`, return: false },
        ],
      })
      if (res) {
        setTimeout(() => {
          window.location.href = '/'
        }, 250)
        await promisify(Meteor.call, CONSTANTS.methods.organizations.delete)
      }
    }
  }

  return (
    <Container maxWidth="lg">
      <Grid container alignItems="flex-start" justify="center" spacing={10}>
        <Grid item xs={12}>
          <Typography component="h1" variant="h5" style={{ color: '#fff' }}>
            <Box p={3}>
              <Translation>teamSettings.header</Translation>
            </Box>
          </Typography>
        </Grid>
        <Grid item xs={6}>
          <Box mb={2}>
            <Typography variant="h5" color="secondary">
              Change Org Name
            </Typography>
          </Box>
          <TextField
            autoComplete="orgName"
            type="orgName"
            name="orgName"
            variant="outlined"
            required
            fullWidth
            id="orgName"
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value)
            }}
            error={!orgName?.match(noSpecialChars) && !orgName?.endsWith(' ')}
            autoFocus
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Button
                    color="secondary"
                    variant="outlined"
                    onClick={updateOrgName}
                    disabled={
                      !orgName?.match(noSpecialChars) && !orgName?.endsWith(' ')
                    }
                  >
                    Update
                  </Button>
                </InputAdornment>
              ),
            }}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
        </Grid>
        <Grid item xs={6}>
          <GuestViewReport />
        </Grid>
        {((Meteor.user() && !Meteor.user().orgId) ||
          (orgName &&
            Meteor.user() &&
            Meteor.user().orgId &&
            Meteor.user().isOrgOwner)) && (
          <Grid item xs={12}>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <Divider
                  style={{ border: `1px solid ${theme.palette.error.main}` }}
                />
                <Box p={3}>
                  <Typography
                    variant="h5"
                    style={{ color: theme.palette.error.main }}
                  >
                    Danger Zone
                  </Typography>
                </Box>
              </Grid>
              <Box p={3}>
                <Button
                  onClick={handleAccountDeletion}
                  variant="outlined"
                  style={{ border: `1px solid ${theme.palette.error.main}` }}
                >
                  {Meteor.user()?.isOrgOwner
                    ? `Delete the ${Organizations.findOne()?.name} team`
                    : 'Delete My Account'}
                </Button>
              </Box>
            </Grid>
          </Grid>
        )}
      </Grid>
    </Container>
  )
}
