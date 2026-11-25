// /integrations: every outside agent and Google account a person connected once, to invite onto any
// slate (owner, 2026-11-24). The page itself is enterprise code (the integrations.page slot): on an
// install where enterprise code is locked there is no such page, so the address goes to Profile and
// no control here offers what the server would refuse.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Navigate } from 'react-router-dom'
import AppPage from '../common/AppPage'
import EnterpriseSlot from '../common/EnterpriseSlot'
import { enterpriseState } from '../../api/common/edition.mjs'

export const integrationsOn = (settings) => enterpriseState(settings).unlocked

export default function Integrations() {
  if (!integrationsOn(Meteor.settings)) return <Navigate to="/profile" replace />
  return (
    // the shared page layout; the page's own title row is AppPageHeader, inside the slot
    <AppPage data-integrations-route="">
      <EnterpriseSlot name="integrations.page" />
    </AppPage>
  )
}
