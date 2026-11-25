/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable react/jsx-boolean-value */
/* eslint-disable no-underscore-dangle */
import React, { Suspense, lazy, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { businessSheetPath, oldProLink } from './components/billing/pay/pay-url.mjs'
import MySlates from './pages/MySlates'
import Canvas from './pages/Canvas'
import AIPassthrough from './pages/AIPassthrough'
import NotFound from './pages/NotFound'
import AuthManager from '../api/common/AuthManager'
import CONSTANTS from '../api/common/constants'
import CSSUnicorn from './components/ai/Unicorn'
import { enterpriseState } from '../api/common/edition.mjs'
import { signedOutPath } from '../api/client/signOut'

// Pages a first visit never opens (a slate, the start page and My Slates stay in the first load): each loads
// when its route is first opened.
const TeamSlates = lazy(() => import('./pages/TeamSlates'))
const Team = lazy(() => import('./pages/Team'))
const Profile = lazy(() => import('./pages/Profile'))
const GetPro = lazy(() => import('./pages/GetPro'))
const RecoverPassword = lazy(() => import('./pages/RecoverPassword'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'))
const LoginLink = lazy(() => import('./pages/LoginLink'))
const SignUp = lazy(() => import('./pages/SignUp'))
const AdminTools = lazy(() => import('./pages/AdminTools'))
const AIControl = lazy(() => import('./pages/admin/ai/AIControl'))
const TeamSettings = lazy(() => import('./pages/TeamSettings'))
const BrandingSettings = lazy(() => import('./pages/BrandingSettings'))
const SimulateUrlAction = lazy(() => import('./components/SimulateUrlAction'))
// The shared library: the public gallery and an item's page (signed out too), your own items, and the review queue.
const Library = lazy(() => import('./pages/Library'))
const Integrations = lazy(() => import('./pages/Integrations'))
const LibraryItem = lazy(() => import('./pages/LibraryItem'))
const MyLibrary = lazy(() => import('./pages/MyLibrary'))
const LibraryReview = lazy(() => import('./pages/LibraryReview'))

function PrivateRoute({ children }) {
  const isAuthorized =
    Meteor.loggingIn && (Meteor.loggingIn() || Meteor.userId())
  // Someone who signed out goes to the sign-in page; a first visit starts as a guest.
  if (!isAuthorized) {
    return <Navigate to={signedOutPath()} replace />
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
  const isEmbedded = searchparams.get('isEmbedded') === 'true'
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
        welcomeMessage={welcomeMessage}
        extendedPrompt={extendedPrompt}
        templateId={templateId}
        isEmbedded={isEmbedded}
      />
    )
  }
  return <CSSUnicorn />
}

// /profile. The old site link (/profile?tab=credits, ?buy=pro-monthly|pro-yearly) goes to /pro for
// anyone who is not a member yet, so nobody meets a sign-up wall before paying (pay-url.mjs oldProLink).
function ProfileRoute() {
  const [params] = useSearchParams()
  const credits = ['credits', 'free'].includes(params.get('tab'))
  const account = useTracker(() => {
    if (!credits) return 'skip'
    if (Meteor.loggingIn()) return 'loading'
    if (!Meteor.userId()) return 'none'
    if (!Meteor.subscribe(CONSTANTS.publications.users.me).ready()) return 'loading'
    const user = Meteor.user()
    if (typeof user?.isAnonymous !== 'boolean') return 'loading'
    return user.isAnonymous ? 'guest' : 'member'
  }, [credits])
  if (account === 'loading') return null
  // /profile?tab=integrations: the Integrations page, where enterprise code runs (Profile otherwise).
  if (params.get('tab') === 'integrations' && enterpriseState(Meteor.settings).unlocked) return <Navigate to="/integrations" replace />
  const to = account === 'skip' ? null : oldProLink(params, account)
  if (to) return <Navigate to={to} replace />
  return <PrivateRoute><Profile /></PrivateRoute>
}

PrivateRoute.propTypes = {
  children: PropTypes.node.isRequired,
}

// A link from one slate to another (Make a copy, a notification) opens the other slate afresh.
function CanvasForSlate() {
  const { id } = useParams()
  return <Canvas key={id} />
}

// /business?plan=monthly|yearly: the site's "Get Slatebox Business". The team page with the sheet
// preselected; the team page asks a visitor to sign in or make a team first (pay-url.mjs).
function GetBusiness() {
  const [params] = useSearchParams()
  return <Navigate replace to={businessSheetPath(params)} />
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
      <Route path="/profile" element={<ProfileRoute />} />
      <Route path="/integrations" element={<PrivateRoute><Integrations /></PrivateRoute>} />
      <Route path="/pro" element={<GetPro />} />
      <Route path="/business" element={<GetBusiness />} />
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
      {isElevatedUser && (
        <Route
          path="/admin/library"
          element={
            <PrivateRoute>
              <LibraryReview />
            </PrivateRoute>
          }
        />
      )}
      {isElevatedUser && (
        <Route
          path="/admin/ai"
          element={
            <PrivateRoute>
              <AIControl />
            </PrivateRoute>
          }
        />
      )}
      <Route path="/library" element={<Library />} />
      <Route
        path="/library/mine"
        element={
          <PrivateRoute>
            <MyLibrary />
          </PrivateRoute>
        }
      />
      <Route path="/library/:slug" element={<LibraryItem />} />
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
