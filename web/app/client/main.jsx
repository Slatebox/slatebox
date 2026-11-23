/* eslint-disable no-underscore-dangle */
import React, { Suspense, lazy, useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { createRoot } from 'react-dom/client'
import { Provider, useAtom } from 'jotai'
import { BrowserRouter as Router, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import { ThemeProvider, useColorScheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import sbTheme from '../imports/ui/common/muiThemes'
import App from '../imports/ui/App'
import NewCreativeSlate from '../imports/ui/pages/NewCreativeSlate'
import GetStarted from '../imports/ui/pages/GetStarted'
import Login from '../imports/ui/pages/Login'
import { globalMessage } from '../imports/ui/jotai/atoms'
// Loads the enterprise/ browser chunk after start where the server says it is unlocked (Cloud, or a
// licensed self-hosted install); a locked install loads nothing.
import './enterprise'

// Pages a first visit to a slate never opens: each loads when its route is first opened.
const Present = lazy(() => import('../imports/ui/pages/Present'))
const Workshops = lazy(() => import('../imports/ui/pages/DecisionWorkshopPage.jsx'))
const OAuthConsent = lazy(() => import('../imports/ui/pages/OAuthConsent'))
import './i18n/en/common.i18n.json'
import './i18n/en/slates.i18n.json'
import './i18n/en/nodeDrawer.i18n.json'
import './i18n/en/profile.i18n.json'
import './i18n/en/chat.i18n.json'
import './i18n/en/teamSettings.i18n.json'

function CreationEntry({ alias = false }) {
  const { search, hash } = useLocation()
  if (alias) return <Navigate replace to={'/new' + search + hash} />
  if (hash) return <NewCreativeSlate fromBrief />
  return <GetStarted />
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
        <Suspense fallback={null}>
        <Routes>
          <Route path="/workshops" element={<Workshops />} />
          <Route path="/present/:slateShareId" element={<Present />} />
          <Route path="/start" element={<CreationEntry alias />} />
          <Route path="/canvas/new" element={<CreationEntry alias />} />
          <Route path="/new/:creativeKind" element={<NewCreativeSlate />} />
          <Route path="/new" element={<CreationEntry />} />
          <Route path="/login/:email?" element={<Login />} />
          <Route path="/oauth/consent" element={<OAuthConsent />} />
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
