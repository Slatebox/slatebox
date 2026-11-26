/* eslint-disable no-underscore-dangle */
import React, { Suspense, lazy, useEffect, useRef } from 'react'
import { Meteor } from 'meteor/meteor'
import { createRoot } from 'react-dom/client'
import { Provider, useAtom } from 'jotai'
import { BrowserRouter as Router, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider, useColorScheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import sbTheme from '../imports/ui/common/muiThemes'
import App from '../imports/ui/App'
import NewCreativeSlate from '../imports/ui/pages/NewCreativeSlate'
import GetStarted from '../imports/ui/pages/GetStarted'
import FirstSlate from '../imports/ui/pages/FirstSlate'
import SlateLoading from '../imports/ui/components/SlateLoading'
import { useTracker } from 'meteor/react-meteor-data'
import { creationRoute } from '../imports/api/common/first-slate-route.mjs'
import { STORAGE_KEY } from '../imports/api/common/first-slate.mjs'
import CONSTANTS from '../imports/api/common/constants'
import Login from '../imports/ui/pages/Login'
import GuestStartGate from '../imports/ui/components/GuestStartGate'
import { SsoDone, SsoGate } from '../imports/ui/sso/sso'
import { globalMessage } from '../imports/ui/jotai/atoms'
// Sign out, and a session ending while a page is open, lead to the sign-in page.
import '../imports/api/client/signOut'
// Loads the enterprise/ browser chunk after start where the server says it runs (Cloud, and every
// self-hosted install whose build carries it); elsewhere nothing loads.
import './enterprise'

// Pages a first visit to a slate never opens: each loads when its route is first opened.
const Present = lazy(() => import('../imports/ui/pages/Present'))
const Workshops = lazy(() => import('../imports/ui/pages/DecisionWorkshopPage.jsx'))
const OAuthConsent = lazy(() => import('../imports/ui/pages/OAuthConsent'))
const DeviceSignIn = lazy(() => import('../imports/ui/pages/DeviceSignIn'))
const TeamMoveJoin = lazy(() => import('../imports/ui/pages/TeamMoveJoin'))
import './i18n/en/common.i18n.json'
import './i18n/en/slates.i18n.json'
import './i18n/en/nodeDrawer.i18n.json'
import './i18n/en/profile.i18n.json'
import './i18n/en/chat.i18n.json'
import './i18n/en/teamSettings.i18n.json'

const storedStart = () => { try { return localStorage.getItem(STORAGE_KEY) } catch { return null } }

// /new: a brief or a source opens it; a retired source goes back to /new; with no hash, the first run for
// someone who has not answered it (first-slate-route.mjs), else a blank slate.
function CreationEntry({ alias = false }) {
  const { search, hash } = useLocation()
  // Who is here: nobody yet, a guest, or a member (whose next slate is blank: the first run is for newcomers).
  const account = useTracker(() => {
    if (Meteor.loggingIn()) return { loading: true }
    if (!Meteor.userId()) return { profileStart: null }
    if (!Meteor.subscribe(CONSTANTS.publications.users.me).ready()) return { loading: true }
    const user = Meteor.user()
    if (typeof user?.isAnonymous !== 'boolean') return { loading: true }
    return { profileStart: user.profile?.start ?? null, member: !user.isAnonymous, tiles: user.profile?.startTiles ?? 0 }
  }, [])
  // Decided once per address: the first run makes the guest itself (a login), and must not be swapped out while it does.
  const decided = useRef(null)
  if (alias) return <Navigate replace to={'/new' + search + hash} />
  if (decided.current?.at !== search + hash) decided.current = null
  const route = decided.current?.route ?? creationRoute({ hash, search, profileStart: account.profileStart, member: account.member, stored: storedStart(), tiles: account.tiles })
  if (!account.loading && (route === 'first' || route === 'blank')) decided.current ??= { at: search + hash, route }
  if (route === 'retired') return <Navigate replace to="/new" />
  if (route === 'brief') return <GuestStartGate><NewCreativeSlate fromBrief /></GuestStartGate>
  // A session resuming: its answer is read before choosing.
  if (account.loading && !decided.current) return <Box component="main"><SlateLoading /></Box>
  return <GuestStartGate>{route === 'first' ? <FirstSlate /> : <GetStarted />}</GuestStartGate>
}

// New AppWrapper component
function AppWrapper() {
  const [message, setGlobalMessage] = useAtom(globalMessage)
  const { mode, setMode } = useColorScheme()
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.metaKey && e.key === 'j') {
        setMode(mode === 'dark' ? 'light' : 'dark')
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => {
      window.removeEventListener('keydown', handleKeyPress) 
    }
  }, [mode, setMode])
  const handleClose = () => {
    setGlobalMessage({
      visible: false,
      isSnackBar: true,
      text: '',
      severity: 'info',
      autoHide: 10000,
    })
  }

  return (
    <>
      <Snackbar
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        open={message.visible}
        onClose={handleClose}
        id="sbGlobalMessage"
        autoHideDuration={message.autoHide || 10000}
        sx={{
          position: 'fixed',
          zIndex: 10000,
        }}
      >
        {/* message.action: one way on, e.g. a refusal's "Top up" (PayNotice.jsx usePayAction) */}
        <Alert severity={message.severity}
          action={message.action ? <Button color="inherit" size="small" onClick={() => { handleClose(); message.action.run() }}>{message.action.label}</Button> : undefined}>
          {message.text}
          {message.line2 ? (
            <>
              <br />
              {message.line2}
            </>
          ) : (
            ''
          )}
        </Alert>
      </Snackbar>
      <Router>
        <SsoGate />
        <Suspense fallback={null}>
        <Routes>
          <Route path="/workshops" element={<Workshops />} />
          <Route path="/present/:slateShareId" element={<Present />} />
          <Route path="/start" element={<CreationEntry alias />} />
          <Route path="/canvas/new" element={<CreationEntry alias />} />
          <Route path="/new/:creativeKind" element={<GuestStartGate><NewCreativeSlate /></GuestStartGate>} />
          <Route path="/new" element={<CreationEntry />} />
          <Route path="/login/:email?" element={<Login />} />
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          <Route path="/device" element={<DeviceSignIn />} />
          <Route path="/team-move/join" element={<TeamMoveJoin />} />
          <Route path="/sso/done" element={<SsoDone />} />
          <Route path="/*" element={<App />} />
        </Routes>
        </Suspense>
      </Router>
    </>
  )
}

Meteor.startup(() => {
  // options
  // i18n.setOptions({
  //   hostUrl: `${Meteor.settings.public.baseUrl}/`,
  // })
  const root = createRoot(document.querySelector('#react-target'))
  root.render(
    <Provider>
      <ThemeProvider theme={sbTheme} defaultMode="light">
        <CssBaseline />
        <AppWrapper />
      </ThemeProvider>
    </Provider>
  )

  // swallow debug messages
  Meteor._debug = (function (superMeteorDebug) {
    return function (error, info) {
      if (error !== 'discarding unknown livedata message type') {
        superMeteorDebug(error, info)
      }
    }
  })(Meteor._debug)
})
