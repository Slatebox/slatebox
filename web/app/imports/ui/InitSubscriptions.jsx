/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../api/common/constants'

export default function InitSubscriptions({ children }) {
  const orgId = useTracker(() => Meteor.user()?.orgId, [])

  useTracker(() => {
    if (orgId) {
      Meteor.subscribe(CONSTANTS.publications.organizations)
      Meteor.subscribe(CONSTANTS.publications.orgUsers)
      Meteor.subscribe(CONSTANTS.publications.permissions)
      Meteor.subscribe(CONSTANTS.publications.claims)
    }
  }, [orgId])

  useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.users.me)
  }, [])

  return children
}
