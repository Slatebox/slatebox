/* eslint-disable no-underscore-dangle */
// methods.js
import { randomBytes } from 'node:crypto'
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../imports/api/common/constants'
import collaboratorDetails from '../common/collaborator-details.mjs'

// Keys a person when the collaboration relay's key pair is not set up: made once per server, so a
// person's tabs still count once (collaborator-details.mjs).
const PROCESS_SECRET = randomBytes(32).toString('hex')

const method = {}
method[CONSTANTS.methods.collaborators.init] = async ({ id, shareId } = {}) => collaboratorDetails({
  user: await Meteor.userAsync(),
  userId: Meteor.userId(),
  id,
  shareId,
  settings: Meteor.settings,
  fallbackSecret: PROCESS_SECRET,
})

Meteor.methods(method)
