// A place in the app the enterprise/ code may fill (imports/api/client/enterprise-slots.mjs).
// Renders nothing until, and unless, enterprise code fills it (Slatebox Cloud, and every self-hosted
// install whose build carries it); where enterprise code does not run it always renders nothing.
import React, { useSyncExternalStore } from 'react'
import { enterpriseSlots } from '../../api/client/enterprise-slots.mjs'

export default function EnterpriseSlot({ name, ...props }) {
  const Component = useSyncExternalStore(enterpriseSlots.subscribe, () => enterpriseSlots.get(name))
  return Component ? <Component {...props} /> : null
}
