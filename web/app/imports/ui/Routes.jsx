import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Redirect, Route, Switch } from 'react-router-dom'
import { MySlates } from './pages/MySlates'
import { TeamSlates } from './pages/TeamSlates'
import { CommunitySlates } from './pages/CommunitySlates'
import { Team } from './pages/Team'
import { Profile } from './pages/Profile'
import Canvas from './pages/Canvas'
import { Login } from './pages/Login'
import { RecoverPassword } from './pages/RecoverPassword'
import { ResetPassword } from './pages/ResetPassword'
import { VerifyEmail } from './pages/VerifyEmail'
import { NotFound } from './pages/NotFound'
import { AdminTools } from './pages/AdminTools'
import { TeamSettings } from './pages/TeamSettings'
import { StripeManagement } from './components/StripeManagement'
import { SimulateUrlAction } from './components/SimulateUrlAction'
import AuthManager from '../api/common/AuthManager'
import { CONSTANTS } from '../api/common/constants'
import { SlateTemplates } from './pages/SlateTemplates'
import { ShowThemes } from './pages/ShowThemes'

function PrivateRoute({ component: Component, ...rest }) {
  const isAuthorized =
    Meteor.loggingIn && (Meteor.loggingIn() || Meteor.userId())
  const redirectLocale = '/login'
  return (
    <Route
      {...rest}
      render={(props) =>
        isAuthorized ? (
          <Component {...props} />
        ) : (
          <Redirect to={redirectLocale} />
        )
      }
    />
  )
}

export default function Routes() {
  return (
    <Switch>
      <PrivateRoute component={MySlates} exact path="/" />
      <PrivateRoute component={SlateTemplates} path="/templates" />
      <PrivateRoute component={ShowThemes} path="/themes" />
      <PrivateRoute component={Profile} path="/profile" />
      <PrivateRoute component={TeamSlates} path="/team/slates" />
      <PrivateRoute component={TeamSettings} path="/team/settings" />
      <PrivateRoute component={Team} path="/team" />
      <PrivateRoute component={StripeManagement} path="/success" />
      {AuthManager.userHasClaim(Meteor.userId(), [
        CONSTANTS.claims.uberMensch._id,
      ]) && <PrivateRoute component={AdminTools} path="/admin" />}
      <Route path="/canvas/:id?/:nodeId?">
        <Canvas />
      </Route>
      <Route path="/login/:email?">
        <Login />
      </Route>
      <Route path="/verify-email/:token">
        <VerifyEmail />
      </Route>
      <Route path="/enroll-account/:token">
        <ResetPassword asEnroll />
      </Route>
      <Route path="/recover/:email?">
        <RecoverPassword />
      </Route>
      <Route path="/reset-password/:token">
        <ResetPassword />
      </Route>
      <Route path="/slates">
        <CommunitySlates />
      </Route>
      {Meteor.settings.public.env === 'dev' && (
        <Route path="/simulate/:type/:identifier">
          <SimulateUrlAction />
        </Route>
      )}
      <Route>
        <NotFound />
      </Route>
    </Switch>
  )
}
