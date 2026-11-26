import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

// Slatebox has no plans, seats, guest passes or upgrade prompts. This scan keeps them gone.
const app = new URL('../web/app/', import.meta.url).pathname
const files = []
for (const root of ['server', 'imports', 'client']) {
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(m?js|jsx|cjs|json|html)$/.test(name)) files.push(full.slice(app.length))
    }
  }
  walk(join(app, root))
}
const read = file => readFileSync(join(app, file), 'utf8')

// Where an old name may still appear, and why.
const allowed = {
  // removed from models.js by the M3 follow-up, once w2/integrate stops importing it
  PricingTiers: ['imports/api/common/models.js'],
  // the cleanup step names the fields it removes
  planType: ['server/metering/migrations.mjs'],
}

const banned = [
  'planType', 'PricingTiers', 'hasPro', 'requiresPro', 'guestViewsPerMonth', 'team-plan', 'huddle-plan',
  'pro-annual-portal', 'GuestViewReport', 'guestViewReport', 'stripe.createSession', 'getAIUsage', 'aiUsageDetails',
  'requiresVideoPlan', 'syncSeats', 'guest day pass', 'StripeManagement', 'stripe-subscription',
]

test('no plan code remains in the app', () => {
  const hits = []
  for (const file of files) {
    const text = read(file)
    for (const word of banned) {
      if (text.includes(word) && !(allowed[word] || []).includes(file)) hits.push(`${file}: ${word}`)
    }
  }
  assert.deepEqual(hits, [])
})

// No exceptions: since 2026-11-26 integrations are free everywhere, so a self-hosted install's
// header says "Move to Cloud" (the move, nothing to unlock) and Admin tools has no "Upgrade on prem".
// Nothing asks anyone to upgrade.
const ownerAllowed = {}

test('no user-facing string asks anyone to upgrade or unlock a feature', () => {
  const hits = []
  const strings = /(['"`])((?:\\.|(?!\1).)*)\1|>([^<>{}]+)</g
  for (const file of files) {
    const source = read(file)
    for (const m of source.matchAll(strings)) {
      const text = m[2] ?? m[3] ?? ''
      if ((ownerAllowed[file] || []).includes(text.trim())) continue
      // Node's HTTP 'upgrade' event (a WebSocket handshake, server/voice/relay.mjs) is a protocol name nobody reads, not an upsell.
      if (text === 'upgrade' && source.slice(Math.max(0, m.index - 12), m.index).match(/\.(on|off|once)\(\s*$/)) continue
      // The command that moves a self-hosted install to a new version (`slatebox upgrade`) is its name, not an upsell.
      if (/\bslatebox upgrade\b/.test(text) && !/\bupgrade\b/i.test(text.replace(/\bslatebox upgrade\b/g, ''))) continue
      if (/\bupgrade\b|upgrade today|upgrade now|unlock (themes|more|pro|features|video|ai)\b/i.test(text)) hits.push(`${file}: ${text.slice(0, 80)}`)
    }
  }
  assert.deepEqual(hits, [])
})

test('the deleted modules are gone', () => {
  for (const gone of [
    'server/methods/stripe.js', 'server/stripe-subscription.mjs', 'server/pro-annual-portal.mjs',
    'imports/api/common/team-plan.mjs', 'imports/api/common/huddle-plan.mjs', 'imports/ui/common/Payment.jsx',
    'imports/ui/components/StripeManagement.jsx', 'imports/ui/components/teams/GuestViewReport.jsx',
  ]) assert.equal(existsSync(join(app, gone)), false, gone)
})

test('words never used in the interface: tier, seats, credits, unlimited for anything metered', () => {
  const hits = []
  const ui = files.filter(f => f.startsWith('imports/ui/') || f.startsWith('client/i18n/') || f.startsWith('server/metering/'))
  for (const file of ui) {
    for (const m of read(file).matchAll(/(['"`])((?:\\.|(?!\1).)*)\1|>([^<>{}]+)</g)) {
      const text = m[2] ?? m[3] ?? ''
      if (/\b(AI credits?|seats?|pricing tier|Pro plan|Team plan|day pass(es)?|guest pass(es)?|unlimited (AI|video|calls))\b/i.test(text)) hits.push(`${file}: ${text.slice(0, 80)}`)
    }
  }
  assert.deepEqual(hits, [])
})
