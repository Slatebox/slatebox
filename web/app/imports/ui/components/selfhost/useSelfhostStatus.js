// What the header button and its panel know (the selfhost.status method): who asks, the team, the
// license and the flows under way. Asked once per account and shared; refresh() asks again.
// The enterprise state itself is live: enterprise code unlocked while the page is open re-renders
// every component that reads it (enterpriseClient.subscribe).
import React, { useSyncExternalStore } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { enterpriseClient } from '../../../api/client/enterprise-slots.mjs'
import { editionOf } from '../../../api/common/edition.mjs'

const asked = new Map()
const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

function statusFor(userId) {
  if (!asked.has(userId)) {
    asked.set(userId, Meteor.callAsync('selfhost.status').catch(() => {
      asked.delete(userId)
      return null
    }))
  }
  return asked.get(userId)
}

export function refreshSelfhostStatus() {
  asked.clear()
  notify()
}

/** Re-renders when enterprise code is unlocked on this page. */
export const useEnterpriseGeneration = () => useSyncExternalStore(enterpriseClient.subscribe, enterpriseClient.generation)

export default function useSelfhostStatus() {
  const { userId, guest } = useTracker(() => ({ userId: Meteor.userId(), guest: Boolean(Meteor.user()?.isAnonymous) }))
  const [state, setState] = React.useState({ userId: null, status: null })
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    const listener = () => setTick((n) => n + 1)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])
  React.useEffect(() => {
    let live = true
    // Slatebox Cloud asks nothing: there is nothing to offer there.
    if (!userId || guest || editionOf(Meteor.settings) === 'cloud') {
      setState({ userId, status: null })
      return undefined
    }
    statusFor(userId).then((status) => { if (live) setState({ userId, status }) })
    return () => { live = false }
  }, [userId, guest, tick])
  return state.userId === userId ? state.status : null
}
