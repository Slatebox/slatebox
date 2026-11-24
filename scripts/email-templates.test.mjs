// Every email Slatebox sends shares one branded layout (web/app/server/email/templates.mjs): the
// hosted logo, a headline, one button with its raw link under it, a footer saying why it came, a
// preheader and a plain-text twin. The snapshots in scripts/fixtures/email/ are the rendered sample
// emails; after a deliberate change, look at them (node scripts/email-preview.mjs <folder>) and
// rewrite them with `node scripts/email-preview.mjs --fixtures`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_LOGO_URL, PRIVACY_URL, SAMPLES, enrollAccount, firstNameOf, greeting, libraryDecision, loginLink, logoUrlFor,
  meterAlert, proMergeLink, resetPassword, verifyEmail,
} from '../web/app/server/email/templates.mjs'
import { libraryNotice } from '../web/app/server/library/notify.mjs'
import { FIXTURES, renderAll, writePreviews } from './email-preview.mjs'

const url = 'https://app.slatebox.test/verify-email/tok_123'
const all = () => [
  verifyEmail({ firstName: 'Ada', url }),
  resetPassword({ firstName: 'Ada', url }),
  enrollAccount({ firstName: 'Ada', teamName: 'Acme', url }),
  loginLink({ firstName: 'Ada', url }),
  proMergeLink({ firstName: 'Ada', url, days: 7 }),
  libraryDecision({ firstName: 'Ada', subject: 's', headline: 'h', nextLine: 'n', libraryUrl: url }),
  meterAlert({ text: 'Half of the budget is spent.', adminUrl: url }),
]

test('every email has the layout: logo, preheader, one button, the raw link, why it came, privacy, and a text twin', () => {
  for (const mail of all()) {
    const { subject, preheader, html, text } = mail
    assert.ok(subject && preheader, subject)
    assert.match(html, /^<!DOCTYPE html>/)
    assert.ok(html.includes(`<img src="${DEFAULT_LOGO_URL}" width="160" height="40" alt="Slatebox"`), subject)
    assert.ok(html.includes(preheader.replace(/"/g, '&quot;')), `preheader in ${subject}`)
    assert.equal(html.match(/class="sb-button-link"/g).length, 1, `one button in ${subject}`)
    assert.equal(html.match(/<v:roundrect /g).length, 1, `the Outlook button in ${subject}`)
    assert.ok(html.includes(`href="${url}" class="sb-button-link"`), subject)
    assert.ok(html.includes(`>${url}</a>`), `raw link fallback in ${subject}`)
    assert.ok(html.includes(`href="${PRIVACY_URL}"`) && html.includes('Slatebox LLC'), subject)
    assert.match(html, /You got this email because/)
    assert.match(html, /prefers-color-scheme: dark/)
    assert.match(html, /<meta name="color-scheme" content="light dark">/)
    // the text twin carries the greeting, the link and the reason
    assert.ok(text.includes(url), `link in the text of ${subject}`)
    assert.match(text, /You got this email because/)
    assert.doesNotMatch(text, /<[a-z]/i)
  }
})

test('the old voice is gone: no "Yay", "Hooray" or "Go forth", and no prices', () => {
  for (const { name, html, text } of renderAll()) {
    for (const body of [html, text]) {
      assert.doesNotMatch(body, /\bYay\b|Hooray|Go forth|Visual Team Collaboration/i, name)
      assert.doesNotMatch(body, /\$\s?\d/, name)
    }
  }
})

test('the greeting uses the first name, else "Hi there": never the address or its local part', () => {
  assert.equal(firstNameOf({ profile: { firstName: '  Ada ' } }), 'Ada')
  assert.equal(firstNameOf({ emails: [{ address: 'tim+openai-review@example.test' }] }), null)
  assert.equal(firstNameOf({ profile: { firstName: 'tim+openai-review@example.test' } }), null)
  assert.equal(firstNameOf({ profile: { firstName: '' } }), null)
  assert.equal(firstNameOf(null), null)
  assert.equal(greeting(null), 'Hi there,')
  const user = { emails: [{ address: 'tim+openai-review@example.test' }], profile: {} }
  const mail = verifyEmail({ firstName: firstNameOf(user), url })
  assert.match(mail.text, /^Hi there,\n/)
  assert.ok(mail.html.includes('>Hi there,</p>'))
  for (const body of [mail.html, mail.text]) assert.doesNotMatch(body, /openai-review/)
  assert.match(enrollAccount({ firstName: 'Grace', teamName: 'Acme', url }).text, /^Hi Grace,\n/)
})

test('what people typed is escaped in the HTML and kept as typed in the text', () => {
  const mail = enrollAccount({ firstName: '<b>Ada</b>', teamName: 'R&D <script>alert(1)</script>', url: 'https://x.test/e/a"b' })
  assert.doesNotMatch(mail.html, /<script>|<b>Ada/)
  assert.ok(mail.html.includes('R&amp;D &lt;script&gt;'))
  assert.ok(mail.html.includes('href="https://x.test/e/a&quot;b"'))
  assert.equal(mail.subject, "You're invited to join R&D <script>alert(1)</script> on Slatebox")
  assert.match(mail.text, /R&D <script>/)
  const quoted = libraryDecision({ subject: 's', headline: 'h', message: 'a <i>b</i>\nc', nextLine: 'n', libraryUrl: url })
  assert.ok(quoted.html.includes('a &lt;i&gt;b&lt;/i&gt;<br>c'))
  assert.match(quoted.text, /The reviewer wrote:\na <i>b<\/i>\nc/)
})

test('each email keeps its purpose, its link and its facts', () => {
  assert.equal(verifyEmail({ url }).subject, 'Confirm your email for Slatebox')
  assert.equal(resetPassword({ url }).subject, 'Reset your Slatebox password')
  assert.equal(enrollAccount({ teamName: 'Acme', url }).subject, "You're invited to join Acme on Slatebox")
  assert.equal(enrollAccount({ teamName: '', url }).subject, "You're invited to join a team on Slatebox")
  assert.equal(loginLink({ url }).subject, 'Your Slatebox sign-in link')
  // the live Pro test finds the move link by this subject
  assert.match(proMergeLink({ url, days: 7 }).subject, /Move your Slatebox Pro/)
  assert.match(proMergeLink({ url, days: 7 }).text, /works once, for 7 days/)
  assert.match(meterAlert({ text: 'Budget at 90%.' }).text, /Budget at 90%\./)
  assert.doesNotMatch(meterAlert({ text: 'x' }).html, /class="sb-button-link"/, 'no admin address, no button')
})

test('a library decision: the in-app line is unchanged; the email is branded, with the reviewer note and both links', () => {
  const item = { _id: 'i1', kind: 'slate', title: 'Kickoff notes', slug: 'kickoff-notes-i1', authorId: 'ada' }
  const notice = libraryNotice({ item, type: 'approved', message: 'Thanks', origin: 'https://app.slatebox.test', firstName: 'Ada' })
  assert.equal(notice.text, 'Your slate "Kickoff notes" was published.')
  assert.equal(notice.subject, 'Your slate "Kickoff notes" is published')
  assert.match(notice.body, /^Hi Ada,\n/)
  assert.match(notice.body, /The reviewer wrote:\nThanks/)
  assert.ok(notice.html.includes('href="https://app.slatebox.test/library/kickoff-notes-i1" class="sb-button-link"'))
  assert.ok(notice.html.includes('https://app.slatebox.test/library/mine'))
  assert.ok(notice.html.includes('src="https://app.slatebox.test/brand/email-logo.png"'))
  const changes = libraryNotice({ item, type: 'changes_requested', origin: 'https://app.slatebox.test' })
  assert.match(changes.body, /^Hi there,\n/)
  assert.match(changes.body, /My library: https:\/\/app\.slatebox\.test\/library\/mine/)
})

test('the logo comes from the instance itself over https, else from Slatebox Cloud', () => {
  assert.equal(logoUrlFor('https://app.slatebox.com/'), 'https://app.slatebox.com/brand/email-logo.png')
  assert.equal(logoUrlFor('https://boards.example.test'), 'https://boards.example.test/brand/email-logo.png')
  assert.equal(logoUrlFor('http://localhost:3000/'), DEFAULT_LOGO_URL)
  assert.equal(logoUrlFor(''), DEFAULT_LOGO_URL)
  assert.equal(logoUrlFor(undefined), DEFAULT_LOGO_URL)
  assert.match(DEFAULT_LOGO_URL, /^https:\/\//)
  // the picture is in the app's public folder, so app.slatebox.com serves it
  const png = readFileSync(new URL('../web/app/public/brand/email-logo.png', import.meta.url))
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 80], 'drawn at 2x for a 160x40 slot')
})

test('the preview script renders every sample, and each matches its snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sb-email-'))
  try {
    const names = writePreviews(dir)
    assert.deepEqual(names, Object.keys(SAMPLES))
    assert.deepEqual(readdirSync(FIXTURES).sort(), names.flatMap((n) => [`${n}.html`, `${n}.txt`]).sort(), 'one snapshot pair per sample')
    for (const name of names) {
      for (const ext of ['html', 'txt']) {
        assert.equal(readFileSync(join(dir, `${name}.${ext}`), 'utf8'), readFileSync(join(FIXTURES, `${name}.${ext}`), 'utf8'), `${name}.${ext} matches its snapshot`)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
