/* eslint-disable react/jsx-no-useless-fragment */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, useLocation } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import CssBaseline from '@mui/material/CssBaseline'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import AppBar from '@mui/material/AppBar'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import List from '@mui/material/List'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import MenuIcon from '@mui/icons-material/Menu'
import Box from '@mui/material/Box'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import CloseIcon from '@mui/icons-material/Close'
import AddIcon from '@mui/icons-material/Add'
import SaveIcon from '@mui/icons-material/Save'
import LoginIcon from '@mui/icons-material/Login'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import Drawer from '@mui/material/Drawer'
import ListSubheader from '@mui/material/ListSubheader'
import Button from '@mui/material/Button'

import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import DashboardIcon from '@mui/icons-material/Dashboard'
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import PaletteIcon from '@mui/icons-material/Palette'

import SettingsIcon from '@mui/icons-material/Settings'
import GroupIcon from '@mui/icons-material/Group'
import ViewComfy from '@mui/icons-material/ViewComfy'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import CookieNotice from './components/CookieNotice'
import ChatWootConfig from './components/ChatWootConfig'
import CanvasToolbar from './components/CanvasToolbar'
import ConnectionStatus from './components/ConnectionStatus'
import MessageListener from './components/MessageListener'
import CONSTANTS from '../api/common/constants'
import AccountMenu, { useSaveYourWork } from './components/AccountMenu'
import sbTheme from './common/muiThemes'
import './common/main.css'
import MainPaper from './components/MainPaper'

import {
  isSlateDrawerOpen,
  slateOutputOpen,
  whichSlatePanelIsExpanded,
  registrationDetails,
  onCanvas,
  globalMessage,
  mainDrawerOpen,
  currentSlate,
  isSlateEmbedded,
  isShareDialogOpen,
  canManageSlate,
  slateHuddleType,
  currentSlateName,
  slatePrivacy,
  isSnapshotOpen,
  outstandingAIRequests,
} from './jotai/atoms'

import { Organizations, SlateAccess } from '../api/common/models'
import AuthManager from '../api/common/AuthManager'

import MessagesMenu from './components/MessagesMenu'
import getUserDisplayName from '../api/common/getUserName'
import LoadHeap from './components/LoadHeap'
import { rememberSignedIn } from './common/accountCopy.mjs'
import { enterpriseState } from '../api/common/edition.mjs'
// logo color: #0F4C75
const shrunkDrawerWidth = '50px !important'

export default function Main() {
  const userName = React.useRef('')
  const drawerWidth = React.useRef(0)
  const isOnCanvas = useAtomValue(onCanvas) // useSelector((state) => state.onCanvas)
  const slate = useAtomValue(currentSlate)
  const embeddedSlate = useAtomValue(isSlateEmbedded)
  const [slateName, setSlateName] = useAtom(currentSlateName)
  const getSlatePrivacy = useAtomValue(slatePrivacy)
  const getSlateHuddleType = useAtomValue(slateHuddleType)
  const [openShareDialog, setOpenShareDialog] = useAtom(isShareDialogOpen) // useSelector((state) => state.openShareDialog)
  const getCanManageSlate = useAtomValue(canManageSlate) // useSelector((state) => state.canManageSlate)
  const setRegistrationDetails = useSetAtom(registrationDetails)
  const areAIRequestsOutstanding = useAtomValue(outstandingAIRequests)
  const [message, setGlobalMessage] = useAtom(globalMessage)
  const [isMainDrawerOpen, setMainDrawerOpen] = useAtom(mainDrawerOpen)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  // On a canvas the app's menu opens over the canvas from the header's ≡.
  const [canvasNavOpen, setCanvasNavOpen] = useState(false)
  const setSlatePanel = useSetAtom(whichSlatePanelIsExpanded)
  const saveYourWork = useSaveYourWork()
  const narrow = useMediaQuery('(max-width:999.98px)')
  // const setVideoGuideOpen = useSetAtom(videoGuideOpen)
  const setSlateDrawerOpen = useSetAtom(isSlateDrawerOpen)
  const setSlateOutput = useSetAtom(slateOutputOpen)

  // let noDrawer = useSelector(state => state.noDrawer) || false;
  const setSnapshotOpen = useSetAtom(isSnapshotOpen)
  // const [chatIsOpen, setChatOpen] = useAtom(isChatOpen)

  const location = useLocation()
  const isOnPresentPage = location.pathname.includes('/present/')

  const mdmq = useMediaQuery(sbTheme.breakpoints.up('md'))

  const slateAccess = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.slateAccess, {})
    return SlateAccess.find().fetch()
  })

  const loadedUser = useTracker(() => Meteor.user())
  if (loadedUser && userName.current === '' && !Meteor.loggingOut()) {
    userName.current = getUserDisplayName()
    drawerWidth.current = 205
  }

  // Signed in to an account on this browser: the next sign-in page greets them as returning.
  useEffect(() => {
    if (loadedUser && loadedUser.isAnonymous === false) rememberSignedIn(globalThis.localStorage)
  }, [loadedUser?._id, loadedUser?.isAnonymous])

  const orgName = useTracker(() => {
    const org =
      Meteor.user() && Meteor.user().orgId ? Organizations.findOne() : null
    return org && org.name
  })

  const handleDrawerOpen = () => {
    if (mdmq) setMainDrawerOpen(true)
    else setMobileNavOpen(true)
  }

  const handleDrawerClose = () => {
    if (mdmq) setMainDrawerOpen(false)
    else setMobileNavOpen(false)
  }

  // A guest may name the slate; colours, exports and the rest ask them to save their work first,
  // as the settings themselves do.
  const guestAskedToSave = () => {
    if (!Meteor.user()?.isAnonymous) return false
    setRegistrationDetails({
      type: 'registration',
      registrationOpen: true,
      registrationMessage: `Save your work to use colors, exports, and sharing controls.`,
    })
    return true
  }
  // Slate settings, opened at one of its sections.
  const handleSettings = (section = 'settingsPanel') => {
    if (section !== 'settingsPanel' && guestAskedToSave()) return
    setSlatePanel(section)
    setSlateDrawerOpen(true)
  }
  // Export or Embed, from the slate menu.
  const handleOutput = (kind) => {
    if (guestAskedToSave()) return
    setSlateOutput(kind)
  }

  const handleSnapshots = () => {
    setSnapshotOpen(true)
  }

  // const handleChat = () => {
  //   setChatOpen(!chatIsOpen)
  // }

  const handleSupport = () => {
    // window.open('https://community.slatebox.com', '_blank')
    if (window.$chatwoot) window.$chatwoot.toggle()
    else window.location.href = 'mailto:support@slatebox.com'
  }

  // const showVideoGuides = (e) => {
  //   setVideoGuideOpen(true)
  // }

  // const handleSlateName = (e) => {
  //   // cause hook on Canvas to do the work to update
  //   setSlateName(e.target.value)
  // }

  const handleClose = () => {
    setGlobalMessage({
      visible: false,
      isSnackBar: true,
      text: '',
      severity: 'info',
      autoHide: 10000,
    })
  }

  // global message for AI requests
  // useEffect(() => {
  //   if (areAIRequestsOutstanding) {
  //     setGlobalMessage({
  //       visible: true,
  //       text: `Slatebox AI Is Working`,
  //       severity: 'info',
  //       autoHide: 60000,
  //     })
  //   } else {
  //     setGlobalMessage({
  //       visible: false,
  //       text: ``,
  //       severity: 'info',
  //     })
  //   }
  // }, [areAIRequestsOutstanding])

  // Add state variables for permission claims
  const [hasTeamManagementClaims, setHasTeamManagementClaims] = useState(false)
  const [hasTeamSlatesClaims, setHasTeamSlatesClaims] = useState(false)
  const [hasAdminClaim, setHasAdminClaim] = useState(false)

  // Add useEffect to handle async permissions check
  useEffect(() => {
    async function checkPermissions() {
      if (Meteor.userId()) {
        // Check team management claims
        const hasTeamClaims = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.canEditUsers._id,
          CONSTANTS.claims.canViewUsers._id,
          CONSTANTS.claims.canRemoveUsers._id,
        ])
        setHasTeamManagementClaims(hasTeamClaims)

        // Check team slates claims
        const hasSlatesClaims = await AuthManager.userHasClaim(
          Meteor.userId(),
          [
            CONSTANTS.claims.admin._id,
            CONSTANTS.claims.canCopyTeamSlates._id,
            CONSTANTS.claims.canAddSlates._id,
          ]
        )
        setHasTeamSlatesClaims(hasSlatesClaims)

        // Check admin claim
        const isAdmin = await AuthManager.userHasClaim(Meteor.userId(), [
          CONSTANTS.claims.admin._id,
        ])
        setHasAdminClaim(isAdmin)
      }
    }

    checkPermissions()
  }, [Meteor.userId()])

  // The app's navigation: one list, shown in the drawer beside every page and, on a canvas, in the
  // menu the header's ≡ opens. A guest is offered only what a guest can use.
  const signedIn = Boolean(loadedUser && !loadedUser.isAnonymous)
  const guest = Boolean(loadedUser?.isAnonymous)
  const team = loadedUser?.isEducationCertified ? 'classroom' : 'team'
  const Team = loadedUser?.isEducationCertified ? 'Classroom' : 'Team'
  const drawerItems = [
    {
      title: 'Create slate',
      path: '/new',
      icon: <AddIcon />,
      show: true,
      primary: true,
    },
    {
      title: 'My slates',
      path: '/',
      icon: <DashboardIcon />,
      show: true,
    },
    {
      // The shared library: smart components, slates and presentations anyone can use, signed in or not.
      title: 'Library',
      path: '/library',
      icon: <LibraryBooksIcon />,
      show: true,
    },
    {
      // Outside agents and Google, connected once and invited onto any slate (enterprise code only).
      title: 'Integrations',
      path: '/integrations',
      icon: <HubOutlinedIcon />,
      show: signedIn && enterpriseState(Meteor.settings).unlocked,
    },
    {
      title: loadedUser?.orgId ? `Manage ${team}` : `Create ${team}`,
      path: '/team',
      icon: <GroupIcon />,
      group: Team,
      show:
        signedIn &&
        (hasTeamManagementClaims ||
          (!loadedUser?.isAnonymous && !loadedUser?.orgId)),
    },
    {
      title: `${Team} slates`,
      path: '/team/slates',
      icon: <ViewComfy />,
      group: Team,
      show:
        signedIn && loadedUser?.orgId &&
        (hasTeamSlatesClaims ||
          slateAccess.find((sa) => sa.userId === Meteor.userId())),
    },
    {
      title: `${Team} settings`,
      path: '/team/settings',
      icon: <SettingsIcon />,
      group: Team,
      show: signedIn && hasAdminClaim && loadedUser?.orgId,
    },
    {
      title: 'Brand kit',
      path: '/team/branding',
      icon: <PaletteIcon />,
      group: Team,
      show: signedIn && hasAdminClaim && loadedUser?.orgId,
    },
  ].filter((item) => item.show)

  // The list itself. `collapsed` is the icon-only rail beside pages on a wide screen.
  const navList = ({ collapsed = false, onNavigate, extra = null } = {}) => {
    const rowSx = { mx: .5, mb: .25, borderRadius: 1, color: 'shell.ink',
      '&.Mui-selected, &.Mui-selected:hover': { color: 'shell.selectedInk', bgcolor: 'shell.selected' } }
    const row = (item) => {
      const isSelected = location.pathname === item.path
      if (item.primary && !collapsed) {
        return <Box component="li" key={item.path} sx={{ listStyle: 'none', px: 1, pb: 1 }}>
          <Button component={Link} to={item.path} onClick={onNavigate} fullWidth variant="contained" color="primary"
            disableElevation startIcon={item.icon} sx={{ borderRadius: 6, py: 1, fontWeight: 700 }}>{item.title}</Button>
        </Box>
      }
      return <Box component="li" key={item.path} sx={{ listStyle: 'none' }}><Tooltip placement="right" title={collapsed ? item.title : ''}>
        <ListItemButton component={Link} onClick={onNavigate} to={item.path} selected={isSelected}
          aria-current={isSelected ? 'page' : undefined} sx={rowSx}>
          <ListItemIcon sx={{ color: 'inherit' }}>{item.icon}</ListItemIcon>
          <ListItemText primary={item.title} sx={{ ml: -2, color: 'inherit' }} />
        </ListItemButton>
      </Tooltip></Box>
    }
    const groups = [...new Set(drawerItems.filter((item) => item.group).map((item) => item.group))]
    return <List aria-label="Pages">
      {drawerItems.filter((item) => !item.group).map(row)}
      {extra && <Box component="li" sx={{ listStyle: 'none' }}>{extra}</Box>}
      {groups.map((group) => <React.Fragment key={group}>
        {!collapsed && <ListSubheader disableSticky sx={{ bgcolor: 'transparent', color: 'shell.secondaryInk',
          lineHeight: '32px', fontSize: 12, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase' }}>{group}</ListSubheader>}
        {drawerItems.filter((item) => item.group === group).map(row)}
      </React.Fragment>)}
    </List>
  }

  // `onDone` closes the menu the row sits in, so the support chat is not left under it.
  const helpRow = ({ collapsed = false, onDone } = {}) => <Box component="li" sx={{ listStyle: 'none' }}><Tooltip placement="right" title={collapsed ? 'Help and support' : ''}>
    <ListItemButton onClick={() => { onDone?.(); handleSupport() }} sx={{ mx: .5, borderRadius: 1, color: 'shell.ink' }}>
      <ListItemIcon sx={{ color: 'inherit' }}><HelpOutlineIcon /></ListItemIcon>
      <ListItemText primary="Help and support" sx={{ ml: -2 }} />
    </ListItemButton>
  </Tooltip></Box>

  const closeCanvasNav = () => setCanvasNavOpen(false)
  const canvasNav = (
    <Drawer anchor="left" open={canvasNavOpen} onClose={closeCanvasNav}
      slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-label': 'Menu', sx: { width: 'min(300px, calc(100vw - 48px))', bgcolor: 'shell.surface', color: 'shell.ink',
        backgroundImage: 'none', display: 'flex', flexDirection: 'column' } } }}>
      <Box component="nav" aria-label="Slatebox" sx={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, minHeight: 64, borderBottom: 1, borderColor: 'shell.border' }}>
          <IconButton color="inherit" aria-label="Close menu" onClick={closeCanvasNav}><CloseIcon /></IconButton>
          <img src="/brand/slatebox.svg" alt="" width="26" height="26" />
          <Typography sx={{ fontWeight: 750, letterSpacing: '-.04em', fontSize: 21 }}>Slatebox</Typography>
        </Box>
        {guest && <Box sx={{ m: 1.5, mb: .5, p: 1.5, border: 1, borderColor: 'shell.border', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ mb: 1.25 }}>You are working as a guest. Save your work to keep your slates in an account.</Typography>
          <Button fullWidth variant="contained" color="primary" disableElevation startIcon={<SaveIcon />} sx={{ borderRadius: 6 }}
            onClick={() => { closeCanvasNav(); saveYourWork() }}>Save your work</Button>
        </Box>}
        <Box sx={{ pt: 1 }}>{navList({ onNavigate: closeCanvasNav, extra: narrow && signedIn ? <MessagesMenu variant="row" onFollow={closeCanvasNav} /> : null })}</Box>
        {!loadedUser && <List><Box component="li" sx={{ listStyle: 'none' }}><ListItemButton component={Link} to="/login" onClick={closeCanvasNav} sx={{ mx: .5, borderRadius: 1 }}>
          <ListItemIcon sx={{ color: 'inherit' }}><LoginIcon /></ListItemIcon><ListItemText primary="Sign in" sx={{ ml: -2 }} />
        </ListItemButton></Box></List>}
        <Box sx={{ flex: 1 }} />
        <List sx={{ borderTop: 1, borderColor: 'shell.border' }}>{helpRow({ onDone: closeCanvasNav })}</List>
      </Box>
    </Drawer>
  )

  // if (!userName.current && !Meteor.loggingIn() && !Meteor.user()) {
  //   createAnonymousUser()
  // }

  const appBarAndDrawer = (
    <>
      <AppBar
        position="fixed"
        sx={{
          bgcolor: 'shell.surface',
          color: 'shell.ink',
          boxShadow: 'none',
          borderBottom: 1, borderColor: 'shell.border',
          zIndex: (theme) => theme.zIndex.drawer + 1,
          transition: (theme) =>
            theme.transitions.create(['width', 'margin'], {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          ...(isMainDrawerOpen && mdmq &&
            !isOnCanvas && {
              marginLeft: drawerWidth.current,
              width: `calc(100% - ${drawerWidth.current}px)`,
              transition: (theme) =>
                theme.transitions.create(['width', 'margin'], {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.enteringScreen,
                }),
            }),
        }}
      >
        {isOnCanvas ? <CanvasToolbar slate={slate} user={loadedUser} title={slateName} privacy={getSlatePrivacy}
          manage={getCanManageSlate} busy={areAIRequestsOutstanding} huddle={getSlateHuddleType} onSettings={handleSettings} onOutput={handleOutput}
          onHistory={handleSnapshots} onShare={() => setOpenShareDialog(true)}
          onRename={setSlateName} navOpen={canvasNavOpen} onOpenNav={() => setCanvasNavOpen(true)} /> :
          <Toolbar sx={{ gap: 1.5, minHeight: '64px !important' }}>
            {loadedUser && (!mdmq || !isMainDrawerOpen) && <IconButton color="inherit" aria-label="Open navigation" onClick={handleDrawerOpen}><MenuIcon /></IconButton>}
            <Box component={Link} to="/" aria-label="My slates" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: 'inherit', textDecoration: 'none' }}>
              <img src="/brand/slatebox.svg" alt="" width="29" height="29" />
              <Typography sx={{ fontWeight: 750, letterSpacing: '-.04em', fontSize: 22 }}>Slatebox</Typography>
            </Box>
            {orgName && mdmq && <Typography noWrap sx={{ color: 'shell.secondaryInk', borderLeft: 1, borderColor: 'shell.border', pl: 2 }}>{orgName}</Typography>}
            <Box sx={{ flex: 1 }} />
            {signedIn && <MessagesMenu />}
            {guest && <Button variant="outlined" color="inherit" startIcon={<SaveIcon />} onClick={saveYourWork}>Save your work</Button>}
            <AccountMenu sheet={narrow} />
          </Toolbar>}
      </AppBar>
      {isOnCanvas && canvasNav}
      {Meteor.user() && !embeddedSlate && !isOnCanvas && (
        <SwipeableDrawer
          variant={mdmq ? "permanent" : "temporary"}
          anchor="left"
          sx={{
            width:
              !mdmq ? 0 : isMainDrawerOpen && !isOnCanvas
                ? `${drawerWidth.current}px`
                : shrunkDrawerWidth,
            marginTop: isOnCanvas ? shrunkDrawerWidth : '0px',
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              bgcolor: 'shell.surface',
              color: 'shell.ink',
              width:
                (!mdmq || isMainDrawerOpen) && !isOnCanvas
                  ? `${drawerWidth.current}px`
                  : shrunkDrawerWidth,
              boxSizing: 'border-box',
              overflowX: 'hidden',
              whiteSpace: 'nowrap',
              transition: (theme) =>
                theme.transitions.create('width', {
                  easing: theme.transitions.easing.sharp,
                  duration: theme.transitions.duration.enteringScreen,
                }),
              ...(isMainDrawerOpen && !isOnCanvas
                ? {}
                : {
                    transition: (theme) =>
                      theme.transitions.create('width', {
                        easing: theme.transitions.easing.sharp,
                        duration: theme.transitions.duration.leavingScreen,
                      }),
                    width: (theme) => theme.spacing(7),
                  }),
            },
          }}
          open={(mdmq ? isMainDrawerOpen : mobileNavOpen) && !isOnCanvas}
          onOpen={handleDrawerOpen}
          onClose={handleDrawerClose}
        >
          <>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '12px',
                minHeight: '64px',
                bgcolor: 'shell.surface',
              color: 'shell.ink',
                borderBottom: 1, borderColor: 'shell.border',
              }}
            >
              <IconButton aria-label="Collapse navigation" color="inherit" onClick={handleDrawerClose}>
                <ChevronLeftIcon />
              </IconButton>
            </Box>
            <Divider />
          </>
          {navList({ collapsed: mdmq && !isMainDrawerOpen, onNavigate: () => { if (!mdmq) handleDrawerClose() } })}
          <Box sx={{ flex: 1 }} />
          <List sx={{ borderTop: 1, borderColor: 'shell.border' }}>{helpRow({ collapsed: mdmq && !isMainDrawerOpen })}</List>
        </SwipeableDrawer>
      )}
    </>
  )

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        position: 'fixed',
        width: '100%',
        top: 0,
        left: 0,
      }}
    >
      <CssBaseline />
      <LoadHeap />
      <ChatWootConfig />
      <ThemeProvider theme={sbTheme} defaultMode="light">
        {!isOnPresentPage && <ConnectionStatus />}
        {!embeddedSlate && appBarAndDrawer}
        <MainPaper
          isOnCanvas={isOnCanvas}
          embeddedSlate={embeddedSlate}
          loadedUser={loadedUser}
        />
        <MessageListener />
        {!slate?.options?.isEmbedded && !embeddedSlate && (
          // The cookie notice: a small card in the corner, and on a phone one slim line along the
          // foot that the canvas pages leave room for (main.css --sb-cookie-strip), so it never
          // lies over + Add, the bar or the message box.
          <CookieNotice sx={theme => ({
            '&.sb-cookie': {
              position: 'fixed', right: 'max(12px, env(safe-area-inset-right))',
              bottom: 'max(12px, env(safe-area-inset-bottom)) !important',
              zIndex: theme.zIndex.drawer + 2, display: 'flex', alignItems: 'center', gap: 1.5,
              width: 'max-content', maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box',
              p: '10px 12px', fontSize: 13, lineHeight: 1.4, margin: 0, borderRadius: 2,
              bgcolor: '#fffef8', color: '#193c2f', border: '1px solid #a5bba7',
              boxShadow: '0 4px 18px #182b2026',
              ...theme.applyStyles('dark', { bgcolor: '#263c30', color: '#f5f3e9', borderColor: '#667d68' }),
              [theme.breakpoints.down('sm')]: { left: 'max(8px, env(safe-area-inset-left))', right: 'max(8px, env(safe-area-inset-right))', bottom: 'max(8px, env(safe-area-inset-bottom)) !important', width: 'auto', maxWidth: 'none', height: 40, p: '0 4px 0 14px', gap: 1, borderRadius: 20, boxShadow: '0 2px 10px #182b201f' },
            },
            '& .sb-cookie-text': { m: 0, minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            '& button': { whiteSpace: 'nowrap', cursor: 'pointer', border: 0, margin: 0, flex: 'none' },
            // Got it is a finger's size to touch (44px each way) however slim it is drawn: its touch area reaches past it.
            '& #rcc-confirm-button': { position: 'relative', minWidth: 44 },
            '& #rcc-confirm-button::after': { content: '""', position: 'absolute', top: '50%', left: '50%', width: 'max(100%, 44px)', height: 'max(100%, 44px)', transform: 'translate(-50%, -50%)' },
            [theme.breakpoints.down('sm')]: { '& #rcc-confirm-button': { padding: '4px 14px !important', borderRadius: '16px !important', fontSize: 13, lineHeight: '24px' } },
          })} />
        )}
      </ThemeProvider>
    </Box>
  )
}
