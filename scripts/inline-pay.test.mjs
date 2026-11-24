// The meter's refusal in a chat carries its ways on inside the message (owner, 2026-11-24: "the AI top up offer should
// include the link right in the chat to upgrade to pro with the same stripe component so it can be done right then,
// really easily"): "Get Slatebox Pro — $5/month" and "Add a balance" as buttons in the bubble, each opening the same in-app
// pay sheet on its pane, the request run again once the server has the payment. Nothing is charged here: the sheet takes
// the person's own click, or nothing happens.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { INLINE_LABELS, inlinePayActions, inlineRefusalText } from '../web/app/imports/ui/components/billing/pay/pay-notice.mjs'

const read = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const cloud = { emailVerified: true, proState: null, proAvailable: true, topUpsAvailable: true }
const pro = { code: 'pro', reason: 'AI on Slatebox comes with Slatebox Pro, $5 a month, or a balance. Get Pro or top up in your profile.', details: { pay: { action: 'pro', wallet: null } } }

test('a Pro refusal offers both, Pro first: Pro for a month and a balance, each a pane of the same sheet', () => {
  const actions = inlinePayActions(pro, { summary: cloud })
  assert.deepEqual(actions, [
    { action: 'pro', wallet: null, choice: { interval: 'month' }, label: 'Get Slatebox Pro — $5/month' },
    { action: 'topup', wallet: 'me', choice: null, label: 'Add a balance' },
  ])
  // The message stays short: the buttons say the rest.
  assert.equal(inlineRefusalText(pro, actions), 'This needs Slatebox Pro or a balance. Choose one here and it runs as soon as it’s paid.')
  // The month's included amount used up: a balance is what is asked for, and Pro is offered beside it.
  assert.deepEqual(inlinePayActions({ code: 'ai-month', reason: 'Used up.' }, { summary: cloud }).map(item => item.action), ['pro', 'topup'])
})

test('only what this server sells and this person can take: Pro on is "Run it now", no top-ups no balance, other answers their own button', () => {
  assert.deepEqual(inlinePayActions(pro, { summary: { ...cloud, proState: { active: true } } }), [{ action: 'again', wallet: null, choice: null, label: 'Run it now' }])
  assert.deepEqual(inlinePayActions(pro, { summary: { ...cloud, topUpsAvailable: false } }).map(item => item.label), [INLINE_LABELS.pro])
  assert.deepEqual(inlinePayActions({ code: 'ai-month', reason: 'Used up.' }, { summary: { ...cloud, proState: { active: true } } }).map(item => item.label), [INLINE_LABELS.topup])
  // An unconfirmed address confirms first: no payment is offered before it (worked out here for a refusal the server sent no
  // answer with; the server's own answer, details.pay, comes first).
  assert.deepEqual(inlinePayActions({ code: 'pro', reason: pro.reason }, { summary: { ...cloud, emailVerified: false } }).map(item => item.action), ['verify'])
  assert.deepEqual(inlinePayActions({ ...pro, details: { pay: { action: 'verify', wallet: null } } }, { summary: cloud }).map(item => item.action), ['verify'])
  // A team's balance: its admin tops it up there, as the one button says.
  assert.deepEqual(inlinePayActions({ code: 'balance', reason: 'x', details: { wallet: 'team', pay: { action: 'topup', wallet: 'team' } } }, { summary: cloud }).map(item => item.label), ['Top up the team balance'])
  // Not about money: nothing.
  assert.deepEqual(inlinePayActions({ code: 'busy', reason: 'x' }, { summary: cloud }), [])
  assert.equal(inlineRefusalText({ reason: 'Confirm your email first.' }, [{ action: 'verify' }]), 'Confirm your email first.')
})

test('every chat surface shows the meter’s refusal with its ways on inside the message, each with its retry', () => {
  const workshop = read('imports/ui/components/workshop/WorkshopConversation.jsx')
  assert.match(workshop, /<PayNotice refusal=\{payRefusal\} from="draft" retry=\{\(\) => submit\(payRefusal\.message\)\} inline \/>/)
  // In the refusing message itself (the turn's bubble), not a chip under the starters.
  assert.match(workshop, /\{last && payRefusal && !hold\s*\n[^\n]*\n\s*\? <PayNotice/)
  assert.doesNotMatch(workshop, /extra=\{[\s\S]{0,200}<PayNotice/)
  const native = read('imports/ui/components/NativeCanvasConversation.jsx')
  assert.match(native, /<ChatTurn who="slatebox" as="div"><PayNotice refusal=\{refusal\} from="draft" retry=\{\(\) => ask\(refusal\.message\)\} inline \/><\/ChatTurn>/)
  const review = read('imports/ui/components/library/review/ReviewPanel.jsx')
  assert.match(review, /<PayNotice refusal=\{turn\.refusal\} from="draft" retry=\{onAgain\} inline \/>/)
  assert.match(review, /onAgain=\{\(\) => ask\(turn\.ask\)\}/)
  assert.match(read('imports/ui/components/TranscriptionText.jsx'), /<PayNotice refusal=\{refusalForViewer\(m, Meteor\.userId\(\)\)\} from="draft" inline \/>/)
  // The buttons open the one pay sheet (usePaySheet().open) on their pane, with the retry; the sheet is where a person pays.
  const notice = read('imports/ui/components/PayNotice.jsx')
  assert.match(notice, /open\(\{ action: item\.action, wallet: item\.wallet, reason, retry, from, choice: item\.choice \}\)/)
  assert.doesNotMatch(notice, /callAsync|confirmPayment|pro\.confirm/)
})
