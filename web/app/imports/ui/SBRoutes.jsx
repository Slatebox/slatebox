/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable react/jsx-boolean-value */
/* eslint-disable no-underscore-dangle */
import React, { Suspense, lazy, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import MySlates from './pages/MySlates'
import Canvas from './pages/Canvas'
import AIPassthrough from './pages/AIPassthrough'
import NotFound from './pages/NotFound'
import AuthManager from '../api/common/AuthManager'
import CONSTANTS from '../api/common/constants'
import CSSUnicorn from './components/ai/Unicorn'

// Pages a first visit never opens (a slate, the start page and My Slates stay in the first load): each loads
// when its route is first opened.
const TeamSlates = lazy(() => import('./pages/TeamSlates'))
const CommunitySlates = lazy(() => import('./pages/CommunitySlates'))
const Team = lazy(() => import('./pages/Team'))
const Profile = lazy(() => import('./pages/Profile'))
const RecoverPassword = lazy(() => import('./pages/RecoverPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const LoginLink = lazy(() => import('./pages/LoginLink'))
const SignUp = lazy(() => import('./pages/SignUp'))
const AdminTools = lazy(() => import('./pages/AdminTools'))
const TeamSettings = lazy(() => import('./pages/TeamSettings'))
const BrandingSettings = lazy(() => import('./pages/BrandingSettings'))
const SimulateUrlAction = lazy(() => import('./components/SimulateUrlAction'))
const ShowThemes = lazy(() => import('./pages/ShowThemes'))

function PrivateRoute({ children }) {
  const isAuthorized =
    Meteor.loggingIn && (Meteor.loggingIn() || Meteor.userId())
  if (!isAuthorized) {
    return <Navigate to="/start" replace />
  }

  return children
}

function SlateCreateRoute() {
  const [searchparams] = useSearchParams()
  const bearer = searchparams.get('bearer')
  const dateString = searchparams.get('dateString')
  const referralCode = searchparams.get('referralCode')
  const welcomeMessage = searchparams.get('welcomeMessage')
  const extendedPrompt = searchparams.get('extendedPrompt')
  const templateId = searchparams.get('templateId')
  const slateIdToCopy = searchparams.get('slateIdToCopy')
  const themeId = searchparams.get('themeId')
  const isEmbedded = searchparams.get('isEmbedded') === 'true'
  const intentionId = searchparams.get('intentionId')
  if (!bearer || !dateString) {
    return <Navigate to="/start" replace />
  }
  const [hasAuth, setAuth] = React.useState('unknown')
  useEffect(() => {
    async function checkAuth() {
      const isAuth = await Meteor.callAsync(
        CONSTANTS.methods.auth.isAuthenticated,
        {
          bearer,
          dateString,
        }
      )
      setAuth(isAuth ? 'authorized' : 'unauthorized')
    }
    checkAuth()
  }, [])

  if (hasAuth === 'unauthorized') {
    return <Navigate to="/start" replace />
  }
  if (hasAuth === 'authorized') {
    return (
      <AIPassthrough
        referralCode={!Meteor.userId() ? referralCode : null}
        slateIdToCopy={slateIdToCopy}
        welcomeMessage={welcomeMessage}
        extendedPrompt={extendedPrompt}
        templateId={templateId}
        themeId={themeId}
        isEmbedded={isEmbedded}
        intentionId={intentionId}
      />
    )
  }
  return <CSSUnicorn />
}

PrivateRoute.propTypes = {
  children: PropTypes.node.isRequired,
}

// A link from one slate to another (Make a copy, a notification) opens the other slate afresh.
function CanvasForSlate() {
  const { id } = useParams()
  return <Canvas key={id} />
}

export default function SBRoutes() {
  const [isElevatedUser, setElevatedUser] = useState(false)

  useEffect(() => {
    async function getElevatedUser() {
      const eu = await AuthManager.userHasClaim(
        Meteor.userId(),
        [CONSTANTS.claims.uberMensch._id],
        true
      )
      setElevatedUser(eu)
    }
    getElevatedUser()
  }, [Meteor.userId()])

  return (
    <Suspense fallback={null}>
    <Routes>
      <Route
        path="/"
        element={
          <PrivateRoute>
            <MySlates />
          </PrivateRoute>
        }
      />
      <Route
        path="/themes"
        element={
          <PrivateRoute>
            <ShowThemes />
          </PrivateRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <PrivateRoute>
            <Profile />
          </PrivateRoute>
        }
      />
      <Route
        path="/team/slates"
        element={
          <PrivateRoute>
            <TeamSlates />
          </PrivateRoute>
        }
      />
      <Route
        path="/team/settings"
        element={
          <PrivateRoute>
            <TeamSettings />
          </PrivateRoute>
        }
      />
      <Route
        path="/team/branding"
        element={
          <PrivateRoute>
            <BrandingSettings />
          </PrivateRoute>
        }
      />
      <Route
        path="/team"
        element={
          <PrivateRoute>
            <Team />
          </PrivateRoute>
        }
      />
      {isElevatedUser && (
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminTools />
            </PrivateRoute>
          }
        />
      )}
      <Route path="/canvas/:id?/:nodeId?/:asEmbed?" element={<CanvasForSlate />} />
      <Route path="/ai/:prompt?" element={<SlateCreateRoute />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/login-link/:token" element={<LoginLink />} />
      <Route
        path="/enroll-account/:token"
        element={<ResetPassword asEnroll={true} />}
      />
      <Route path="/recover/:email?" element={<RecoverPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/slates" element={<CommunitySlates />} />
      <Route path="/signup" element={<SignUp />} />
      {['dev', 'test'].includes(Meteor.settings.public.env) && (
        <Route
          path="/simulate/:type/:identifier"
          element={<SimulateUrlAction />}
        />
      )}
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
  )
}
