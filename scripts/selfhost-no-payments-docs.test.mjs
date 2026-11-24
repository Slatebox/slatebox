// A self-hosted Slatebox has no payments to set up (owner, 2026-11-24): Slatebox Pro, balances, top-ups and the meter
// are Slatebox Cloud's only. The self-hosting kit (its README, compose file, run script and the settings a new
// installation writes) never mentions Stripe, the meter, top-ups, balances, price IDs or webhooks. The one sentence a
// self-hoster needs is allowed: "Slatebox Pro and balances exist only on Slatebox Cloud."
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const ALLOWED = /Slatebox Pro and balances exist only on Slatebox Cloud\./
const ALLOWED_ALL = new RegExp(ALLOWED.source, 'g')
const PAYMENTS = [
  [/stripe/i, 'Stripe'], [/\bmeter(ing|ed|s)?\b/i, 'the meter'], [/\btop(ped)?[- ]?ups?\b|\btop up\b/i, 'top-ups'],
  [/\bbalances?\b/i, 'balances'], [/\bprice[ _-]?ids?\b|\bprice_[A-Za-z0-9]/i, 'price IDs'], [/\bwebhooks?\b/i, 'webhooks'],
  [/Budget and Pro/i, 'the Budget and Pro admin page'], [/\b(pk|sk|rk)_(live|test)_/, 'payment keys'],
]
const KIT = ['self-host/README.md', 'self-host/compose.yaml', 'self-host/run', 'self-host/init.mjs']

test('the self-hosting kit never mentions payments, the meter, top-ups, balances, price IDs or webhooks', () => {
  const found = []
  for (const path of KIT) read(path).replace(ALLOWED_ALL, '').split('\n').forEach((line, index) => {
    for (const [pattern, what] of PAYMENTS) if (pattern.test(line)) found.push(path + ':' + (index + 1) + ' ' + what + ': ' + line.trim().slice(0, 120))
  })
  assert.deepEqual(found, [])
})

test('the READMEs say Slatebox Pro and balances are Slatebox Cloud only', () => {
  assert.match(read('self-host/README.md'), ALLOWED)
  assert.match(read('README.md'), ALLOWED)
  assert.doesNotMatch(read('web/README.md'), /self-hosted (server|Slatebox) has no meter unless|operator turns one on/i, 'web/README.md: a self-hoster has no meter to turn on')
})
