// A place in the app the Cloud-only enterprise/ code may fill (imports/api/client/enterprise-slots.mjs).
// Renders nothing until, and unless, a Cloud build fills it; on self-host it always renders nothing.
import React, { useSyncExternalStore } from 'react'
import { enterpriseSlots } from '../../api/client/enterprise-slots.mjs'

export default function EnterpriseSlot({ name, ...props }) {
  const Component = useSyncExternalStore(enterpriseSlots.subscribe, () => enterpriseSlots.get(name))
  return Component ? <Component {...props} /> : null
}
