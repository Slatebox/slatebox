/* eslint-disable no-underscore-dangle */
import React, { useEffect, useId, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtom } from 'jotai'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Typography from '@mui/material/Typography'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import HttpsIcon from '@mui/icons-material/Https'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PublicIcon from '@mui/icons-material/Public'
import Button from '@mui/material/Button'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import TableContainer from '@mui/material/TableContainer'
import Table from '@mui/material/Table'
import TableRow from '@mui/material/TableRow'
import TableCell from '@mui/material/TableCell'
import { Link as RouterLink } from 'react-router-dom'
import TableBody from '@mui/material/TableBody'
import Paper from '@mui/material/Paper'
import RadioGroup from '@mui/material/RadioGroup'
import Radio from '@mui/material/Radio'
import FormControlLabel from '@mui/material/FormControlLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import NavigateNext from '@mui/icons-material/NavigateNext'
import Box from '@mui/material/Box'
import CONSTANTS from '../../../api/common/constants'
import { Permissions, SlateAccess, Slates } from '../../../api/common/models'
import slateProps from '../../propTypes/slateProps'
import PublishStatus from '../library/PublishStatus'

import {
  isShareDialogOpen,
  slatePrivacy,
} from '../../jotai/atoms'

function LinkSettings({ type, active, grant, currentPermission, busy, configure }) {
  const [choice, setChoice] = useState(null)
  const [copyState, setCopyState] = useState('')
  const urlField = React.useRef(null)
  const permission = choice ?? currentPermission
  const url = active && grant?.type === type && grant.accessKey
    ? new URL('/canvas/' + grant.accessKey, window.location.origin).href : ''
  const committed = Boolean(url) && permission === currentPermission
  useEffect(() => { setCopyState('') }, [url, permission])
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('Link copied.')
    } catch {
      urlField.current?.focus()
      urlField.current?.select()
      setCopyState('Select and copy the invitation link.')
    }
  }
  return <Box sx={{ display: 'grid', gap: 1.5, justifyItems: 'start' }}>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      Link permission{' '}
      <Select size="small" disabled={busy} value={permission} inputProps={{ 'aria-label': 'Link permission' }}
        onChange={event => setChoice(event.target.value)}>
        {Object.values(CONSTANTS.slateAccessPermissions).filter(item => item.id !== 'NONE').map(item =>
          <MenuItem key={item.id} value={item.id}>{item.description}</MenuItem>)}
      </Select>
    </Box>
    {committed ? <>
      <Box component="input" ref={urlField} aria-label="Invitation link" readOnly value={url}
        sx={{ width: '100%', boxSizing: 'border-box', color: 'text.primary', bgcolor: 'background.paper',
          border: 1, borderColor: 'divider', borderRadius: 1, font: 'inherit', p: 1 }} />
      <Button variant="contained" disabled={busy} onClick={copyLink}>Copy link</Button>
      {copyState && <Typography role="status">{copyState}</Typography>}
    </> : <Button variant="contained" disabled={busy} onClick={async () => {
      if (await configure(type, permission)) setChoice(null)
    }}>{active && url ? 'Apply access' : !active && type === 'public' ? 'Make public' : 'Create link'}</Button>}
  </Box>
}

export default function SlateSharing({ slate }) {
  const panelId = useId()
  // The slate as stored (published to its owner only): its visibility, and what the library publishes.
  const ownSlate = useTracker(() => Slates.findOne({ _id: slate?.options?.id }) || null)
  const visibility = useTracker(() => {
    if (!Meteor.subscribe(CONSTANTS.publications.shareableSlate, slate?.options?.id).ready()) return null
    const s = Slates.findOne({ _id: slate?.options?.id })
    if (!s) return null
    if (s?.options?.isUnlisted) {
      return 'unlisted'
    }
    if (s?.options?.isPrivate) {
      return 'private'
    }
    return 'public'
  })
  const [openShareDialog, setOpenShareDialog] = useAtom(isShareDialogOpen)
  const [, setSlatePrivacy] = useAtom(slatePrivacy)
  const slateId = slate?.options?.id
  const [recipients, setRecipients] = useState(null)
  const [recipientError, setRecipientError] = useState(false)
  useEffect(() => {
    let current = true
    setRecipients(null)
    setRecipientError(false)
    if (openShareDialog && slateId) {
      Meteor.callAsync(CONSTANTS.methods.slateAccess.recipients, slateId)
        .then(rows => { if (current) setRecipients(rows) })
        .catch(() => { if (current) setRecipientError(true) })
    }
    return () => { current = false }
  }, [slateId, openShareDialog])
  const members = recipients || []
  const memberPermissions = useTracker(() => {
    const orgId = Meteor.user()?.orgId
    if (!orgId) return { ready: true, admins: new Set(), canInvite: false }
    const ready = Meteor.subscribe(CONSTANTS.publications.permissions).ready()
    const { admin, canAddUsers } = CONSTANTS.claims
    const claims = Permissions.find({ orgId, claimId: { $in: [admin._id, canAddUsers._id] } }).fetch()
    return {
      ready,
      admins: new Set(claims.filter(claim => claim.claimId === admin._id).map(claim => claim.userId)),
      canInvite: claims.some(claim => claim.userId === Meteor.userId()),
    }
  })
  const { accessReady, slateAccess } = useTracker(() => ({
    accessReady: Meteor.subscribe(CONSTANTS.publications.slateAccess, {}).ready(),
    slateAccess: SlateAccess.find({ slateId: slate?.options?.id }).fetch(),
  }))

  const link = slateAccess.find(access => access._id === slateId) ||
    slateAccess.find(access => !access.userId && access.accessKey &&
      access.type === visibility && ['unlisted', 'public'].includes(access.type))
  const permission = link?.slateAccessPermissionId || CONSTANTS.slateAccessPermissions.read.id
  const [panel, setPanel] = useState(null)
  const expandedPanel = panel ?? visibility
  const panelPermission = link?.type === expandedPanel ? permission : CONSTANTS.slateAccessPermissions.read.id
  const [linkError, setLinkError] = useState('')
  const [savingLink, setSavingLink] = useState(false)
  async function configureLink(type, nextPermission = permission) {
    if (savingLink) return
    setSavingLink(true)
    setLinkError('')
    try {
      await Meteor.callAsync(CONSTANTS.methods.slateAccess.configureLink, { slateId, type, permission: nextPermission })
      setPanel(type)
      setSlatePrivacy({ isPublic: type === 'public', isPrivate: type === 'private', isUnlisted: type === 'unlisted' })
      return true
    } catch (error) {
      setLinkError(error.reason || 'Could not update sharing.')
    } finally {
      setSavingLink(false)
    }
  }

  const closeShareDialog = () => {
    if (savingLink) return
    setPanel(null)
    setLinkError('')
    setOpenShareDialog(false)
  }

  function isChecked(member, slateAccessPermissionId) {
    const grant = slateAccess.find(sa => sa.type === 'private' && sa.userId === member._id)
    return (grant?.slateAccessPermissionId || CONSTANTS.slateAccessPermissions.none.id) === slateAccessPermissionId
  }

  async function handlePermission(member, slateAccessPermissionId) {
    setLinkError('')
    try {
      await Meteor.callAsync(CONSTANTS.methods.slateAccess.configureMember, {
        slateId, memberId: member._id, permission: slateAccessPermissionId,
      })
    } catch (error) {
      setLinkError(error.reason || 'Could not update the team member’s access.')
    }
  }

  // Publishing to the library: the owner, or an admin of the slate's team. A guest is asked to sign up.
  const me = Meteor.user()
  const guest = Boolean(me?.isAnonymous)
  const teamAdmin = Boolean(me?.orgId && me.orgId === (ownSlate?.orgId ?? slate?.orgId) && memberPermissions.admins.has(me._id))
  const canPublish = Boolean(ownSlate && ownSlate.userId === Meteor.userId()) || teamAdmin
  const showLibrary = (guest || canPublish) && !ownSlate?.library?.mode

  const makePrivate = <Box sx={{ mb: 2 }}>
    <Typography sx={{ mb: 1 }}>This will turn off the current invitation link.</Typography>
    <Button variant="outlined" disabled={savingLink} onClick={() => configureLink('private')}>Make private</Button>
  </Box>
  const getAccordionBorderStyle = (type) => {
    if (visibility !== type) {
      return {}
    }
    return {
      border: '2px solid',
      borderColor: 'primary.main',
      borderRadius: 2,
    }
  }
  return (
    <Dialog
      fullWidth
      maxWidth="md"
      onClose={closeShareDialog}
      aria-labelledby="share-slate"
      open={openShareDialog || false}
      sx={{ m: 0, p: { xs: 0, sm: 2 } }}
    >
      <DialogTitle id="share-slate">
        Share this slate
      </DialogTitle>
      <DialogContent>
        {visibility === 'private' && expandedPanel === 'private' && <Box sx={{ mb: 2 }}>
          <Typography sx={{ mb: 1 }}>Invite a teammate. Anyone with the edit link can change this slate.</Typography>
          <Button variant="contained" disabled={savingLink || !accessReady} onClick={() => configureLink('unlisted', 'EDIT')}>Create edit link</Button>
        </Box>}
        {linkError && <Typography role="alert" color="error">{linkError}</Typography>}
        {Meteor.user() && Meteor.user().orgId && (
          <Accordion
            expanded={expandedPanel === 'private'}
            onChange={() => { if (!savingLink) setPanel('private') }}
            sx={getAccordionBorderStyle('private')}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls={`${panelId}-private-content`}
              id={`${panelId}-private-header`}
            >
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <VpnKeyIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={visibility === 'private' ? 'Private · current' : 'Private'}
                    secondary="Define team access to this private slate"
                  />
                </ListItem>
              </List>
            </AccordionSummary>
            <AccordionDetails>
              {visibility !== 'private' ? makePrivate : <TableContainer component={Paper}>
                <Table size="small">
                  <TableBody>
                    {!recipients && <TableRow><TableCell role="status">{recipientError ? 'Could not load teammates. Reopen sharing to try again.' : 'Loading teammates…'}</TableCell></TableRow>}
                    {recipients && members.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="center">
                          <Typography>
                            You have no team members defined.
                            {memberPermissions.canInvite ? (
                              <Button
                                component={RouterLink}
                                to="/team"
                                endIcon={<NavigateNext />}
                                sx={{ ml: 1 }}
                              >
                                Start building your team now
                              </Button>
                            ) : (
                              <>
                                (Waiting for your team&apos;s administrator to
                                add more team members.)
                              </>
                            )}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {members.map((member, index) => (
                      <TableRow
                        key={member._id}
                        sx={{
                          bgcolor: index % 2 ? 'shell.offset' : '',
                        }}
                      >
                        <TableCell>
                          {member.profile?.firstName} {member.profile?.lastName}

                        </TableCell>
                        <TableCell>
                          {!memberPermissions.ready ? <Typography>Loading permissions…</Typography> : !memberPermissions.admins.has(member._id) ? (
                            <RadioGroup
                              row
                              aria-label="slateAccessPermission"
                              name={'slateAccessPermission-' + member._id}
                            >
                              {Object.keys(
                                CONSTANTS.slateAccessPermissions
                              ).map((perm) => (
                                <FormControlLabel
                                  key={
                                    CONSTANTS.slateAccessPermissions[perm].id
                                  }
                                  value={
                                    CONSTANTS.slateAccessPermissions[perm].id
                                  }
                                  control={
                                    <Radio
                                      color="secondary"
                                      checked={isChecked(
                                        member,
                                        CONSTANTS.slateAccessPermissions[perm]
                                          .id
                                      )}
                                      onClick={async () => {
                                        await handlePermission(
                                          member,
                                          CONSTANTS.slateAccessPermissions[perm]
                                            .id
                                        )
                                      }}
                                    />
                                  }
                                  label={
                                    CONSTANTS.slateAccessPermissions[perm]
                                      .description
                                  }
                                  labelPlacement="end"
                                />
                              ))}
                            </RadioGroup>
                          ) : (
                            <Typography variant="body1" color="primary">
                              Admin users have full access to every team slate
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {members.length > 0 && (
                      <TableRow>
                        <TableCell colSpan={6} align="right">
                          <Button
                            variant="outlined"
                            component={RouterLink}
                            to="/team"
                          >
                            Invite more members
                          </Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>}
            </AccordionDetails>
          </Accordion>
        )}
        {Meteor.user() && !Meteor.user().orgId && (
          <Accordion
            expanded={expandedPanel === 'private'}
            onChange={() => { if (!savingLink) setPanel('private') }}
            sx={getAccordionBorderStyle('private')}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls={`${panelId}-private-content`}
              id={`${panelId}-private-header`}
            >
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <HttpsIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary={visibility === 'private' ? 'Private · current' : 'Private'}
                    secondary="Keep this slate to yourself"
                  />
                </ListItem>
              </List>
            </AccordionSummary>
            {visibility !== 'private' && <AccordionDetails>{makePrivate}</AccordionDetails>}
          </Accordion>
        )}
        <Accordion
          expanded={expandedPanel === 'unlisted'}
          onChange={() => { if (!savingLink) setPanel('unlisted') }}
          sx={getAccordionBorderStyle('unlisted')}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`${panelId}-unlisted-content`}
            id={`${panelId}-unlisted-header`}
          >
            <List dense>
              <ListItem>
                <ListItemIcon>
                  <HttpsIcon />
                </ListItemIcon>
                <ListItemText
                  primary={visibility === 'unlisted' ? 'Unlisted · current' : 'Unlisted'}
                  secondary="Anyone with this link can join."
                />
              </ListItem>
            </List>
          </AccordionSummary>
          <AccordionDetails>
            {expandedPanel === 'unlisted' && <LinkSettings type="unlisted" active={visibility === 'unlisted'} grant={link}
              currentPermission={panelPermission} busy={savingLink || !visibility || !accessReady} configure={configureLink} />}
          </AccordionDetails>
        </Accordion>
        <Accordion
          expanded={expandedPanel === 'public'}
          onChange={() => { if (!savingLink) setPanel('public') }}
          sx={getAccordionBorderStyle('public')}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`${panelId}-public-content`}
            id={`${panelId}-public-header`}
          >
            <List dense>
              <ListItem>
                <ListItemIcon>
                  <PublicIcon />
                </ListItemIcon>
                <ListItemText
                  primary={visibility === 'public' ? 'Public · current' : 'Public'}
                  secondary="Make the slate publicly accessible"
                />
              </ListItem>
            </List>
          </AccordionSummary>
          <AccordionDetails>
            {expandedPanel === 'public' && <LinkSettings type="public" active={visibility === 'public'} grant={link}
              currentPermission={panelPermission} busy={savingLink || !visibility || !accessReady} configure={configureLink} />}
          </AccordionDetails>
        </Accordion>
        {showLibrary && (
          <Box data-testid="share-library" sx={{ mt: 3, display: 'grid', gap: 1 }}>
            <Typography variant="subtitle1" component="h3">Library</Typography>
            <Typography variant="body2" color="text.secondary">
              Share this slate with everyone who uses Slatebox. After a review, people can open a copy and make it their own.
            </Typography>
            <PublishStatus kind="slate" shareId={slate?.shareId} guest={guest} name={slate?.options?.name}
              description={slate?.options?.description} libraryOrigin={ownSlate?.libraryOrigin} previewSlate={ownSlate} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          disabled={savingLink}
          onClick={closeShareDialog}
          color="primary"
          variant="contained"
          sx={{ mr: 2, mb: 1 }}
        >
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}

SlateSharing.propTypes = { slate: slateProps }
