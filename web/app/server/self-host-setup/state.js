// Whether this self-hosted server still waits for its first admin (core.mjs). Kept apart from
// meteor.js so that methods (users.identify) can ask without importing the setup routes.
import { Meteor } from 'meteor/meteor'
import { SystemSettings } from '../../imports/api/common/models'
import { SETUP_ID, setupApplies } from './core.mjs'

export const setupAppliesHere = setupApplies(Meteor.settings)
let setUp = false

export const markSetUp = () => { setUp = true }

/** Whether this server still waits for its first admin. Always false on Slatebox Cloud. */
export async function setupRequired() {
  if (!setupAppliesHere || setUp) return false
  const doc = await SystemSettings.findOneAsync({ _id: SETUP_ID }, { fields: { completedAt: 1 } })
  if (doc?.completedAt) setUp = true
  return !setUp
}
