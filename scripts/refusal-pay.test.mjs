import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { refusalSummary, refusalPay, refusalOf, refusalErrorArgs, refusalAnswer, videoRefusal } from '../web/app/server/metering/refusal-pay.mjs'
import { createMeter } from '../web/app/server/metering/meter-core.mjs'
import { PAY_LABELS, refusalAction, refusalForViewer } from '../web/app/imports/ui/components/billing/pay/pay-notice.mjs'
import { createAccounts } from '../web/app/server/instance/account-summary.mjs'

// Design test 9 (§3.4, §4.1): every meter refusal that leaves the server carries the pay sheet's
// action ({ pay } on the error's details, or { refusal } on a chat row, an abort answer or a plan),
// and every surface that shows a refusal offers that action in place, with its own retry.
const read = path => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')

const verified = { _id: 'u1', emails: [{ address: 'a@example.com', verified: true }] }
const cloud = { proState: null, proAvailable: true, topUpsAvailable: true }

test('a refusal\'s pay action is worked out from the person, never from the browser', () => {
  assert.equal(refusalSummary(null, cloud), null, 'no person: no summary (a guest signs in)')
  assert.equal(refusalSummary({ _id: 'g', isAnonymous: true }, cloud), null)
  assert.deepEqual(refusalSummary(verified, cloud), { emailVerified: true, proState: null, proAvailable: true, topUpsAvailable: true, ownKeysAvailable: false })
  assert.deepEqual(refusalPay({ code: 'pro', user: verified, flags: cloud }), { action: 'pro', wallet: null })
  assert.deepEqual(refusalPay({ code: 'ai-month', user: verified, flags: cloud }), { action: 'topup', wallet: 'me' })
  assert.deepEqual(refusalPay({ code: 'pro', user: { ...verified, emails: [{ verified: false }] }, flags: cloud }), { action: 'verify', wallet: null })
  assert.deepEqual(refusalPay({ code: 'pro-calls', user: verified, flags: { ...cloud, proState: { active: true } } }), { action: 'manage', wallet: null })
  assert.deepEqual(refusalPay({ code: 'guest', user: null, flags: cloud }), { action: 'sign-in', wallet: null })
  // a team balance ran out: an admin tops it up, anyone else asks one
  assert.deepEqual(refusalPay({ code: 'balance', details: { wallet: 'team' }, user: verified, flags: { ...cloud, teamAdmin: true } }), { action: 'topup', wallet: 'team' })
  assert.deepEqual(refusalPay({ code: 'balance', details: { wallet: 'team' }, user: verified, flags: { ...cloud, teamAdmin: false } }), { action: 'help', wallet: null })
  // the answer survives the wire (Meteor.Error details are JSON)
  const pay = refusalPay({ code: 'pro', user: verified, flags: cloud })
  assert.deepEqual(JSON.parse(JSON.stringify(pay)), pay)
})

test('refusalOf reads a refusal back off an error, and only the meter\'s', () => {
  assert.deepEqual(refusalOf({ error: 'ai-today', reason: 'x', details: { pay: { action: 'topup', wallet: 'me' } } }), { code: 'ai-today', pay: { action: 'topup', wallet: 'me' } })
  assert.equal(refusalOf({ error: 'busy', reason: 'x' }), null)
  assert.equal(refusalOf(new Error('boom')), null)
  assert.equal(refusalOf(null), null)
})

test('the meter\'s own refusal is built by makeError with who asked, and may be async', async () => {
  const seen = []
  const meter = createMeter({
    enabled: () => true,
    io: {},
    settings: async () => ({}),
    newId: () => 'a1',
    decide: async () => ({ decision: { ok: false, code: 'pro', message: 'Get Slatebox Pro.' }, userId: 'u1' }),
    credentials: async () => null,
    makeError: async (code, message, context) => {
      seen.push({ code, message, context })
      return Object.assign(new Error(message), { error: code, reason: message, details: { pay: { action: 'pro', wallet: null } } })
    },
  })
  await assert.rejects(meter.begin({ feature: 'workshop' }), (err) => {
    assert.equal(err.error, 'pro')
    assert.deepEqual(err.details.pay, { action: 'pro', wallet: null })
    return true
  })
  assert.deepEqual(seen, [{ code: 'pro', message: 'Get Slatebox Pro.', context: { userId: 'u1' } }])
})

test('every server path in design §3.4 sends the pay action', () => {
  const meteor = read('server/metering/meteor.js')
  // the meter's refusals (runAIAction: images, image generation, workshops, the canvas conversation,
  // presentations, openai.*) are Meteor errors with { pay }
  assert.match(meteor, /makeError: \(code, message, \{ userId, wallet \} = \{\}\) =>/)
  assert.match(meteor, /export async function refusalError\(/)
  assert.match(meteor, /new Meteor\.Error\(code, message, \{ pay \}\)/)
  assert.match(read('server/metering/meter-core.mjs'), /throw await makeError\(decision\.code, decision\.message, \{ userId \}\)/)
  // aiRefusal (the canvas conversation's drafting refusal) carries it too
  assert.match(meteor, /return decision\.ok \? null : \{ code: decision\.code, message: decision\.message, pay: /)
  const canvas = read('server/methods/canvas-conversation.js')
  assert.match(canvas, /throw new Meteor\.Error\(\.\.\.refusalErrorArgs\(refusal\)\)/)

  // calls: starting one, and turning video on (the decision's own code, not a fixed huddle-video)
  const daily = read('server/methods/daily.js')
  assert.match(daily, /if \(!decision\.ok\) throw await refusalError\(user, decision\.code, decision\.message\)/)
  assert.doesNotMatch(daily, /throw new Meteor\.Error\(decision\.code, decision\.message\)/)
  // video on: the rules are videoRefusal's (tested below); only its pay answer reaches refusalError
  assert.match(daily, /const refused = videoRefusal\(\{ decision, call, userId: this\.userId, noVideo \}\)/)
  assert.match(daily, /if \(refused\) throw refused\.pay \? await refusalError\(payer, refused\.code, refused\.message\) : new Meteor\.Error\(refused\.code, refused\.message\)/)

  // picture search keeps the meter's error as it is (with its details)
  assert.match(read('server/methods/images.js'), /if \(err instanceof Meteor\.Error && err\.error !== 'Unable to search for images: '\) throw err/)

  // presentations: the automatic plan says which code, with the pay action
  const plan = read('server/methods/presentationRequest.mjs')
  assert.match(plan, /\.\.\.refusalFields\(error\)/)
  const present = read('server/methods/presentations.js')
  assert.match(present, /\.\.\.\(automatic && \{ reason: planned\.reason, \.\.\.\(planned\.pay && \{ code: planned\.code, pay: planned\.pay \}\) \}\)/)
  assert.match(present, /new Meteor\.Error\(error\.error \|\| 'analyze-presentation-failed', planFailureReason\(error\), error\.details\)/)

  // the openai chat row and its abort answer
  const openai = read('server/methods/openai.js')
  assert.match(openai, /const \{ row, answer \} = refusalAnswer\(error, Meteor\.userId\(\)\)/)
  assert.match(openai, /text: error\.reason, type: CONSTANTS\.messageTypes\.chat,\s*\.\.\.row,/)
  assert.match(openai, /return answer\n/)
  // the conversation pipeline's abort row and node, and the scratch node, carry a refusal handed to them
  assert.match(read('server/methods/ai/processConversation.js'), /\.\.\.\(response\.refusal && \{ refusal: \{ code: response\.refusal\.code, userId: aiOpts\.userId \} \}\)/)
  assert.match(read('server/methods/ai/processScratch.js'), /\.\.\.\(response\?\.refusal && \{ refusal: \{ code: response\.refusal\.code, userId: aiOpts\.userId \} \}\)/)
})

// Behavioural: one per server refusal family (a thrown method error, a chat row and its answer, a call).

test('a thrown refusal: the error carries { pay } only when there is an action, and reads back the same', () => {
  const pay = refusalPay({ code: 'pro', user: verified, flags: cloud })
  const args = refusalErrorArgs({ error: 'pro', reason: 'Get Slatebox Pro.', pay })
  assert.deepEqual(args, ['pro', 'Get Slatebox Pro.', { pay: { action: 'pro', wallet: null } }])
  // what the client receives (Meteor.Error's fields, through JSON) is the same refusal again
  const [error, reason, details] = JSON.parse(JSON.stringify(args))
  assert.deepEqual(refusalOf({ error, reason, details }), { code: 'pro', pay: { action: 'pro', wallet: null } })
  // a refusal that is not about money (self-host with AI off, a guest's sentence) has no details
  assert.deepEqual(refusalErrorArgs({ error: 'ai-off', reason: 'AI is off here.' }), ['ai-off', 'AI is off here.', undefined])
  assert.equal(refusalOf({ error: 'ai-off', reason: 'AI is off here.', details: undefined }), null)
})

test('an AI method\'s refusal: the chat row names only the person refused, the answer carries the action', () => {
  const refused = { error: 'ai-month', reason: 'Your AI for this month is used up.', details: { pay: { action: 'topup', wallet: 'me' } } }
  const { row, answer } = refusalAnswer(refused, 'u1')
  assert.deepEqual(row, { refusal: { code: 'ai-month', userId: 'u1' } })
  assert.deepEqual(answer, { abort: true, abortMessage: 'Your AI for this month is used up.', refusal: { code: 'ai-month', pay: { action: 'topup', wallet: 'me' } } })
  // the row, as stored, gives the button to u1 and to no one else
  const stored = { text: refused.reason, ...row }
  assert.deepEqual(refusalForViewer(stored, 'u1'), { code: 'ai-month', reason: refused.reason })
  assert.equal(refusalForViewer(stored, 'u2'), null)
  // and the answer's refusal becomes the in-place Top up button
  assert.deepEqual(refusalAction(answer.refusal, { summary: null }), { action: 'topup', wallet: 'me', label: 'Top up' })
  // any other error: the reason only, no refusal on the row or the answer
  const other = refusalAnswer({ error: 'busy', reason: 'Try again in a moment.' }, 'u1')
  assert.deepEqual(other, { row: {}, answer: { abort: true, abortMessage: 'Try again in a moment.' } })
})

test('turning video on: only the person who started the call is offered to pay, with the meter\'s own code', () => {
  const call = { route: 'included', payer: { id: 'starter' } }
  const noVideo = 'Video is not available for this call. It carries on as voice.'
  const ask = (decision, userId = 'starter') => videoRefusal({ decision, call, userId, noVideo })
  // allowed on the same route: go ahead, for anyone
  assert.equal(ask({ ok: true, kind: 'video', route: 'included' }), null)
  assert.equal(ask({ ok: true, kind: 'video', route: 'included' }, 'guest'), null)
  // the payer changed mid-call: no video, and nothing to pay
  assert.deepEqual(ask({ ok: true, kind: 'video', route: 'balance' }), { code: 'huddle-video', message: noVideo, pay: false })
  // refused by the meter: the starter gets its code and the pay action; anyone else does not
  const refused = { ok: false, code: 'calls-month', message: 'Calls for this month are used up.' }
  assert.deepEqual(ask(refused), { code: 'calls-month', message: 'Calls for this month are used up. The call carries on as voice.', pay: true })
  assert.deepEqual(ask(refused, 'joiner'), { code: 'huddle-video', message: noVideo, pay: false })
  // allowed only as voice (a video stage): the starter is told why, with the action
  assert.deepEqual(ask({ ok: true, kind: 'voice', notice: 'Video needs Pro.' }), { code: 'video-stage', message: 'Video needs Pro.', pay: true })
  assert.deepEqual(ask({ ok: true, kind: 'voice' }), { code: 'video-stage', message: noVideo, pay: true })
  assert.deepEqual(ask({ ok: true, kind: 'voice' }, 'joiner'), { code: 'huddle-video', message: noVideo, pay: false })
  // the starter's video-stage refusal routes to a pay action like any meter code
  assert.deepEqual(refusalAction({ code: 'video-stage' }, { summary: { proAvailable: true, topUpsAvailable: true, emailVerified: true, proState: null } }), { action: 'topup', wallet: 'me', label: 'Top up' })
})

test('a planned presentation refused by the meter keeps the refusal\'s code and pay action', async () => {
  const { planWithAI } = await import('../web/app/server/methods/presentationRequest.mjs')
  const layout = { nodes: [1, 2, 3, 4].map((n) => ({ nodeId: 'n' + n, text: 'Note ' + n, childrenNodes: [] })) }
  const refused = Object.assign(new Error('Get Slatebox Pro.'), { error: 'pro', reason: 'Get Slatebox Pro.', details: { pay: { action: 'pro', wallet: null } } })
  const out = await planWithAI({ run: async () => { throw refused }, request: async () => ({}), layout, name: 'Slate' })
  assert.equal(out.automatic, true)
  assert.equal(out.code, 'pro')
  assert.deepEqual(out.pay, { action: 'pro', wallet: null })
  // any other failure has no pay action
  const other = await planWithAI({ run: async () => { throw new Error('The provider returned no viewpoints.') }, request: async () => ({}), layout, name: 'Slate' })
  assert.equal(other.automatic, true)
  assert.equal('pay' in other, false)
})

test('the in-place button: the server\'s action first, the person\'s own summary otherwise, nothing for other errors', () => {
  const summary = { proAvailable: true, topUpsAvailable: true, proState: null, emailVerified: true }
  assert.deepEqual(refusalAction({ error: 'pro', reason: 'r', details: { pay: { action: 'pro', wallet: null } } }, { summary }), { action: 'pro', wallet: null, label: PAY_LABELS.pro })
  // an older server, or a row: worked out here from the code
  assert.deepEqual(refusalAction({ code: 'ai-month' }, { summary }), { action: 'topup', wallet: 'me', label: 'Top up' })
  assert.deepEqual(refusalAction({ error: 'balance', details: { pay: { action: 'topup', wallet: 'team' } } }, { summary }), { action: 'topup', wallet: 'team', label: 'Top up the team balance' })
  assert.deepEqual(refusalAction({ error: 'pro', details: { pay: { action: 'verify', wallet: null } } }, { summary }).label, 'Confirm your email')
  // not about money: no button
  assert.equal(refusalAction({ error: 'busy', reason: 'Wait' }, { summary }), null)
  assert.equal(refusalAction({ error: 'pro' }, { summary, metered: false }), null, 'no meter, no sheet')
  assert.equal(refusalAction(null, { summary }), null)
  // a made-up action from anywhere is not trusted
  assert.deepEqual(refusalAction({ error: 'pro', details: { pay: { action: 'javascript:alert(1)' } } }, { summary }), { action: 'pro', wallet: null, label: 'Get Pro' })
  // Pro switched on since the refusal: the surface tries again instead of selling Pro twice
  assert.deepEqual(refusalAction({ error: 'pro', details: { pay: { action: 'pro', wallet: null } } }, { summary: { ...summary, pro: true, proState: { active: true } } }), { action: 'again', wallet: null, label: 'Pro is on. Try again' })
  for (const label of Object.values(PAY_LABELS)) {
    assert.doesNotMatch(label, /stripe|upgrade|unlock|plan|credits/i, label)
  }
})

test('a chat row\'s refusal is offered only to the person it refused', () => {
  const row = { text: 'Get Slatebox Pro.', refusal: { code: 'pro', userId: 'u1' } }
  assert.deepEqual(refusalForViewer(row, 'u1'), { code: 'pro', reason: 'Get Slatebox Pro.' })
  assert.equal(refusalForViewer(row, 'u2'), null)
  assert.equal(refusalForViewer({ text: 'hi' }, 'u1'), null)
  assert.equal(refusalForViewer(row, null), null)
})

test('the nine surfaces offer the action in place, each with its retry (§4.1)', () => {
  assert.equal(existsSync(new URL('../web/app/imports/ui/components/ProNotice.jsx', import.meta.url)), false, 'ProNotice is replaced by PayNotice')
  const notice = read('imports/ui/components/PayNotice.jsx')
  assert.match(notice, /export function usePayAction\(/)
  assert.match(notice, /usePaySheet\(\)/)
  for (const file of ['imports/ui/components/NativeCanvasConversation.jsx', 'imports/ui/components/workshop/WorkshopConversation.jsx']) {
    const text = read(file)
    assert.doesNotMatch(text, /ProNotice/, file)
    assert.match(text, /<PayNotice refusal=\{(refusal|payRefusal)\} from="draft" retry=\{/, file)
  }
  // the canvas chat resends the refused turn; the workshop chat its message
  assert.match(read('imports/ui/components/NativeCanvasConversation.jsx'), /retry=\{\(\) => ask\(refusal\.message\)\}/)
  assert.match(read('imports/ui/components/workshop/WorkshopConversation.jsx'), /retry=\{\(\) => submit\(payRefusal\.message\)\}/)
  // the slate's chat rows (the transcript): only the person refused sees the button
  assert.match(read('imports/ui/components/TranscriptionText.jsx'), /refusalForViewer\(m, Meteor\.userId\(\)\)/)
  // a conversation that could not start (Ask Slatebox, quick AI on a note): the reason with the action
  assert.match(read('imports/api/common/prepAISlate.js'), /return \{ abort, abortMessage, refusal \}/)
  assert.match(read('imports/api/common/initAIConversation.js'), /return \{ abort, abortMessage, refusal \}/)
  const adhoc = read('imports/ui/components/AdHocAINodes.jsx')
  assert.match(adhoc, /payAction\(refusal, \{ from: 'draft', retry: \(\) => adhocAINodes\(pkgs\), reason: abortMessage \}\)/)
  assert.match(read('imports/ui/components/ai/SlateAIRunner.jsx'), /payAction\(initResult\.refusal, \{ from: 'draft', retry: \(\) => handleWelcome\(resp, userMessage\), reason: text \}\)/)
  // image generation: the meter's reason with the action, never "check your prompt" for money
  assert.match(adhoc, /payAction\(err, \{ from: 'image', retry: \(\) => adhocAINodes\(pkgs\) \}\)/)
  assert.match(adhoc, /text: paid \? err\.reason :/)
  // calls: start, video on, the voice fallback and the ending notice
  const calls = read('imports/ui/components/CollaborationUsers.jsx')
  assert.match(calls, /payAction\(error, \{ from: 'call', retry: \(\) => setHuddleEnabled\(true\) \}\)/)
  assert.match(calls, /payAction\(error, \{ from: 'call', retry: \(\) => turnOnCamera\(\) \}\)/)
  assert.match(calls, /payAction\(\{ code: 'video-stage', reason: starterNotice \}, \{ from: 'call', retry: \(\) => videoOnAgain\(callId\) \}\)/)
  assert.match(calls, /joined\?\.starter \? payAction\(\{ code: 'calls-month'/)
  // the server says when video fell back to voice for the person who started the call
  assert.match(read('server/methods/daily.js'), /voiceFallback: Boolean\(starter && started && call\.notice\)/)
  assert.match(calls, /action=\{noticeAction &&/)
  assert.match(calls, /action=\{joinAction &&/)
  // picture search
  const pictures = read('imports/ui/components/stylebar/MoreMenu.jsx')
  assert.match(pictures, /<PayNotice plain refusal=\{refused\} from="pictures" retry=\{\(\) => search\(refused\.page\)\} \/>/)
  // presentations: the banner gains the action, and asks for the plan again
  const present = read('imports/ui/components/PresentSlate.jsx')
  assert.match(present, /<PayNotice plain refusal=\{planRefusal\} from="plan" retry=\{\(\) => setPlanAgain\(n => n \+ 1\)\} \/>/)
  assert.match(present, /\}, \[slate, planAgain\]\)/)
  // a global message can carry one action (client/main.jsx renders it)
  assert.match(read('client/main.jsx'), /message\.action \? <Button color="inherit" size="small"/)
})

test('exec, MCP and the API link to the sheet with &pay= (design §3.4)', async () => {
  const accounts = createAccounts({
    settings: { public: { env: 'cloud' }, metering: { enabled: true } },
    origin: 'https://app.slatebox.com/',
    findUser: async (id) => ({ _id: id, emails: [{ address: 'a@example.com', verified: true }], profile: {} }),
    findOrganization: async () => null,
    listClaims: async () => [],
    canGenerate: async () => true,
    proSummary: () => null,
  })
  const me = await accounts.summary({ userId: 'u1', kind: 'person' })
  assert.equal(me.links.credits, 'https://app.slatebox.com/profile?tab=credits')
  assert.equal(me.links.pay, 'https://app.slatebox.com/profile?tab=credits&pay=pro')
  assert.equal(me.links.topUp, 'https://app.slatebox.com/profile?tab=credits&pay=topup')
  // with Pro on, the link opens Your Pro; past due, the card
  const on = createAccounts({ settings: { public: {}, metering: { enabled: true } }, origin: 'https://x.test', findUser: async () => ({ _id: 'u', emails: [] }), findOrganization: async () => null, listClaims: async () => [], canGenerate: async () => false, proSummary: () => ({ active: true }) })
  assert.equal((await on.summary({ userId: 'u', kind: 'person' })).links.pay, 'https://x.test/profile?tab=credits&pay=manage')
  const due = createAccounts({ settings: { public: {}, metering: { enabled: true } }, origin: 'https://x.test', findUser: async () => ({ _id: 'u', emails: [] }), findOrganization: async () => null, listClaims: async () => [], canGenerate: async () => false, proSummary: () => ({ pastDue: true }) })
  assert.equal((await due.summary({ userId: 'u', kind: 'person' })).links.pay, 'https://x.test/profile?tab=credits&pay=card')
  // no meter: no pay links at all
  const self = createAccounts({ settings: { public: { env: 'selfhost' }, metering: { enabled: false } }, origin: 'https://x.test', findUser: async () => ({ _id: 'u', emails: [] }), findOrganization: async () => null, listClaims: async () => [], canGenerate: async () => false })
  const selfLinks = (await self.summary({ userId: 'u', kind: 'person' })).links
  assert.equal(selfLinks.pay, undefined)
  assert.equal(selfLinks.topUp, undefined)
  assert.match(read('server/actions/account-get.mjs'), /links\.pay/, 'the tool says what the link is for')
})

test('a signed-out person following a &pay= link keeps it through sign-in (design §4.1)', async () => {
  const { loginReturn } = await import('../web/app/imports/ui/components/billing/pay/pay-url.mjs')
  assert.equal(loginReturn(new URLSearchParams('pay=manage')), '/profile?tab=credits&pay=manage')
  assert.equal(loginReturn(new URLSearchParams('pay=topup')), '/profile?tab=credits&pay=topup')
  assert.equal(loginReturn(new URLSearchParams('pay=https://evil.test')), null)
  assert.equal(loginReturn(new URLSearchParams('')), null)
  // the login page goes on to the pane (/login?pay=pro)
  assert.match(read('imports/ui/pages/Login.jsx'), /loginReturn\(query\)/)
  // a guest's profile asks them to save their account; the link waits in the address until they have
  const host = read('imports/ui/components/billing/pay/PaySheetHost.jsx')
  assert.match(host, /if \(account === 'guest' && asked\.open\) return/)
  assert.match(host, /Meteor\.subscribe\(CONSTANTS\.publications\.users\.me\)\.ready\(\)/)
})

test('the new in-place notice never names the processor in what a person reads', () => {
  for (const file of ['imports/ui/components/PayNotice.jsx', 'imports/ui/components/billing/pay/pay-notice.mjs']) {
    const text = read(file)
    const visible = [
      ...[...text.matchAll(/>([^<>{}]+)</g)].map(m => m[1]),
      ...[...text.matchAll(/(?:label|title|aria-label|text|reason)\s*[:=]\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map(m => m[2]),
      ...[...text.matchAll(/'([^'\n]*)'/g)].map(m => m[1]).filter(s => / /.test(s)),
    ]
    for (const v of visible) assert.doesNotMatch(v, /stripe|upgrade|AI credits/i, `${file}: ${v}`)
  }
})
