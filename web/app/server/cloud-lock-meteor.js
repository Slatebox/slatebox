/* eslint-disable no-console */
// The Meteor side of server/cloud-lock.mjs: payments and the meter run only where this server is
// Slatebox Cloud by its signed Cloud key. Imported first by server/pay-settings-startup.js, which
// tells browsers (applyCloudLock) before any loads, and by every payment and meter module.
import { Meteor } from 'meteor/meteor'
import { CLOUD_LOCK_LINES, CLOUD_ONLY, CLOUD_ONLY_WORDS, createCloudLock } from './cloud-lock.mjs'

const lock = createCloudLock({ settings: Meteor.settings, env: process.env })

/** Whether this server is Slatebox Cloud by its Cloud key (checked live, remembered a minute). */
export const cloudOn = () => lock.on()
/** Whether payments may run here: Cloud, and a Stripe secret key set. */
export const paymentsOn = () => lock.payments()
/** Refuses a payment method with 'cloud_only' where the lock is closed. */
export function requireCloudLicense() {
  if (!lock.on()) throw new Meteor.Error(CLOUD_ONLY, CLOUD_ONLY_WORDS)
}

// the one line at start
console.log(lock.on() ? CLOUD_LOCK_LINES.on : CLOUD_LOCK_LINES.off)
