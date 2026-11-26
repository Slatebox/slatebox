// A self-hosted Slatebox has no payments to set up (owner, 2026-11-24): Slatebox Pro, balances, top-ups and the meter
// are Slatebox Cloud's only. The self-hosting kit (its README, compose file, run script and the settings a new
// installation writes) never mentions Stripe, the meter, top-ups, balances, price IDs or webhooks. The
// root README (read by Cloud and self-host readers alike) keeps "Slatebox Pro and balances exist only on Slatebox
// Cloud." The self-hosting kit itself never mentions Pro at all (owner rule, 2026-11-26: self-host copy never
// mentions payments, Pro, prices or Stripe), so it carries no Pro sentence any more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const ALLOWED = /Slatebox Pro and balances exist only on Slatebox Cloud\./
const PAYMENTS = [
  [/stripe/i, 'Stripe'], [/\bmeter(ing|ed|s)?\b/i, 'the meter'], [/\btop(ped)?[- ]?ups?\b|\btop up\b/i, 'top-ups'],
  [/\bbalances?\b/i, 'balances'], [/\bprice[ _-]?ids?\b|\bprice_[A-Za-z0-9]/i, 'price IDs'], [/\bwebhooks?\b/i, 'webhooks'],
  [/Budget and Pro/i, 'the Budget and Pro admin page'], [/\b(pk|sk|rk)_(live|test)_/, 'payment keys'],
  [/\bSlatebox Pro\b|\bPro (credits|plan|account|seat)s?\b/, 'Slatebox Pro'], [/\bprices?\b|\bpricing\b/i, 'prices'],
]
const KIT = ['self-host/README.md', 'self-host/compose.yaml', 'self-host/run', 'self-host/init.mjs']

test('the self-hosting kit never mentions payments, Pro, prices, the meter, top-ups, balances, price IDs or webhooks', () => {
  const found = []
  for (const path of KIT) read(path).split('\n').forEach((line, index) => {
    for (const [pattern, what] of PAYMENTS) if (pattern.test(line)) found.push(path + ':' + (index + 1) + ' ' + what + ': ' + line.trim().slice(0, 120))
  })
  assert.deepEqual(found, [])
})

test('the root README says Slatebox Pro and balances are Slatebox Cloud only; the self-host README never mentions Pro', () => {
  assert.doesNotMatch(read('self-host/README.md'), /\bPro\b/)
  assert.doesNotMatch(read('self-host/README.md'), /\bbalances?\b/i)
  assert.match(read('README.md'), ALLOWED)
  assert.doesNotMatch(read('web/README.md'), /self-hosted (server|Slatebox) has no meter unless|operator turns one on/i, 'web/README.md: a self-hoster has no meter to turn on')
})
