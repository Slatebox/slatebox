/* eslint-disable no-console */
// Checks the in-app pay settings once, before any browser loads (pay-settings.mjs). Meteor sends
// Meteor.settings.public to every browser by reference, so the computed public.stripe.inApp (and a
// removed secret) is what browsers see. A bad setting logs loudly and falls back to the hosted page.
import { Meteor } from 'meteor/meteor'
import { applyPaySettings } from './pay-settings.mjs'
import { applyCloudLock } from './cloud-lock.mjs'
import { cloudOn } from './cloud-lock-meteor'

const out = applyPaySettings(Meteor.settings, text => console.error('[payments]', text))
// payments run only on Slatebox Cloud by its Cloud key (cloud-lock.mjs): elsewhere browsers are
// told there are none (public.payments.cloud false, in-app off, no publishable key)
const cloud = cloudOn()
applyCloudLock(Meteor.settings, cloud)
if (out.inApp && cloud) console.log(`[payments] in-app payments are on (${out.publishableKey.slice(0, 8)}…)`)
