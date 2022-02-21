import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { Redirect, Route, Switch, useParams } from 'react-router-dom';
import { MySlates } from './pages/MySlates.jsx';
import { TeamSlates } from './pages/TeamSlates.jsx';
import { CommunitySlates } from './pages/CommunitySlates.jsx';
import { Team } from './pages/Team.jsx';
import { Profile } from './pages/Profile.jsx';
import { Canvas } from './pages/Canvas.jsx';
import { Login } from './pages/Login.jsx';
import { RecoverPassword } from './pages/RecoverPassword.jsx';
import { ResetPassword } from './pages/ResetPassword.jsx';
import { VerifyEmail } from './pages/VerifyEmail.jsx';
import { NotFound } from './pages/NotFound.jsx';
import { AdminTools } from './pages/AdminTools.jsx';
import { promisify } from '../api/client/promisify.js';
import { TeamSettings } from './pages/TeamSettings.jsx';
import { SimulateUrlAction } from './components/SimulateUrlAction.jsx';
import AuthManager from '../api/common/AuthManager.js';
import { CONSTANTS } from '../api/common/constants.js';
import { SlateTemplates } from './pages/SlateTemplates.jsx';
import { ShowThemes } from './pages/ShowThemes.jsx';

const PrivateRoute = ({ component: Component, ...rest }) => {
  let isAuthorized = (Meteor.loggingIn && (Meteor.loggingIn() || Meteor.userId()));
  let redirectLocale = "/login";
  // if (rest.withCondition) {
  //   const { id } = useParams();
  //   let getSlate = await promisify(Meteor.call, CONSTANTS.methods.slates.get, { shareId: id });
  //   if (getSlate?.accessLevel) {
  //     isAuthorized = true;
  //     rest.getSlate = getSlate;
  //   } else if (isAuthorized) {
  //     isAuthorized = false;
  //     redirectLocale = "/unauthorized";
  //   }
  // }
  return (<Route {...rest} render={(props) => { 
    return (isAuthorized ? <Component {...props} /> : <Redirect to={redirectLocale} />);
  }} />);
};

export const Routes = () => {
  return (
    <Switch>
      <PrivateRoute component={MySlates} exact path="/" />
      <PrivateRoute component={SlateTemplates} path="/templates" />
      <PrivateRoute component={ShowThemes} path="/themes" />
      <PrivateRoute component={Profile} path="/profile" />
      <PrivateRoute component={TeamSlates} path="/team/slates" />
      <PrivateRoute component={TeamSettings} path="/team/settings" />
      <PrivateRoute component={Team} path="/team" />
      {AuthManager.userHasClaim(Meteor.userId(), [CONSTANTS.claims.uberMensch._id]) && <PrivateRoute component={AdminTools} path="/admin" /> }
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
        <ResetPassword asEnroll={true} />
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
      {Meteor.settings.public.env === "dev" && 
        <Route path="/simulate/:type/:identifier">
          <SimulateUrlAction />
        </Route>
      }
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}