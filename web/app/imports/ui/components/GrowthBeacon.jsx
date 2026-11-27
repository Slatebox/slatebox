// The growth funnel's browser side (imports/api/common/growth.mjs, server/growth/): on Slatebox
// Cloud only, one small report per page load, one when someone signs in or a guest account starts
// during it, and one when the tab comes back after a while. It draws nothing, loads no script and
// sets no cookie. With Do Not Track or Global Privacy Control on, it sends nothing, removes its
// local entry and asks the server to forget what it kept for the account.
import { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../api/common/constants'
import { forgetRemembered, growthOn, planVisit, privacySignal, readRemembered, remember } from '../../api/common/growth.mjs'

// Where this page load started, read before the router can change the address.
const initial = typeof window === 'undefined'
  ? { search: '', path: '/', referrer: '' }
  : { search: window.location.search, path: window.location.pathname, referrer: document.referrer }

const AGAIN_AFTER_MS = 15 * 60_000
let plan = null
let reported = false
let lastAt = 0
let lastUser
let forgotten = false

function report(userId) {
  if (!plan) {
    plan = planVisit({ location: initial, remembered: readRemembered() })
    remember(plan.keep)
  }
  // the load's first report carries the landing and the first visit; later ones only who is here
  const input = reported
    ? { source: plan.keep.s, campaign: plan.keep.c, first: false, tagged: false, since: plan.keep.d }
    : { ...plan.send, since: plan.keep.d }
  reported = true
  lastAt = Date.now()
  lastUser = userId
  Meteor.callAsync(CONSTANTS.methods.growth.visit, input).catch(() => {})
}

export default function GrowthBeacon() {
  const { userId, loggingIn } = useTracker(() => ({ userId: Meteor.userId(), loggingIn: Meteor.loggingIn() }))

  useEffect(() => {
    if (loggingIn || !growthOn(Meteor.settings)) return
    if (privacySignal()) {
      forgetRemembered()
      if (userId && !forgotten) {
        forgotten = true
        Meteor.callAsync(CONSTANTS.methods.growth.forget).catch(() => {})
      }
      return
    }
    if (!reported || userId !== lastUser) report(userId)
  }, [userId, loggingIn])

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const back = () => {
      if (document.visibilityState !== 'visible' || !reported || Date.now() - lastAt < AGAIN_AFTER_MS) return
      if (!growthOn(Meteor.settings) || privacySignal() || Meteor.loggingIn()) return
      report(Meteor.userId())
    }
    document.addEventListener('visibilitychange', back)
    return () => document.removeEventListener('visibilitychange', back)
  }, [])

  return null
}
