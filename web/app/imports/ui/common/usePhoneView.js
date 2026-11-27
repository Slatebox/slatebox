import { useSyncExternalStore } from 'react'
import { readPhoneView, subscribePhoneView } from './phoneView.mjs'

const subscribe = (cb) => subscribePhoneView(typeof window === 'undefined' ? null : window, cb)
const read = () => readPhoneView(typeof window === 'undefined' ? null : window)

// True on a phone (phoneView.mjs): slates are for viewing there, not for making or changing.
export default function usePhoneView() {
  return useSyncExternalStore(subscribe, read, () => false)
}
