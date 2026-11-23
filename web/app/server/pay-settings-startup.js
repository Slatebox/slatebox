/* eslint-disable no-console */
// Checks the in-app pay settings once, before any browser loads (pay-settings.mjs). Meteor sends
// Meteor.settings.public to every browser by reference, so the computed public.stripe.inApp (and a
// removed secret) is what browsers see. A bad setting logs loudly and falls back to the hosted page.
import { Meteor } from 'meteor/meteor'
import { applyPaySettings } from './pay-settings.mjs'

const out = applyPaySettings(Meteor.settings, text => console.error('[payments]', text))
if (out.inApp) console.log(`[payments] in-app payments are on (${out.publishableKey.slice(0, 8)}…)`)
