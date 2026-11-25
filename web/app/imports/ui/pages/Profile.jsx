import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { Accounts } from 'meteor/accounts-base'
import { useSetAtom } from 'jotai'
import { useTheme } from '@mui/material'
import InputAdornment from '@mui/material/InputAdornment'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Tab from '@mui/material/Tab'
import { useTranslator } from '../common/i18n'
import confirmService from '../common/confirm'
import CONSTANTS from '../../api/common/constants'
import TabPanel from '../common/TabPanel'
import AppPage from '../common/AppPage'
import { AccountActions, AccountPanel, AccountSection, AccountTabs, FinePrint, SPACE, dangerZone } from '../common/AccountLayout'
import Credits from '../components/billing/Credits'
import { registrationDetails, globalMessage } from '../jotai/atoms'
import AuthManager from '../../api/common/AuthManager'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import DeveloperAccess from '../components/profile/DeveloperAccess'
import AISettings from '../components/profile/AISettings'
import { enterpriseState } from '../../api/common/edition.mjs'
import { adminLinksFor } from '../../api/common/server-admin.mjs'
import useServerAdmin from '../common/useServerAdmin'
import Box from '@mui/material/Box'
import Link from '@mui/material/Link'

const BASE_DAILY_URL = Meteor.settings.public.dailyBaseUrl
// /profile?tab=developer opens the Developer tab (the instance description links there);
// /profile?tab=credits opens Credits (Slatebox Pro, balance, own keys) on a server with a meter;
// tab=free is where links from before Pro point, so it opens Credits too.
const metered = Meteor.settings.public.metered === true
const TABS = { profile: 1, developer: 4, ai: 'ai', ...(metered ? { credits: 'credits', free: 'credits' } : {}) }

export default function Profile() {
  const theme = useTheme()
  const setMessage = useSetAtom(globalMessage)
  const setRegistrationDetails = useSetAtom(registrationDetails)
  const t = useTranslator()
  // Server admin links, for an administrator of this server only (the server checks again on each page)
  const adminLinks = adminLinksFor(useServerAdmin())
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword1, setNewPassword1] = React.useState('')
  const [newPassword2, setNewPassword2] = React.useState('')
  const [email, setEmail] = React.useState(
    Meteor.user()?.emails?.[0]?.address ?? ''
  )
  const videoElement = useRef()

  const [searchParams, setSearchParams] = useSearchParams()
  const [tabValue, setTabValue] = React.useState(TABS[searchParams.get('tab')] ?? TABS.profile)
  // The account menu's "Credits" can be chosen while the profile is already open.
  useEffect(() => {
    const asked = TABS[searchParams.get('tab')]
    if (asked !== undefined) setTabValue(asked)
  }, [searchParams])
  const [balanceCents, setBalanceCents] = React.useState(0)
  const [refundableCents, setRefundableCents] = React.useState(0)
  useEffect(() => {
    if (!metered) return
    Meteor.callAsync(CONSTANTS.methods.meter.summary).then(summary => {
      setBalanceCents(summary?.balanceCents || 0)
      setRefundableCents(summary?.refundableCents || 0)
    }).catch(() => {})
  }, [])
  const changeTab = async (event, newValue) => {
    setTabValue(newValue)
    if (searchParams.get('tab') && TABS[searchParams.get('tab')] !== newValue) setSearchParams({}, { replace: true })
  }

  // hack
  if (!window.profilePageLoaded) {
    window.profilePageLoaded = true
    const checkForUser = window.setInterval(() => {
      if (Meteor.user()) {
        window.clearInterval(checkForUser)
        if (!Meteor.user().isAnonymous) {
          const getEmail = Meteor.user()?.emails[0]?.address
          setEmail(getEmail)
        } else {
          openRegistration()
        }
      }
    }, 500)
  }

  const openRegistration = () => {
    setRegistrationDetails({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: `Save your work to access your profile on any device.`,
    })
  }

  const handleNewEmail = async () => {
    if (email.indexOf('@') > -1) {
      if (email === Meteor.user().emails[0].address) {
        setMessage({
          visible: true,
          text: `Your email didn't change! It's still ${email}.`,
          severity: 'error',
          autoHide: 60000,
        })
        return
      }
      const result = await confirmService.show({
        theme,
        title: `Confirm Email Change`,
        message: `You are changing your email to <strong>${email}</strong>. Your new address will need verification.`,
        actionItems: [
          { label: 'Change email', return: true },
          { label: 'Cancel', return: false },
        ],
      })
      if (result) {
        const sent = await Meteor.callAsync(CONSTANTS.methods.users.changeEmail, {
          email,
        })
        setMessage({
          visible: true,
          text: sent === true ? `Email sent to ${email}. Please verify.` : 'Your email address was updated. Ask your administrator to configure email delivery for verification.',
          severity: 'info',
          autoHide: 60000,
        })
      }
    } else {
      setMessage({
        visible: true,
        text: `Your email doesn't look right: (${email})`,
        severity: 'error',
        autoHide: 60000,
      })
    }
  }

  const handlePasswordChange = () => {
    if (newPassword1 !== newPassword2) {
      setMessage({
        visible: true,
        text: `Your passwords do not match!`,
        severity: 'error',
        autoHide: 60000,
      })
      return
    }
    Accounts.changePassword(currentPassword, newPassword1, (err) => {
      if (err) {
        console.error(err)
        setMessage({
          visible: true,
          text: `Sorry, there was a problem changing your password: ${err.message}`,
          severity: 'error',
          autoHide: 60000,
        })
      } else {
        setMessage({
          visible: true,
          text: `Your password has been changed!`,
          severity: 'info',
          autoHide: 60000,
        })
        setCurrentPassword('')
        setNewPassword1('')
        setNewPassword2('')
      }
    })
  }

  const handleCertifyForEducation = async () => {
    if (!Meteor.user().requestingEducationCertification) {
      await Meteor.callAsync(
        CONSTANTS.methods.users.requestEducationCertification
      )
    } else {
      setMessage({
        visible: true,
        text: `You have already requested certification.`,
        severity: 'error',
        autoHide: 60000,
      })
    }
  }

  const handleAccountDeletion = async () => {
    if (!Meteor.user().orgId) {
      const deleteTitle = `Confirm Account Removal`
      const buttonLabel = `Yes, remove my account and delete all my slates.`
      let deleteMessage = `Are you sure you want to remove your account and all your attached slates? This CANNOT be undone. Confirming below will remove your account and all your slates and log you out.`
      if (balanceCents > 0) {
        // what has a card charge to go back to is refunded; anything else closes with the account
        const back = Math.min(refundableCents, balanceCents)
        const closed = balanceCents - back
        if (back) deleteMessage += ` Removing your account refunds $${(back / 100).toFixed(2)} of your balance to your card.`
        if (closed > 0) deleteMessage += ` The other $${(closed / 100).toFixed(2)} cannot go back to a card, so it closes with your account.`
      }
      const actionItems = [
        { label: buttonLabel, return: true },
        { label: 'Cancel', return: false },
      ]
      // single user -- organzation removals are handled on TeamSettings
      const res = await confirmService.show({
        theme,
        title: deleteTitle,
        message: deleteMessage,
        actionItems,
      })
      if (res) {
        try {
          const removed = await Meteor.callAsync(CONSTANTS.methods.users.delete)
          if (!removed) throw new Error('Account removal was not completed.')
          window.location.replace('/login')
        } catch (error) {
          setMessage({
            visible: true,
            severity: 'error',
            text: error.reason || 'Could not remove your account. Please try again.',
          })
        }
      }
    }
  }

  const user = Meteor.user()
  if (user?.isAnonymous) {
    return (
      <AppPage title="Save your work to access your profile on any device.">
        <AccountActions>
          <Button
            color="primary"
            size="large"
            variant="contained"
            onClick={openRegistration}
          >
            Save My Slatebox
          </Button>
          <Button
            onClick={handleAccountDeletion}
            variant="outlined"
            color="error"
          >
            Delete Account
          </Button>
        </AccountActions>
      </AppPage>
    )
  }

  // one column, three fields wide enough to read and no wider
  const field = { maxWidth: 480 }
  return (
    <AppPage title={user ? t('profile.header') : null}>
      {user && (
        <>
          <AccountTabs value={tabValue} onChange={changeTab}>
            <Tab label="Profile" value={1} />
            {metered && <Tab label="Credits" value="credits" />}
            <Tab label="AI" value="ai" />
            <Tab label="Developer" value={4} />
          </AccountTabs>
          <TabPanel value={tabValue} index={1}>
            <AccountPanel>
              <AccountSection title="Change Email">
                <TextField
                  autoComplete="email"
                  type="email"
                  name="email"
                  variant="outlined"
                  required
                  color="secondary"
                  fullWidth
                  id="email"
                  label="Email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                  }}
                  error={email?.indexOf('@') === -1}
                  autoFocus
                  sx={{ ...field, mt: SPACE.tight }}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <Button
                            color="secondary"
                            variant="outlined"
                            size="small"
                            onClick={handleNewEmail}
                          >
                            Update
                          </Button>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <FinePrint>{t('profile.reVerificationNote')}</FinePrint>
              </AccountSection>

              <AccountSection title="Change Password">
                <Tooltip
                  title="Please enter your current password"
                  placement="top"
                >
                  <TextField
                    variant="outlined"
                    required
                    fullWidth
                    color="secondary"
                    name="currentPassword"
                    label="Current Password"
                    type="password"
                    id="currentPassword"
                    autoComplete="currentPassword"
                    onChange={(e) => {
                      setCurrentPassword(e.target.value)
                    }}
                    value={currentPassword}
                    sx={{ ...field, mt: SPACE.tight }}
                  />
                </Tooltip>
                <Tooltip
                  title="At least 8 characters long"
                  placement="top"
                >
                  <TextField
                    variant="outlined"
                    required
                    fullWidth
                    color="secondary"
                    name="password"
                    label="New Password"
                    type="password"
                    id="newPassword1"
                    autoComplete="new-password-1"
                    onChange={(e) => {
                      setNewPassword1(e.target.value)
                    }}
                    value={newPassword1}
                    error={newPassword1 !== newPassword2}
                    sx={field}
                  />
                </Tooltip>
                <Tooltip
                  title="Type the same password again, at least 8 characters long"
                  placement="top"
                >
                  <TextField
                    variant="outlined"
                    required
                    fullWidth
                    color="secondary"
                    name="password"
                    label="New Password Again"
                    type="password"
                    id="newPassword2"
                    autoComplete="new-password-2"
                    onChange={(e) => {
                      setNewPassword2(e.target.value)
                    }}
                    value={newPassword2}
                    error={newPassword2 !== newPassword1}
                    sx={field}
                  />
                </Tooltip>
                <AccountActions>
                  <Button
                    color="secondary"
                    variant="contained"
                    onClick={handlePasswordChange}
                  >
                    Change Password &rarr;
                  </Button>
                </AccountActions>
              </AccountSection>

              {user && !user.isEducationCertified ? (
                <AccountSection title="Education Certification">
                  <Typography>
                    {user.requestingEducationCertification ? (
                      <>
                        {t('profile.alreadyRequestedEducationCertification')}
                      </>
                    ) : (
                      <>{t('profile.requestEducationCertification')}</>
                    )}
                  </Typography>
                  {!user.requestingEducationCertification && (
                    <AccountActions>
                      <Button
                        onClick={handleCertifyForEducation}
                        variant="outlined"
                        color="secondary"
                      >
                        Request Education Certification &rarr;
                      </Button>
                    </AccountActions>
                  )}
                </AccountSection>
              ) : (
                <AccountSection title="Education Certification">
                  <Typography>
                    {user.requestingEducationCertification ? (
                      <>{t('profile.alreadyRequestedEducationCertified')}</>
                    ) : (
                      <>{t('profile.alreadyEducationCertified')}</>
                    )}
                  </Typography>
                </AccountSection>
              )}

              {user && !user?.orgId ? (
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
                        Delete My Account &rarr;
                      </Button>
                    }
                  >
                    <AlertTitle>Danger Zone</AlertTitle>
                    <Typography>
                      <b>Warning:</b> This action cannot be undone. Once you
                      delete your account, it cannot be recovered.
                    </Typography>
                  </Alert>
                </AccountSection>
              ) : (
                <AccountSection>
                  <FinePrint>
                    Would you like to remove your account?
                    {AuthManager.userHasClaim(Meteor.userId(), [
                      CONSTANTS.claims.admin._id,
                    ]) ? (
                      <>
                        &nbsp;As your organization's admin, you must first
                        remove all of the members on the team page.
                      </>
                    ) : (
                      <>
                        &nbsp;Please let the org admin you'd like to remove
                        your account.
                      </>
                    )}
                  </FinePrint>
                </AccountSection>
              )}
              {enterpriseState(Meteor.settings).unlocked && (
                <AccountSection title="Integrations">
                  <Typography variant="body2" sx={{ mb: 1 }}>Connect outside agents and Google once, then invite them onto any slate.</Typography>
                  <Button component={RouterLink} to="/integrations" variant="outlined" data-profile-integrations="">Manage integrations</Button>
                </AccountSection>
              )}
              {adminLinks.length > 0 && (
                <AccountSection title="Server admin" data-profile-server-admin="">
                  <Typography variant="body2" sx={{ mb: 1 }}>You administer this Slatebox server.</Typography>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}>
                    {adminLinks.map((section) => (
                      <li key={section.id}>
                        <Link component={RouterLink} to={section.to} underline="hover" sx={{ fontWeight: 650 }} data-profile-admin-link={section.id}>{section.title}</Link>
                        <Typography variant="body2" color="text.secondary" component="span">{` — ${section.detail}`}</Typography>
                      </li>
                    ))}
                  </Box>
                </AccountSection>
              )}
            </AccountPanel>
          </TabPanel>
          <TabPanel value={tabValue} index={4}>
            <DeveloperAccess />
          </TabPanel>
          <TabPanel value={tabValue} index="ai">
            <AISettings />
          </TabPanel>
          {metered && (
            <TabPanel value={tabValue} index="credits">
              <Credits />
            </TabPanel>
          )}
        </>
      )}
    </AppPage>
  )
}
