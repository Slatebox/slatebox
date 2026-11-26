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
  assert.match(workshop, /\{last && turn\.pay && payRefusal && !hold\s*\n[^\n]*\n\s*\? <PayNotice/)
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

// Review fixes (2026-11-24).
test('the server’s answer comes first: a Pro member out of credits is offered a balance, not Pro, before the meter loads', () => {
  const used = { code: 'ai-month', reason: 'You have used this month’s included amount.', details: { pay: { action: 'topup', wallet: 'me' } } }
  assert.deepEqual(inlinePayActions(used, { summary: null }).map(item => item.action), ['topup'])
  assert.equal(inlineRefusalText(used, inlinePayActions(used, { summary: null })), used.reason, 'the server’s own reason is kept')
  // The server says Pro is theirs to take too (pay.also): both.
  assert.deepEqual(inlinePayActions({ ...used, details: { pay: { action: 'topup', wallet: 'me', also: 'pro' } } }, { summary: null }).map(item => item.action), ['pro', 'topup'])
  // A Pro refusal with no meter loaded: a balance only when the server says top-ups are sold.
  assert.deepEqual(inlinePayActions(pro, { summary: null }).map(item => item.action), ['pro'])
  assert.deepEqual(inlinePayActions({ ...pro, details: { pay: { action: 'pro', wallet: null, also: 'topup' } } }, { summary: null }).map(item => item.action), ['pro', 'topup'])
  // A loaded meter is fresher than the hint: Pro on since is never offered again.
  assert.deepEqual(inlinePayActions({ ...used, details: { pay: { action: 'topup', wallet: 'me', also: 'pro' } } }, { summary: { ...cloud, proState: { active: true } } }).map(item => item.action), ['topup'])
})

test('the server says what may be offered beside its answer (pay.also), never to a guest', async () => {
  const { payAlso } = await import('../web/app/server/metering/refusal-pay.mjs')
  const sold = { proAvailable: true, topUpsAvailable: true, proState: null }
  assert.equal(payAlso({ action: 'pro', wallet: null }, sold), 'topup')
  assert.equal(payAlso({ action: 'pro', wallet: null }, { ...sold, topUpsAvailable: false }), null)
  assert.equal(payAlso({ action: 'topup', wallet: 'me' }, sold), 'pro')
  assert.equal(payAlso({ action: 'topup', wallet: 'me' }, { ...sold, proState: { active: true } }), null)
  assert.equal(payAlso({ action: 'topup', wallet: 'team' }, sold), null)
  assert.equal(payAlso({ action: 'verify', wallet: null }, sold), null)
  const meteor = readFileSync(new URL('../web/app/server/metering/meteor.js', import.meta.url), 'utf8')
  assert.match(meteor, /const also = user && !user\.isAnonymous \? payAlso\(pay, flags\) : null/)
})

test('only the refusing turn carries the buttons, and "Run it now" drops the sheet’s own retry', () => {
  const workshop = read('imports/ui/components/workshop/WorkshopConversation.jsx')
  // The refusal marks its own turn; a later turn ("Which board?", "what can it do?") is never replaced by the refusal.
  assert.match(workshop, /append\(\{ role: 'user', content: message \}, \{ role: 'assistant', content: err\.reason, \.\.\.\(pays && \{ pay: true \}\) \}\)/)
  assert.match(workshop, /\.\.\.\(pay === true && \{ pay: true \}\)/)
  // On a phone the starters make way for the refusing message's buttons.
  assert.match(workshop, /starters=\{!hold && ownButtons\(history\.at\(-1\), payRefusal\) && isPhone\(\) \? null : /)
  assert.match(workshop, /const ownButtons = \(turn, payRefusal\) => Boolean\(turn\?\.role === 'assistant' && \(\(turn\.pay && payRefusal\) \|\| turn\.choices\?\.length \|\| turn\.boards\?\.length\)\)/)
  const notice = read('imports/ui/components/PayNotice.jsx')
  assert.match(notice, /dropPendingRetry\(\)\s*\n\s*return retry\?\.\(\)/)
  const host = read('imports/ui/components/billing/pay/PaySheetHost.jsx')
  assert.match(host, /export const dropPendingRetry = \(\) => \{ pending\.retry = null; pending\.owner = null \}/)
  // The meter is read once when nobody has (so the second way on is known to be theirs).
  assert.match(notice, /const summary = useLoadedAllowance\(\)/)
  assert.match(host, /if \(summary \|\| !Meteor\.userId\(\)\) return\s*\n\s*Meteor\.callAsync\(CONSTANTS\.methods\.meter\.summary\)/)
})

// Owner, 2026-11-26: the interview's refusal offers Get Pro, top up and use your own key, in the meter's own words.
test('a surface may offer "Use your own key" beside Pro and a balance, and keep the meter’s own words', async () => {
  const { OWN_KEY_HREF } = await import('../web/app/imports/ui/components/billing/pay/pay-notice.mjs')
  const usedUp = { ...pro, reason: "You've used today's free talk with Slatebox. It comes back tomorrow, or keep going with Pro or your own key." }
  const on = { ...cloud, ownKeysAvailable: true }
  const actions = inlinePayActions(usedUp, { summary: on, ownKeys: true, ownKey: true })
  assert.deepEqual(actions.map(item => [item.action, item.label]), [['pro', INLINE_LABELS.pro], ['topup', INLINE_LABELS.topup], ['own-key', 'Use your own key']])
  assert.equal(actions[2].href, OWN_KEY_HREF)
  assert.equal(OWN_KEY_HREF, '/profile?tab=credits')
  assert.equal(inlineRefusalText(usedUp, actions, { keepReason: true }), usedUp.reason)
  // only where this server keeps own keys and the person's meter does not say they are off; never unless the surface asks
  assert.deepEqual(inlinePayActions(usedUp, { summary: on, ownKeys: false, ownKey: true }).map(item => item.action), ['pro', 'topup'])
  assert.deepEqual(inlinePayActions(usedUp, { summary: { ...on, ownKeysAvailable: false }, ownKeys: true, ownKey: true }).map(item => item.action), ['pro', 'topup'])
  assert.deepEqual(inlinePayActions(usedUp, { summary: on, ownKeys: true }).map(item => item.action), ['pro', 'topup'])
  // not about money: still nothing
  assert.deepEqual(inlinePayActions({ code: 'busy', reason: 'x' }, { summary: on, ownKeys: true, ownKey: true }), [])
})
