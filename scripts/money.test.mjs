import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { callsLeftText, hoursText } from '../web/app/imports/ui/components/billing/money.js'

// Design test 8 (lane G): the call-hours sentence on Profile → Credits, and the profile's pay
// buttons opening the in-app sheet instead of leaving the page.
const read = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

test('hours read as plain words: halves as ½, under an hour as minutes, none as "no"', () => {
  assert.equal(hoursText(0), 'no')
  assert.equal(hoursText(null), 'no')
  assert.equal(hoursText(1), 'about 1 hour')
  assert.equal(hoursText(5), 'about 5 hours')
  assert.equal(hoursText(1.5), 'about 1½ hours')
  assert.equal(hoursText(0.5), 'about 30 minutes')
  assert.equal(hoursText(0.4), 'about 25 minutes')
  assert.equal(hoursText(0.01), 'about 5 minutes', 'never "about 0 minutes"')
})

test('the calls sentence never says "no of four-person video"', () => {
  assert.equal(callsLeftText({ voice: 1.5, video: 0 }), 'about 1½ hours of four-person voice and no four-person video left this month')
  assert.equal(callsLeftText({ voice: 0, video: 0 }), 'no four-person voice and no four-person video left this month')
  assert.equal(callsLeftText({ voice: 5, video: 2 }), 'about 5 hours of four-person voice and about 2 hours of four-person video left this month')
  for (const voice of [0, 0.5, 1, 7.5]) {
    for (const video of [0, 0.5, 1, 3]) assert.doesNotMatch(callsLeftText({ voice, video }), /\bno of\b/)
  }
  const credits = read('imports/ui/components/billing/Credits.jsx')
  assert.match(credits, /Calls you start: \{callsLeftText\(\{ voice: summary\.voiceHoursLeft, video: summary\.videoHoursLeft \}\)\}\./)
  assert.doesNotMatch(credits, /\{hoursText\(summary\.videoHoursLeft\)\} of four-person video/)
})

test('Slatebox Pro on the profile opens the pay sheet: Get Pro, Your Pro, the card', () => {
  const panel = read('imports/ui/components/billing/ProPanel.jsx')
  assert.match(panel, /usePaySheet\(\)/)
  assert.match(panel, /open\(\{ action: 'pro', choice: \{ interval \} \}\)/)
  assert.match(panel, /open\(\{ action: pro\?\.pastDue \? 'card' : 'manage' \}\)/)
  // no redirect from the profile any more, and no green "Pro is on" line (the Welcome says it)
  assert.doesNotMatch(panel, /window\.location\.assign/)
  assert.doesNotMatch(panel, /CONSTANTS\.methods\.pro\.(checkout|portal)/)
  assert.doesNotMatch(panel, /severity="success"|severity: 'success'/)
  assert.doesNotMatch(read('imports/ui/components/billing/Credits.jsx'), /severity="success"|is in your balance/)
  // the spacing branch's layout parts
  assert.match(panel, /<AccountSection title="Slatebox Pro">/)
  assert.match(panel, /<AccountActions>/)
})

test('a balance tops up in the pay sheet, yours or the team\'s; the old dialog is gone', () => {
  assert.equal(existsSync(new URL('../web/app/imports/ui/components/billing/TopUpDialog.jsx', import.meta.url)), false)
  const balance = read('imports/ui/components/billing/Balance.jsx')
  assert.doesNotMatch(balance, /TopUpDialog/)
  assert.match(balance, /open\(\{ action: 'topup', wallet \}\)/)
  assert.match(balance, /<AccountActions>/)
  // the team settings page uses the same Balance
  assert.match(read('imports/ui/components/billing/TeamBalance.jsx'), /<Balance wallet="team"/)
  // nothing anywhere opens the old dialog
  for (const file of ['imports/ui/components/billing/Credits.jsx', 'imports/ui/components/billing/TeamBalance.jsx', 'imports/ui/pages/Profile.jsx']) {
    assert.doesNotMatch(read(file), /TopUpDialog/, file)
  }
})
