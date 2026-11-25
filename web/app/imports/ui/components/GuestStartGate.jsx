// Pages that make a guest by themselves (the start page, a starter, Sign up). After a member signs out
// here, Back to one of them goes to the sign-in page rather than making a guest; opening one on purpose
// (a link or button, a typed or pasted address) still makes one (imports/api/common/sign-out.mjs).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Navigate } from 'react-router-dom'
import { useMayStartGuest } from '../../api/client/signOut'
import { SIGN_IN_PATH } from '../../api/common/sign-out.mjs'

export default function GuestStartGate({ children }) {
  const mayStart = useMayStartGuest()
  const { userId, loggingIn } = useTracker(() => ({ userId: Meteor.userId(), loggingIn: Meteor.loggingIn() }), [])
  if (!userId && !loggingIn && !mayStart) return <Navigate replace to={SIGN_IN_PATH} />
  return children
}
