import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, useHistory } from 'react-router-dom'
import {
  createMuiTheme,
  makeStyles,
  ThemeProvider,
} from '@material-ui/core/styles'
import { useDispatch, useSelector } from 'react-redux'
import clsx from 'clsx'
import CssBaseline from '@material-ui/core/CssBaseline'
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer'
import AppBar from '@material-ui/core/AppBar'
import Toolbar from '@material-ui/core/Toolbar'
import Typography from '@material-ui/core/Typography'
import TextField from '@material-ui/core/TextField'
import List from '@material-ui/core/List'
import Divider from '@material-ui/core/Divider'
import IconButton from '@material-ui/core/IconButton'
import Button from '@material-ui/core/Button'
import Grid from '@material-ui/core/Grid'
import MenuIcon from '@material-ui/icons/Menu'
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft'
import ButtonGroup from '@material-ui/core/ButtonGroup'

import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import ListItemText from '@material-ui/core/ListItemText'
import DeviceHubIcon from '@material-ui/icons/DeviceHub'
import TuneIcon from '@material-ui/icons/Tune'
import PublicIcon from '@material-ui/icons/Public'
import HistoryIcon from '@material-ui/icons/History'
import LockIcon from '@material-ui/icons/Lock'
import VpnLockIcon from '@material-ui/icons/VpnLock'

import SettingsIcon from '@material-ui/icons/Settings'
import BrushIcon from '@material-ui/icons/Brush'
import GroupIcon from '@material-ui/icons/Group'
import AccountCircleIcon from '@material-ui/icons/AccountCircle'
import ContactSupportIcon from '@material-ui/icons/ContactSupport'
import TableChartIcon from '@material-ui/icons/TableChart'
import ShareIcon from '@material-ui/icons/Share'
import { Chip, Tooltip, useMediaQuery } from '@material-ui/core'
import ViewComfy from '@material-ui/icons/ViewComfy'
import Snackbar from '@material-ui/core/Snackbar'
import Alert from '@material-ui/lab/Alert'
import Routes from './Routes'

import { ChatWootConfig } from './components/ChatWootConfig'
import { MessageListener } from './components/MessageListener'
import { CONSTANTS } from '../api/common/constants'
import { ProfileMenu } from './components/ProfileMenu'
import { Register } from './common/Register'
import { Payment } from './common/Payment'

import confirmService from './common/confirm'

import { Organizations, SlateAccess, Slates } from '../api/common/models'
import AuthManager from '../api/common/AuthManager'

import { MessagesMenu } from './components/MessagesMenu'
import { getUserName } from '../api/common/getUserName'
import { promisify } from '../api/client/promisify'
import { createAnonymousUser } from '../api/client/createAnonymousUser'
import { SlateSnapshots } from './components/slate/SlateSnapshots'
import { LoadHeap } from './components/LoadHeap'

// logo color: #0F4C75

const palette = {
  primary: {
    main: '#121212',
  },
  error: {
    main: '#FF4C21',
  },
  secondary: {
    main: '#B76C0D',
  },
  info: {
    main: '#3265aa',
  },
  warning: {
    main: '#FFC021',
  },
  success: {
    main: '#1EE770',
  },
  type: 'dark',
  grey: {
    800: '#000000', // overrides failed
    900: '#000000', // overrides success
  },
}

const theme = createMuiTheme({
  palette,
})

export default function Main() {
  let useStyles = null
  let userName = ''
  const onCanvas = useSelector((state) => state.onCanvas)
  const slateName = useSelector((state) => state.slateName || '')
  const slate = useSelector((state) => state.slate)
  const slatePrivacy = useSelector((state) => state.slatePrivacy) || {
    isPublic: slate?.options.isPublic,
    isPrivate: slate?.options.isPrivate,
    isUnlisted: slate?.options.isUnlisted,
  }
  const collaborator = useSelector((state) => state.collaborator)
  const openShareDialog = useSelector((state) => state.openShareDialog)
  const canManageSlate = useSelector((state) => state.canManageSlate)
  const globalMessage = useSelector((state) => state.globalMessage) || {
    visible: false,
    isSnackBar: true,
    text: '',
    severity: 'info',
    autoHide: 10000,
  }
  // let noDrawer = useSelector(state => state.noDrawer) || false;
  const [snapshotOpen, setSnapshotOpen] = React.useState(false)
  const dispatch = useDispatch()
  const history = useHistory()

  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'))
  const xlmq = useMediaQuery(theme.breakpoints.up('xl'))

  // Cohere.init(Meteor.settings.public.cohereKey);

  const slateAccess = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.slateAccess, {})
    // console.log("app slatAccess", SlateAccess.find().fetch());
    return SlateAccess.find().fetch()
  })

  useTracker(() => {
    // subscribe to the user's data
    Meteor.subscribe(CONSTANTS.publications.users.me)

    const drawerWidth = Meteor.user() ? 240 : 0
    // console.log("drawerWidth is ", Meteor.user(), drawerWidth);
    if (drawerWidth > 0) {
      userName = getUserName(Meteor.userId())
    }
    useStyles = makeStyles((sbTheme) => ({
      root: {
        display: 'flex',
      },
      toolbar: {
        paddingRight: 24, // keep right padding when drawer closed
      },
      toolbarIcon: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 8px',
        ...sbTheme.mixins.toolbar,
      },
      appBar: {
        zIndex: sbTheme.zIndex.drawer + 1,
        transition: sbTheme.transitions.create(['width', 'margin'], {
          easing: sbTheme.transitions.easing.sharp,
          duration: sbTheme.transitions.duration.leavingScreen,
        }),
      },
      appBarShift: {
        marginLeft: drawerWidth,
        width: `calc(100% - ${drawerWidth}px)`,
        transition: sbTheme.transitions.create(['width', 'margin'], {
          easing: sbTheme.transitions.easing.sharp,
          duration: sbTheme.transitions.duration.enteringScreen,
        }),
      },
      menuButton: {
        marginRight: 36,
      },
      menuButtonHidden: {
        display: 'none',
      },
      canvasProps: {
        flexGrow: 1,
      },
      stickyBottom: {
        position: 'fixed',
        bottom: '10%',
        width: '238px',
      },
      drawerPaper: {
        position: 'relative',
        whiteSpace: 'nowrap',
        width: drawerWidth,
        backgroundColor: '#000',
        transition: sbTheme.transitions.create('width', {
          easing: sbTheme.transitions.easing.sharp,
          duration: sbTheme.transitions.duration.enteringScreen,
        }),
      },
      drawerPaperClose: {
        overflowX: 'hidden',
        transition: sbTheme.transitions.create('width', {
          easing: sbTheme.transitions.easing.sharp,
          duration: sbTheme.transitions.duration.leavingScreen,
        }),
        width: sbTheme.spacing(7),
        [sbTheme.breakpoints.up('sm')]: {
          width: sbTheme.spacing(9),
        },
      },
      appBarSpacer: sbTheme.mixins.toolbar,
      content: {
        flexGrow: 1,
        height: '100vh',
        overflow: 'auto',
        backgroundColor: '#202020',
      },
      container: {
        paddingTop: sbTheme.spacing(4),
        paddingBottom: sbTheme.spacing(4),
      },
      paper: {
        padding: sbTheme.spacing(2),
        display: 'flex',
        overflow: 'auto',
        flexDirection: 'column',
      },
      fixedHeight: {
        height: drawerWidth, // 240,
      },
      logo: {
        maxHeight: '40px',
      },
    }))
  })

  const loadedUser = useTracker(() => Meteor.user())

  const orgName = useTracker(() => {
    const org =
      Meteor.user() && Meteor.user().orgId ? Organizations.findOne() : null
    return org && org.name
  })

  useTracker(() => {
    if (Meteor.user()?.orgId) {
      Meteor.subscribe(CONSTANTS.publications.permissions)
      Meteor.subscribe(CONSTANTS.publications.organizations)
      Meteor.subscribe(CONSTANTS.publications.orgUsers)
      Meteor.subscribe(CONSTANTS.publications.claims)
    }
  })

  const classes = useStyles()
  const open = useSelector((state) => state.mainDrawerOpen || false)
  const handleDrawerOpen = () => {
    dispatch({ type: 'canvas', mainDrawerOpen: true })
  }
  const handleDrawerClose = () => {
    dispatch({ type: 'canvas', mainDrawerOpen: false })
  }
  const handleManage = () => {
    dispatch({ type: 'canvas', slateDrawerOpen: true })
  }
  // const handleExtensions = () => {
  //   dispatch({ type: "canvas", extensionsDrawerOpen: true });
  // }
  const handleSnapshots = () => {
    setSnapshotOpen(true)
  }

  const handleSupport = () => {
    window.$chatwoot.toggle()
  }

  const handleSlateName = (e) => {
    slate.options.name = e.target.value
    dispatch({ type: 'canvas', slateName: e.target.value })
    const pkg = { type: 'onSlateNameChanged', data: { name: e.target.value } }
    // invoke updates the local slate
    slate?.collab.invoke(pkg)
    pkg.instanceId = collaborator.instanceId
    pkg.slateId = slate.shareId
    slate.collab.send(pkg)
  }

  const handleClose = () => {
    dispatch({
      type: 'canvas',
      globalMessage: {
        visible: false,
        isSnackBar: true,
        text: '',
        severity: 'info',
        autoHide: 10000,
      },
    })
  }

  return (
    <>
      <CssBaseline />
      <LoadHeap />
      <ChatWootConfig />
      <ThemeProvider theme={theme}>
        <div id="appRoot" className={classes.root}>
          <AppBar
            position="absolute"
            className={clsx(classes.appBar, open && classes.appBarShift)}
          >
            <Toolbar className={classes.toolbar}>
              {onCanvas || !Meteor.user() ? null : (
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label="open drawer"
                  onClick={handleDrawerOpen}
                  className={clsx(
                    classes.menuButton,
                    open && classes.menuButtonHidden
                  )}
                >
                  <MenuIcon />
                </IconButton>
              )}
              <Grid
                container
                className={classes.canvasProps}
                alignItems="center"
                justify="space-between"
                spacing={1}
              >
                <Grid item>
                  <Grid
                    container
                    alignItems="center"
                    justify="flex-start"
                    spacing={1}
                  >
                    <Grid item>
                      {onCanvas || orgName ? (
                        <img
                          src="/images/slatebox_small_logo.svg"
                          alt="Slatebox - Open And Free Remote Collaboration"
                          className={classes.logo}
                        />
                      ) : (
                        <img
                          src="/images/slatebox_logo.svg"
                          alt="Slatebox - Open And Free Remote Collaboration"
                          className={classes.logo}
                        />
                      )}
                    </Grid>
                    <Grid item>
                      {orgName && (
                        <Typography
                          component="span"
                          variant="h5"
                          color="secondary"
                        >
                          &nbsp;&nbsp;{orgName}
                        </Typography>
                      )}
                    </Grid>
                  </Grid>
                </Grid>
                {onCanvas && lgmq && (
                  <Grid item>
                    <Grid alignItems="center" container spacing={2}>
                      <Grid item>
                        {slatePrivacy.isPrivate ? (
                          <Chip
                            color="secondary"
                            icon={<LockIcon />}
                            label="private"
                          />
                        ) : slatePrivacy.isUnlisted ? (
                          <Chip icon={<VpnLockIcon />} label="unlisted" />
                        ) : (
                          <Chip icon={<PublicIcon />} label="public" />
                        )}
                      </Grid>
                      {slate && !slate.options.eligibleForThemeCompilation && (
                        <Grid item>
                          <TextField
                            variant="outlined"
                            color="secondary"
                            size="small"
                            inputProps={{
                              style: { color: theme.palette.secondary.main },
                            }}
                            value={slateName}
                            disabled={!canManageSlate}
                            onChange={handleSlateName}
                          />
                        </Grid>
                      )}
                    </Grid>
                  </Grid>
                )}
                {onCanvas && (
                  <Grid item>
                    <ButtonGroup aria-label="outlined button group">
                      {canManageSlate && (
                        <Tooltip title={xlmq ? '' : 'Manage Slate'}>
                          <Button
                            variant="contained"
                            color="secondary"
                            className={classes.button}
                            onClick={handleManage}
                            startIcon={<TuneIcon />}
                          >
                            {xlmq && (
                              <>
                                {slate &&
                                !slate.options.eligibleForThemeCompilation
                                  ? 'Manage'
                                  : 'Manage Theme'}
                              </>
                            )}
                          </Button>
                        </Tooltip>
                      )}
                      {!Meteor.userId() && (
                        <Button
                          variant="contained"
                          color="secondary"
                          className={classes.button}
                          onClick={async (e) => {
                            await createAnonymousUser()
                            dispatch({
                              type: 'registration',
                              registrationOpen: true,
                              registrationMessage: `Register to create an account.`,
                            })
                          }}
                        >
                          Create Account
                        </Button>
                      )}
                      {slate &&
                        slate.userId === Meteor.userId() &&
                        !slate.options.eligibleForThemeCompilation && (
                          <Tooltip title={xlmq ? '' : 'Privacy & Sharing'}>
                            <Button
                              variant="contained"
                              color="secondary"
                              className={classes.button}
                              onClick={async (e) => {
                                if (!Meteor.user().orgId) {
                                  const intendState = slate.options?.isPublic
                                    ? 'private'
                                    : 'public'
                                  const result = await confirmService.show({
                                    theme,
                                    title: `Manage Slate Privacy`,
                                    message:
                                      'In order to share with your team, you have to first create one. Otherwise you can simply change the privacy below.',
                                    actionItems: [
                                      {
                                        label: 'Create my team',
                                        return: 'team',
                                      },
                                      {
                                        label: `Make my slate ${intendState}`,
                                        return: intendState,
                                      },
                                      {
                                        label: `Leave slate ${
                                          intendState === 'private'
                                            ? 'public'
                                            : 'private'
                                        }`,
                                        return: false,
                                      },
                                    ],
                                  })
                                  if (result) {
                                    switch (result) {
                                      case 'private': {
                                        const nonPublics = await promisify(
                                          Meteor.call,
                                          CONSTANTS.methods.slates.getNonPublic
                                        )
                                        if (
                                          nonPublics.length >=
                                          CONSTANTS.privateSlateLimit
                                        ) {
                                          // past the limit, so show payment options
                                          dispatch({
                                            type: 'payment',
                                            paymentOpen: true,
                                            paymentMessage: `Upgrade to have more than ${
                                              CONSTANTS.privateSlateLimit
                                            } private or unlisted slates. (Current private or unlisted slates: ${nonPublics
                                              .map((p) => p.name)
                                              .join(', ')}.)`,
                                            paymentFocus: `more than ${CONSTANTS.privateSlateLimit} private slates`,
                                            paymentEmphasis: `Upgrade below.`,
                                          })
                                        } else {
                                          slate.options.isPublic = false
                                          slate.options.isPrivate = true
                                          slate.options.isUnlisted = false
                                          Slates.update(
                                            { _id: slate.options.id },
                                            {
                                              $set: {
                                                'options.isPublic': false,
                                                'options.isPrivate': true,
                                                'options.isUnlisted': false,
                                              },
                                            }
                                          )
                                          dispatch({
                                            type: 'canvas',
                                            slatePrivacy: {
                                              isPublic: false,
                                              isPrivate: true,
                                              isUnlisted: false,
                                            },
                                          })
                                          dispatch({
                                            type: 'canvas',
                                            globalMessage: {
                                              visible: true,
                                              text: `You've set this slate to private`,
                                              severity: 'info',
                                              autoHide: 60000,
                                            },
                                          })
                                        }
                                        break
                                      }
                                      case 'team': {
                                        history.push('/team')
                                        break
                                      }
                                      case 'public':
                                      default: {
                                        slate.options.isPublic = true
                                        slate.options.isPrivate = false
                                        slate.options.isUnlisted = false
                                        Slates.update(
                                          { _id: slate.options.id },
                                          {
                                            $set: {
                                              'options.isPublic': true,
                                              'options.isPrivate': false,
                                              'options.isUnlisted': false,
                                            },
                                          }
                                        )
                                        dispatch({
                                          type: 'canvas',
                                          slatePrivacy: {
                                            isPublic: true,
                                            isPrivate: false,
                                            isUnlisted: false,
                                          },
                                        })
                                        dispatch({
                                          type: 'canvas',
                                          globalMessage: {
                                            visible: true,
                                            text: `You've set this slate to public`,
                                            severity: 'info',
                                            autoHide: 60000,
                                          },
                                        })
                                        break
                                      }
                                    }
                                  }
                                } else {
                                  dispatch({
                                    type: 'canvas',
                                    openShareDialog: !openShareDialog,
                                  })
                                }
                              }}
                              startIcon={<ShareIcon />}
                            >
                              {xlmq && <>Privacy &amp; Sharing</>}
                            </Button>
                          </Tooltip>
                        )}
                      {canManageSlate &&
                        slate &&
                        !slate.options.eligibleForThemeCompilation && (
                          <Tooltip title={xlmq ? '' : 'Snapshots'}>
                            <Button
                              variant="contained"
                              color="secondary"
                              className={classes.button}
                              onClick={handleSnapshots}
                              startIcon={<HistoryIcon />}
                            >
                              {xlmq && <>Snapshots</>}
                            </Button>
                          </Tooltip>
                        )}
                    </ButtonGroup>
                  </Grid>
                )}
                <Grid item>
                  <Grid container>
                    <Grid item>{userName !== '' && <ProfileMenu />}</Grid>
                    <Grid item>{userName !== '' && <MessagesMenu />}</Grid>
                    <Grid item>
                      {userName !== '' && mdmq && (
                        <IconButton
                          edge="start"
                          color="inherit"
                          aria-label="contact support"
                          onClick={handleSupport}
                        >
                          <ContactSupportIcon />
                        </IconButton>
                      )}
                    </Grid>
                  </Grid>
                </Grid>
              </Grid>
            </Toolbar>
          </AppBar>
          {Meteor.user() && (
            <SwipeableDrawer
              variant="permanent"
              classes={{
                paper: clsx(
                  classes.drawerPaper,
                  !open && classes.drawerPaperClose
                ),
              }}
              open={open}
              onOpen={handleDrawerOpen}
              onClose={handleDrawerClose}
            >
              <div className={classes.toolbarIcon}>
                {onCanvas ? null : (
                  <IconButton onClick={handleDrawerClose}>
                    <ChevronLeftIcon />
                  </IconButton>
                )}
              </div>
              <Divider />
              <List>
                <Tooltip placement="top" title={open ? '' : 'My Slates'}>
                  <ListItem button component={Link} to="/">
                    <ListItemIcon>
                      <DeviceHubIcon />
                    </ListItemIcon>
                    <ListItemText primary="My Slates" />
                  </ListItem>
                </Tooltip>
                {(AuthManager.userHasClaim(Meteor.userId(), [
                  CONSTANTS.claims.canEditUsers._id,
                  CONSTANTS.claims.canViewUsers._id,
                ]) ||
                  (loadedUser && !loadedUser.orgId)) && (
                  <Tooltip placement="top" title={open ? '' : 'Manage Team'}>
                    <ListItem button component={Link} to="/team">
                      <ListItemIcon>
                        <GroupIcon />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          loadedUser?.orgId ? `Manage Team` : 'Create Team'
                        }
                      />
                    </ListItem>
                  </Tooltip>
                )}
                {(AuthManager.userHasClaim(Meteor.userId(), [
                  CONSTANTS.claims.admin._id,
                ]) ||
                  slateAccess.find((sa) => sa.userId === Meteor.userId())) && (
                  <Tooltip placement="top" title={open ? '' : 'Team Slates'}>
                    <ListItem button component={Link} to="/team/slates">
                      <ListItemIcon>
                        <ViewComfy />
                      </ListItemIcon>
                      <ListItemText primary="Team Slates" />
                    </ListItem>
                  </Tooltip>
                )}
                {AuthManager.userHasClaim(Meteor.userId(), [
                  CONSTANTS.claims.admin._id,
                ]) && (
                  <Tooltip placement="top" title={open ? '' : 'Team Settings'}>
                    <ListItem button component={Link} to="/team/settings">
                      <ListItemIcon>
                        <SettingsIcon />
                      </ListItemIcon>
                      <ListItemText primary="Team Settings" />
                    </ListItem>
                  </Tooltip>
                )}
                <Tooltip placement="top" title={open ? '' : 'Profile'}>
                  <ListItem button component={Link} to="/profile">
                    <ListItemIcon>
                      <AccountCircleIcon />
                    </ListItemIcon>
                    <ListItemText primary="Profile" />
                  </ListItem>
                </Tooltip>
                <Tooltip placement="top" title={open ? '' : 'Templates'}>
                  <ListItem button component={Link} to="/templates">
                    <ListItemIcon>
                      <TableChartIcon />
                    </ListItemIcon>
                    <ListItemText primary="Templates" />
                  </ListItem>
                </Tooltip>
                <Tooltip placement="top" title={open ? '' : 'Themes'}>
                  <ListItem button component={Link} to="/themes">
                    <ListItemIcon>
                      <BrushIcon />
                    </ListItemIcon>
                    <ListItemText primary="Themes" />
                  </ListItem>
                </Tooltip>
                {Meteor.user() && (
                  <Tooltip
                    placement="top"
                    title={open ? '' : 'Community Slates'}
                  >
                    <ListItem button component={Link} to="/slates">
                      <ListItemIcon>
                        <PublicIcon />
                      </ListItemIcon>
                      <ListItemText primary="Community Slates" />
                    </ListItem>
                  </Tooltip>
                )}
              </List>
            </SwipeableDrawer>
          )}
          <main className={classes.content}>
            <div className={clsx(classes.appBarSpacer)} />
            <Routes />
            <Register user={loadedUser} />
            <Payment user={loadedUser} />
          </main>
        </div>
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          open={globalMessage.visible}
          onClose={handleClose}
          autoHideDuration={globalMessage.autoHide || 10000}
        >
          <Alert severity={globalMessage.severity}>{globalMessage.text}</Alert>
        </Snackbar>
        <MessageListener />
        <SlateSnapshots
          slate={slate}
          open={snapshotOpen}
          onDialogClosed={(e) => {
            setSnapshotOpen(false)
          }}
          applySnapshot={(json) => {
            slate.loadJSON(json)
            setSnapshotOpen(false)
          }}
        />
      </ThemeProvider>
    </>
  )
}
