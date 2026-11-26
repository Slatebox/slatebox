// Self-hosting is running Slatebox yourself: the installer never mentions or configures payments,
// metering or top-ups (those run only on Slatebox Cloud, under its signed license). Every file the
// package publishes is read, plus its tests' fixtures.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// (Money as an amount a person pays: "$5/month", "$8 per member", "USD 5", "€6"; shell's $4 is not money.)
const PAYMENT_WORDS = /stripe|\bmeter(s|ed|ing)?\b|top.?ups?\b|\bbilling\b|\bpayments?\b|\bsubscriptions?\b|\binvoices?\b|\bprices?\b|\bpricing\b|\$\d+(\.\d+)?\s*(\/|per\b|a (month|year)|monthly|yearly|USD)|\bUSD\s?\d|\d\s?USD\b|[€£]\s?\d/i
// This file names the words it refuses.
const SELF = fileURLToPath(import.meta.url)

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (name === 'node_modules' || name.startsWith('.')) return []
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

test('nothing in the installer mentions or configures payments, metering or top-ups', () => {
  const hits = []
  for (const file of files(root)) {
    if (file === SELF || !/\.(mjs|js|json|md|yaml|yml|txt)$/.test(file)) continue
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const found = PAYMENT_WORDS.exec(line)
      if (found) hits.push(`${file.slice(root.length)}:${index + 1}: ${found[0]}`)
    })
  }
  assert.deepEqual(hits, [])
})

test('the guard catches what it is for', () => {
  for (const line of ['STRIPE_SECRET_KEY=x', 'metered AI', 'buy a top-up', 'Billing settings', 'costs $5 a month', '$8 per member', 'USD 5', '€6', 'subscription', 'pricing page']) {
    assert.match(line, PAYMENT_WORDS, line)
  }
  for (const line of ['SLATEBOX_KEY_ENCRYPTION_KEY', 'parameters', 'diameter', 'awk {print $4}', 'a sibling checkout']) {
    assert.doesNotMatch(line, PAYMENT_WORDS, line)
  }
})

// 0.3.0: the wizard's copy (src/ui/) and the interview's new words are in what the guard reads.
test('the guard reads the wizard in the terminal and its copy', () => {
  const read = files(root).map(file => file.slice(root.length))
  for (const file of ['src/ui/rich-prompt.mjs', 'src/ui/mode.mjs', 'src/ui/term.mjs', 'src/ui/keys.mjs', 'src/interview.mjs']) {
    assert.ok(read.includes(file), `${file} is read`)
  }
})
