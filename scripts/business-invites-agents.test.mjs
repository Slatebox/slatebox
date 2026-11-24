// Owner decision (2026-11-24): Slatebox Business members count as Pro for inviting outside agents. On Slatebox
// Cloud, inviting an agent, keeping it active and asking it need Slatebox Pro, or a seat on a team with an active
// Business membership. Business is sold by talking to us; its membership is the team's `business` field, set
// when the contract starts: { status: 'active', until? } (until: when it ends, absent while it runs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { businessActive, invitesAgents } from '../web/app/imports/api/business/membership.mjs'

const now = Date.UTC(2026, 10, 24)
const day = 86400000

test('an active Business membership is one that is active and has not ended', () => {
  assert.equal(businessActive({ business: { status: 'active' } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: now + day } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: new Date(now + day) } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: now - 1 } }, now), false)
  assert.equal(businessActive({ business: { status: 'ended' } }, now), false)
  assert.equal(businessActive({ business: { status: 'active', until: 'soon' } }, now), false)
  for (const org of [null, undefined, {}, { business: null }, { business: 'active' }]) assert.equal(businessActive(org, now), false)
})

test('Pro or an active Business membership invites agents; neither does not', () => {
  assert.equal(invitesAgents({ pro: true, org: null }, now), true)
  assert.equal(invitesAgents({ pro: false, org: { business: { status: 'active' } } }, now), true)
  assert.equal(invitesAgents({ pro: false, org: { business: { status: 'active', until: now - day } } }, now), false)
  assert.equal(invitesAgents({ pro: false, org: null }, now), false)
})

test('the Cloud check for invited agents takes a Business seat as well as Pro, on the server', () => {
  const meteor = readFileSync(new URL('../enterprise/server/meteor.js', import.meta.url), 'utf8')
  const gate = meteor.slice(meteor.indexOf('pro: async (userId)'), meteor.indexOf('firstName:'))
  assert.match(gate, /proActive\(user\?\.pro\)/)
  assert.match(gate, /invitesAgents\(/)
  assert.match(gate, /orgId/)
  const service = readFileSync(new URL('../enterprise/server/service.mjs', import.meta.url), 'utf8')
  assert.match(service, /PRO_REQUIRED = 'Inviting agents onto your slates is part of Slatebox Pro and Slatebox Business\.'/)
})
