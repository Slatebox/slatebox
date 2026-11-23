/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Tab from '@mui/material/Tab'
import { useTranslator } from '../common/i18n'
import CONSTANTS from '../../api/common/constants'
import { ownKeysAllowed } from '../../api/common/own-keys.mjs'
import { Organizations } from '../../api/common/models'
import TeamBalance from '../components/billing/TeamBalance'
import { AccountPage, AccountPanel, AccountSection, AccountTabs, SPACE, dangerZone } from '../common/AccountLayout'
import confirmService from '../common/confirm'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import AuthManager from '../../api/common/AuthManager'
import ExportEverything from '../components/teams/ExportEverything'

export default function TeamSettings() {
  const theme = useTheme()
  const noSpecialChars = /^[_A-z0-9]*((-|\s| )*[_A-z0-9])*$/g
  const t = useTranslator()
  const [orgName, setOrgName] = React.useState('')
  const [activeTab, setActiveTab] = React.useState('general')
  const [isTeamAdmin, setIsTeamAdmin] = React.useState(false)
  const userId = useTracker(() => Meteor.userId())
  const inTeam = useTracker(() => Boolean(Meteor.user()?.orgId))

  React.useEffect(() => {
    let live = true
    if (userId && inTeam)
      AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]).then((yes) => live && setIsTeamAdmin(Boolean(yes)))
    return () => {
      live = false
    }
  }, [userId, inTeam])

  useTracker(() => {
    setOrgName(Organizations.findOne()?.name)
  }, [Organizations.findOne()?.name])

  const updateOrgName = async () => {
    await Organizations.updateAsync(
      { _id: await Organizations.findOneAsync()._id },
      { $set: { name: orgName } }
    )
  }

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue)
  }

  const isEducationCertified = useTracker(
    () => Meteor.user()?.isEducationCertified
  )
  const orgTypeName = isEducationCertified ? 'classroom' : 'team'

  const handleAccountDeletion = async () => {
    const implications = await Meteor.callAsync(
      CONSTANTS.methods.organizations.getCancellationImplications
    )
    if (!Meteor.user().isOrgOwner) {
      await confirmService.show({
        theme,
        title: `Unable To Delete`,
        message: `Sorry, only the original ${orgTypeName} creator of ${
          Organizations.findOne().name
        } can remove your account. The owner is ${
          implications.orgOwner.name
        } (${implications.orgOwner.email})`,
        actionItems: [{ label: 'OK', return: true }],
      })
      return
    }
    if (implications.otherUsers > 0 || implications.otherSlates > 0) {
      await confirmService.show({
        theme,
        title: `Unable To Delete`,
        message: `Your ${orgTypeName} still has ${implications.otherUsers} member(s) with ${implications.otherSlates} slate(s) that require explicit deleting. Go to the mange ${orgTypeName} page to explicitly remove them prior to deleting your account here.`,
        actionItems: [{ label: 'OK', return: true }],
      })
    } else {
      const res = await confirmService.show({
        theme,
        title: `Confirm the permanent removal of the ${
          Organizations.findOne().name
        } team.`,
        message: `<p>There are no attached ${orgTypeName} members or slates other than your own. You can PERMANENTLY DELETE your ${orgTypeName} and all your slates by confirming below${
          orgTypeName === 'team'
            ? `, which also refunds any team balance to the card it was paid with.`
            : '.'
        }</p><p>This action CANNOT be undone, and you'll be logged out afterwards.</p>`,
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
        await Meteor.callAsync(CONSTANTS.methods.organizations.delete)
      }
    }
  }

  // Determine if danger zone should be shown
  const showDangerZone =
    (Meteor.user() && !Meteor.user().orgId) ||
    (orgName &&
      Meteor.user() &&
      Meteor.user().orgId &&
      Meteor.user().isOrgOwner)

  const renderGeneral = () => {
    const isValid =
      !orgName || (orgName?.match(noSpecialChars) && !orgName?.endsWith(' '))
    return (
      <AccountPanel>
        <AccountSection title={`Change ${orgTypeName} name`}>
          <TextField
            autoComplete="orgName"
            type="orgName"
            name="orgName"
            variant="outlined"
            color="secondary"
            required
            fullWidth
            id="orgName"
            value={orgName}
            onChange={(e) => {
              setOrgName(e.target.value)
            }}
            error={!isValid}
            helperText={
              !isValid &&
              'Name cannot contain special characters and must not end with a space'
            }
            autoFocus
            sx={{ maxWidth: 480, mt: SPACE.tight }}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <Button
                    color="secondary"
                    variant="outlined"
                    size="small"
                    onClick={updateOrgName}
                    disabled={!isValid}
                  >
                    Update
                  </Button>
                </InputAdornment>
              ),
            }}
          />
        </AccountSection>
        {showDangerZone && (
          <AccountSection>
            <Alert
              severity="error"
              variant="outlined"
              sx={dangerZone}
              action={
                <Button
                  color="error"
                  variant="contained"
                  onClick={handleAccountDeletion}
                >
                  {Meteor.user()?.isOrgOwner
                    ? `Delete the ${
                        Organizations.findOne()?.name
                      } ${orgTypeName}`
                    : 'Delete My Account'}
                </Button>
              }
            >
              <AlertTitle>Danger Zone</AlertTitle>
              <Typography>
                <b>Warning:</b> This action cannot be undone. Once you delete
                your account, it cannot be recovered.
              </Typography>
            </Alert>
          </AccountSection>
        )}
      </AccountPanel>
    )
  }
  return (
    <AccountPage
      title={
        isEducationCertified ? (
          <>{t('teamSettings.educationHeader')}</>
        ) : (
          <>{t('teamSettings.header')}</>
        )
      }
    >
      <AccountTabs value={activeTab} onChange={handleTabChange}>
        <Tab label="General" value="general" />
        {Meteor.settings.public.metered && <Tab label={ownKeysAllowed(Meteor.settings) ? 'Team balance and keys' : 'Team balance'} value="balance" />}
        {isTeamAdmin && <Tab label="Export everything" value="export" data-testid="tab-export" />}
      </AccountTabs>
      {activeTab === 'general' && renderGeneral()}
      {activeTab === 'balance' && <TeamBalance />}
      {activeTab === 'export' && isTeamAdmin && <ExportEverything />}
    </AccountPage>
  )
}
