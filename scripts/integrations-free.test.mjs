// Owner decision (2026-11-26): integrations are free everywhere. On Slatebox Cloud any signed-in
// account connects and invites outside agents and Google, with no Slatebox Pro or Business check
// anywhere (server or browser); the agent work they run is still metered like any other agent
// request (runAIAction: Pro credits pay for it). On a self-hosted install they run with no key
// (scripts/enterprise-carveout.test.mjs, scripts/enterprise-license.test.mjs). The behaviour itself
// is tested against the real service in scripts/connectors.test.mjs, connectors-signin.test.mjs,
// integrations.test.mjs and google.test.mjs ("free" tests); this file holds the rules that span files.
//
// A Business membership itself still exists (a shared pool for a team): organizations.business =
// { status: 'active', until? }.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as membership from '../web/app/imports/api/business/membership.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')
const now = Date.UTC(2026, 10, 24)
const day = 86400000

test('an active Business membership is one that is active and has not ended', () => {
  const { businessActive } = membership
  assert.equal(businessActive({ business: { status: 'active' } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: now + day } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: new Date(now + day) } }, now), true)
  assert.equal(businessActive({ business: { status: 'active', until: now - 1 } }, now), false)
  assert.equal(businessActive({ business: { status: 'ended' } }, now), false)
  assert.equal(businessActive({ business: { status: 'active', until: 'soon' } }, now), false)
  for (const org of [null, undefined, {}, { business: null }, { business: 'active' }]) assert.equal(businessActive(org, now), false)
})

test('no plan gates integrations anywhere in enterprise/: no Pro check, no "Pro ended", no upsell', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
  const gate = /requirePro|GOOGLE_PRO|PRO_REQUIRED|INTEGRATIONS_PRO|pro_required|pro_ended|proEnded|followPro|proActive|invitesAgents|usePaySheet|openPay|Renew Pro|Slatebox Pro|Slatebox Business|Pro or Business|Needs Slatebox/
  // integrations-migrate.mjs is the one place that names the old 'pro_ended' state: it resumes such rows.
  for (const path of walk(join(root, 'enterprise')).filter((p) => /\.(m?js|jsx)$/.test(p) && !p.endsWith('integrations-migrate.mjs'))) {
    assert.doesNotMatch(read(relative(root, path)), gate, relative(root, path))
  }
  // The service and Google take no plan dependency; the Meteor side gives them none.
  const meteor = read('enterprise/server/meteor.js')
  assert.doesNotMatch(meteor, /\bpro: /)
  assert.doesNotMatch(read('enterprise/server/service.mjs'), /\bpro, \/\/|await pro\(/)
  assert.doesNotMatch(read('enterprise/server/google/google.mjs'), /\bpro, \/\/|await pro\(/)
  // What they run is still metered, unchanged: the person's request goes through runAIAction.
  assert.match(meteor, /metered: \(fn, \{ userId \}\) => runAIAction\(\{ feature: 'connectors', userId, countsAsDraft: true \}, fn\)\.catch\(meterRefusal\)/)
})

test('the meter\'s refusal of an agent ask reaches the person with its code, words and pay action, not as a server failure', async () => {
  const { ConnectorRefused, meterRefusal } = await import('../enterprise/server/service.mjs')
  const { toActionError } = await import('../web/app/server/actions/errors.mjs')
  // What meter.begin throws (a Meteor.Error: error, reason, details.pay).
  const refusal = Object.assign(new Error('Get Slatebox Pro.'), { error: 'pro', reason: 'Get Slatebox Pro.', details: { pay: { action: 'pro', wallet: null } } })
  const relayed = (() => { try { meterRefusal(refusal) } catch (error) { return error } })()
  assert.ok(relayed instanceof ConnectorRefused)
  assert.deepEqual([relayed.status, relayed.code, relayed.message, relayed.details], [402, 'pro', 'Get Slatebox Pro.', { pay: { action: 'pro', wallet: null } }])
  const answered = toActionError(relayed)
  assert.deepEqual([answered.status, answered.code, answered.details], [402, 'pro', { pay: { action: 'pro', wallet: null } }])
  // Anything else goes on as it was.
  const other = new Error('boom')
  assert.throws(() => meterRefusal(other), (error) => error === other)
})

test('Business no longer sells inviting agents: it is free for everyone', () => {
  assert.equal(membership.invitesAgents, undefined)
  assert.doesNotMatch(read('web/app/imports/api/business/catalog.mjs'), /outside agents/i)
  assert.doesNotMatch(read('web/app/imports/ui/components/billing/pay/pay-copy.mjs'), /outside agents/i)
  assert.doesNotMatch(read('web/app/imports/ui/components/teams/BusinessPanel.jsx'), /outside agents/i)
})

test('the docs say integrations are free, never a plan or a license to unlock them', () => {
  for (const path of ['docs/integrations.md', 'enterprise/README.md', 'self-host/README.md', 'self-host/COMPOSE-KIT.md', 'README.md']) {
    const text = read(path)
    assert.doesNotMatch(text, /flat yearly fee|Upgrade on prem|on-prem license|Integrations are part of Slatebox Pro|license key from Slatebox LLC unlocks|Pro or Business/i, path)
  }
  assert.match(read('docs/integrations.md'), /Integrations are free for everyone/)
  assert.match(read('self-host/README.md'), /## Integrations\n\nIntegrations are on in every install, free, with no key/)
})
