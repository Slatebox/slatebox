/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import Dialog from '@material-ui/core/Dialog'
import DialogTitle from '@material-ui/core/DialogTitle'
import DialogContent from '@material-ui/core/DialogContent'
import DialogActions from '@material-ui/core/DialogActions'
import Typography from '@material-ui/core/Typography'
import VpnKeyIcon from '@material-ui/icons/VpnKey'
import HttpsIcon from '@material-ui/icons/Https'
import ExpandMoreIcon from '@material-ui/icons/ExpandMore'
import PublicIcon from '@material-ui/icons/Public'
import FileCopyIcon from '@material-ui/icons/FileCopy'
import Button from '@material-ui/core/Button'
import Accordion from '@material-ui/core/Accordion'
import AccordionSummary from '@material-ui/core/AccordionSummary'
import AccordionDetails from '@material-ui/core/AccordionDetails'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import ListItemText from '@material-ui/core/ListItemText'
import TableContainer from '@material-ui/core/TableContainer'
import Table from '@material-ui/core/Table'
import TableRow from '@material-ui/core/TableRow'
import TableCell from '@material-ui/core/TableCell'
import Link from '@material-ui/core/Link'
import { Link as RouterLink } from 'react-router-dom'
import TableBody from '@material-ui/core/TableBody'
import Paper from '@material-ui/core/Paper'
import RadioGroup from '@material-ui/core/RadioGroup'
import Radio from '@material-ui/core/Radio'
import FormControlLabel from '@material-ui/core/FormControlLabel'
import Select from '@material-ui/core/Select'
import Grid from '@material-ui/core/Grid'
import MenuItem from '@material-ui/core/MenuItem'
import { CircularProgress } from '@material-ui/core'
import IconButton from '@material-ui/core/IconButton'
import Box from '@material-ui/core/Box'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import { Organizations, SlateAccess, Slates } from '../../../api/common/models'
import AuthManager from '../../../api/common/AuthManager'
import slateProps from '../../propTypes/slatePriops'

const useStyles = makeStyles((theme) => ({
  modal: {
    margin: 0,
    '& .MuiPaper-root': {
      backgroundColor: '#000',
    },
    padding: theme.spacing(2),
  },
  root: {
    width: '100%',
    marginTop: theme.spacing(3),
    overflowX: 'auto',
  },
  lightRow: {
    background: '#424242',
  },
  whiteRow: {
    background: '#fff',
  },
  darkRow: {
    background: '#303030',
  },
  sticky: {
    width: 300,
    position: 'sticky',
    left: 0,
    backgroundColor: '#424242',
    zIndex: 999,
    boxShadow: '2px 2px 2px #000',
  },
}))

export default function SlateSharing({ slate }) {
  const dispatch = useDispatch()
  const sharingExpanded = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.shareableSlate, slate?.options.id)
    const s = Slates.findOne({ _id: slate?.options?.id })
    if (s?.options?.isUnlisted) {
      return 'unlisted'
    }
    if (s?.options?.isPrivate) {
      return 'private'
    }
    return 'public'
  })

  const openShareDialog = useSelector((state) => state.openShareDialog)
  const classes = useStyles()
  const members = useTracker(() =>
    // only non admins need explicit access
    Meteor.users
      .find({ orgId: Meteor?.user()?.orgId, _id: { $ne: Meteor.userId() } })
      .fetch()
      .filter(
        (m) => !AuthManager.userHasClaim(m._id, [CONSTANTS.claims.admin._id])
      )
  )
  const slateAccess = useTracker(() =>
    SlateAccess.find({ slateId: slate?.options?.id }).fetch()
  )

  const [guestViewData, setGuestViewData] = React.useState(null)
  useEffect(() => {
    async function getData() {
      const gdata = await promisify(
        Meteor.call,
        CONSTANTS.methods.organizations.guestViewReport
      )
      /*
      return { 
        headers: headers, 
        data: dataRows, 
        allowableUnlistedViewsPerMonth: allowableGuestViews, 
        totalUnlistedViewsByMonth: totalUnlistedViewsByMonth, 
        totalPublicViewsByMonth: totalPublicViewsByMonth, 
        totalViews: rows.length 
      };
      */
      setGuestViewData(gdata)
    }
    getData()
  }, [])

  const unlistedViewsThisMonth =
    guestViewData?.totalUnlistedViewsByMonth &&
    guestViewData?.totalUnlistedViewsByMonth[new Date().getMonth() + 1]
      ? guestViewData?.totalUnlistedViewsByMonth[new Date().getMonth() + 1]
      : guestViewData?.allowableUnlistedViewsPerMonth

  function getSlateAccess(type) {
    const access = slateAccess.find(
      (sa) => sa._id === `${type}_${slate?.options.id}`
    )?.slateAccessPermissionId
    return access || CONSTANTS.slateAccessPermissions.read.id
  }

  function setSlateAccess(type, slateAccessPermissionId) {
    if (slateAccess.find((sa) => sa._id === `${type}_${slate.options.id}`)) {
      SlateAccess.update(
        { _id: `${type}_${slate.options.id}` },
        { $set: { slateAccessPermissionId } }
      )
    } else if (slate?.options) {
      SlateAccess.insert({
        type,
        _id: `${type}_${slate.options.id}`,
        slateId: slate.options.id,
        orgId: Meteor.user().orgId,
        slateAccessPermissionId,
        accessKey: Random.id().substring(0, 8),
        owningUserId: Meteor.userId(),
      })
    }
  }

  function getUrl(type) {
    const { baseUrl } = Meteor.settings.public
    let access = slateAccess.find(
      (sa) => sa._id === `${type}_${slate.options.id}`
    )
    let url = access ? `${baseUrl}/canvas/${access.accessKey}` : null
    if (type !== 'private' && !url) {
      // create read only by default if it's never been created
      setSlateAccess(type, CONSTANTS.slateAccessPermissions.read.id)
      access = slateAccess.find(
        (sa) => sa._id === `${type}_${slate.options.id}`
      )
      url = access ? `${baseUrl}/canvas/${access.accessKey}` : null
    }
    return url
  }

  function enact(exp) {
    dispatch({
      type: 'canvas',
      slatePrivacy: {
        isPublic: exp === 'public',
        isPrivate: exp === 'private',
        isUnlisted: exp === 'unlisted',
      },
    })
    Slates.update(
      { _id: slate?.options?.id },
      {
        $set: {
          'options.isPublic': exp === 'public',
          'options.isPrivate': exp === 'private',
          'options.isUnlisted': exp === 'unlisted',
        },
      }
    )
  }

  const setExpanded = async (exp) => {
    enact(exp)
  }

  const closeShareDialog = () => {
    dispatch({ type: 'canvas', openShareDialog: false })
  }

  function copyUrl(url) {
    navigator.clipboard.writeText(url)
    dispatch({
      type: 'canvas',
      globalMessage: {
        visible: true,
        isSnackBar: true,
        text: `${url} copied to clipboard!`,
        severity: 'info',
        autoHide: 10000,
      },
    })
  }

  function isChecked(member, slateAccessPermissionId) {
    const all = slateAccess.filter((sa) => sa.userId === member._id)
    const any = all.find(
      (sa) => sa.slateAccessPermissionId === slateAccessPermissionId
    )
    if (
      all.length === 0 &&
      slateAccessPermissionId === CONSTANTS.slateAccessPermissions.none.id
    ) {
      return true
    }
    return any
  }

  function handlePermission(member, slateAccessPermissionId) {
    if (
      slateAccess.find(
        (sa) => sa._id === `private_${member._id}_${slate.options.id}`
      )
    ) {
      SlateAccess.update(
        { _id: `private_${member._id}_${slate.options.id}` },
        { $set: { slateAccessPermissionId } }
      )
    } else {
      SlateAccess.insert({
        type: 'private',
        _id: `private_${member._id}_${slate.options.id}`,
        userId: member._id,
        orgId: Meteor.user().orgId,
        slateId: slate.options.id,
        slateAccessPermissionId,
        accessKey: Random.id().substring(0, 8),
        owningUserId: Meteor.userId(),
      })
    }
  }

  // eslint-disable-next-line react/no-unstable-nested-components
  function SelectType({ type }) {
    const url = getUrl(type)
    return (
      <Grid container alignItems="center" justify="flex-start" spacing={2}>
        <Grid item>Share the {type} link below to provide</Grid>
        <Grid item>
          <Select
            value={getSlateAccess(type)}
            onChange={(e) => {
              setSlateAccess(type, e.target.value)
            }}
            variant="outlined"
          >
            {Object.keys(CONSTANTS.slateAccessPermissions).map(
              (key) =>
                key !== 'none' && (
                  <MenuItem
                    key={CONSTANTS.slateAccessPermissions[key].id}
                    value={CONSTANTS.slateAccessPermissions[key].id}
                  >
                    {CONSTANTS.slateAccessPermissions[key].description}
                  </MenuItem>
                )
            )}
          </Select>
        </Grid>
        <Grid item>access to this slate.</Grid>
        <Grid item xs={12}>
          {url ? (
            <Grid container alignItems="center" justify="flex-start">
              <Grid item>
                <Paper variant="outlined" elevation={3}>
                  <Box m={1} p={1}>
                    <Typography variant="body2">{url}</Typography>
                  </Box>
                </Paper>
              </Grid>
              <Grid item>
                <IconButton
                  aria-label="copy url"
                  onClick={() => {
                    copyUrl(url)
                  }}
                  edge="end"
                >
                  <FileCopyIcon />
                </IconButton>
              </Grid>
            </Grid>
          ) : (
            <CircularProgress />
          )}
        </Grid>
      </Grid>
    )
  }

  SlateSharing.propTypes = {
    slate: slateProps.isRequired,
  }

  SelectType.propTypes = {
    type: PropTypes.string.isRequired,
  }

  return (
    <Dialog
      fullWidth
      maxWidth="md"
      onClose={closeShareDialog}
      aria-labelledby="share-slate"
      open={openShareDialog || false}
      className={classes.modal}
    >
      <DialogTitle id="share-slate" onClose={closeShareDialog}>
        Slate Privacy &amp; Sharing Settings
      </DialogTitle>
      <DialogContent>
        {Meteor.user() && Meteor.user().orgId && (
          <Accordion
            expanded={sharingExpanded === 'private'}
            onChange={() => {
              setExpanded('private')
            }}
            style={{
              backgroundColor: sharingExpanded === 'private' ? '#333' : '#000',
            }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="settingsPanelbh-content"
              id="settingsPanelbh-header"
            >
              <List dense>
                <ListItem>
                  <ListItemIcon>
                    <VpnKeyIcon />
                  </ListItemIcon>
                  <ListItemText
                    primary="Private"
                    secondary="Define team access to this private slate"
                  />
                </ListItem>
              </List>
            </AccordionSummary>
            <AccordionDetails>
              <TableContainer component={Paper} className={classes.root}>
                <Table size="small">
                  <TableBody>
                    {members.length === 0 && (
                      <TableRow className={classes.whiteRow}>
                        <TableCell colSpan={6} align="center">
                          <Typography color="secondary">
                            You have no team members defined.
                            {AuthManager.userHasClaim(Meteor.userId(), [
                              CONSTANTS.claims.canAddUsers._id,
                            ]) ? (
                              <Link component={RouterLink} to="/team">
                                Start building your team now &gt;&gt;
                              </Link>
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
                        className={
                          index % 2 ? classes.darkRow : classes.lightRow
                        }
                      >
                        <TableCell>
                          {member.profile.firstName} {member.profile.lastName}
                          <br />
                          {member.emails[0].address}
                        </TableCell>
                        <TableCell>
                          <RadioGroup
                            row
                            aria-label="slateAccessPermission"
                            name="slateAccessPermission"
                          >
                            {Object.keys(CONSTANTS.slateAccessPermissions).map(
                              (perm) => (
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
                                      onClick={() => {
                                        handlePermission(
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
                              )
                            )}
                          </RadioGroup>
                        </TableCell>
                      </TableRow>
                    ))}
                    {members.length > 0 && (
                      <TableRow className={classes.lightRow}>
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
              </TableContainer>
            </AccordionDetails>
          </Accordion>
        )}
        <Accordion
          expanded={sharingExpanded === 'unlisted'}
          onChange={() => {
            setExpanded('unlisted')
          }}
          style={{
            backgroundColor: sharingExpanded === 'unlisted' ? '#333' : '#000',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="colorPanelbh-content"
            id="colorPanelbh-header"
          >
            <List dense>
              <ListItem>
                <ListItemIcon>
                  <HttpsIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Unlisted"
                  secondary={`Create an unlisted link guests can use for collaboration. On your current plan, you've used ${unlistedViewsThisMonth} of ${guestViewData?.allowableUnlistedViewsPerMonth} guest day passes per month.`}
                />
              </ListItem>
            </List>
          </AccordionSummary>
          <AccordionDetails>
            <SelectType type="unlisted" />
          </AccordionDetails>
        </Accordion>
        <Accordion
          expanded={sharingExpanded === 'public'}
          onChange={(e) => {
            setExpanded('public')
          }}
          style={{
            backgroundColor: sharingExpanded === 'public' ? '#333' : '#000',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls="colorPanelbh-content"
            id="colorPanelbh-header"
          >
            <List dense>
              <ListItem>
                <ListItemIcon>
                  <PublicIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Public"
                  secondary="Get a link for public collaboration"
                />
              </ListItem>
            </List>
          </AccordionSummary>
          <AccordionDetails>
            <SelectType type="public" />
          </AccordionDetails>
        </Accordion>
      </DialogContent>
      <DialogActions>
        <Button autoFocus onClick={closeShareDialog} color="secondary">
          Done
        </Button>
      </DialogActions>
    </Dialog>
  )
}
