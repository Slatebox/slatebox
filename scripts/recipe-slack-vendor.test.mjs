// Slack as a recipe vendor (enterprise/server/recipes/vendors/slack): the run's session reads only
// what the owner can see, counts every call against the run's budget, and keeps Slack's limits for an
// app not in the Marketplace (conversations.replies once a minute per workspace, shared with the
// Slack agent's gate; a 429's Retry-After holds it); the Events API intake keeps watched channels
// only (no DMs, edits replace text, deletions keep only "deleted"); the signed Slack route hands
// message events to it; a post goes only to a granted channel.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/recipe-slack-vendor.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANNEL, MESSAGES, OTHER_CHANNEL, TEAM } from '../enterprise/recipes/_slack-ledger/fixtures/checkout.mjs'
import { checkSlackHardLimits } from '../enterprise/server/recipes/vendors/slack/index.mjs'
import { setSlackRecipeIngest, slackRecipeIngest } from '../enterprise/server/recipes/vendors/slack/hand-off.mjs'
import { slackRoutes } from '../enterprise/server/slack/routes.mjs'
import { signatureOf } from '../enterprise/server/slack/verify.mjs'
import { slackManifest, SLACK_USER_EVENTS } from '../enterprise/server/slack/manifest.mjs'
import { countingBudget } from './fakes/recipe-lite-context.mjs'
import { OWNER, slackWorld, TOKEN } from './fakes/slack-recipe-world.mjs'

test('session: membership from the owner\'s own channels; names once per person; every call counted against the budget', async () => {
  const w = slackWorld()
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const budget = countingBudget({ vendorCalls: 4 })
  const s = await w.vendor.session(instance, { budget })
  assert.equal(await s.isMember(CHANNEL.id), true)
  assert.equal(await s.isMember(OTHER_CHANNEL.id), false, 'a channel the owner is not in')
  assert.deepEqual(await s.channelInfo(CHANNEL.id), { id: CHANNEL.id, name: CHANNEL.name, private: false })
  assert.equal(w.fake.counts['users.conversations'], 1, 'read once a run')
  const names = await s.names(['U0ANA', 'U0ANA', 'U0DANA', 'bogus'])
  assert.deepEqual([...names], [['U0ANA', 'Ana'], ['U0DANA', 'Dana']])
  await s.names(['U0ANA'])
  assert.equal(w.fake.counts['users.info'], 2)
  await assert.rejects(s.names(['U0RAJ', 'U0LEE']), { code: 'budget' }, 'the fifth call is over the budget')
})

test('session: a refused or missing sign-in pauses the recipe for "connect again", never a token in the error', async () => {
  const w = slackWorld()
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  w.api.token = 'xoxp-rotated'
  const s = await w.vendor.session(instance)
  const error = await s.isMember(CHANNEL.id).catch((e) => e)
  assert.equal(error.code, 'needs_sign_in')
  assert.ok(!JSON.stringify({ message: error.message, code: error.code }).includes(TOKEN))
  w.integration.status = 'needs_sign_in'
  await assert.rejects(w.vendor.session(instance), { code: 'needs_sign_in' })
  w.integration.status = 'active'
  w.integration.slackTeamId = 'T0OTHER001'
  await assert.rejects(w.vendor.session(instance), { code: 'needs_sign_in' }, 'another workspace than the recipe reads')
})

test('session: replies through the once-a-minute gate, shared by every recipe and the Slack agent; a 429 holds it', async () => {
  const w = slackWorld()
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  w.api.replies['1795187400.000004'] = MESSAGES.slice(3, 8)
  const one = await w.vendor.session(instance)
  const two = await w.vendor.session(instance)
  assert.equal((await one.replies(CHANNEL.id, '1795187400.000004')).length, 5)
  assert.equal(await two.replies(CHANNEL.id, '1795187400.000004'), null, 'the minute is taken')
  assert.ok(w.gates.rows.has(`${TEAM}:conversations.replies`), 'the same gate id as the Slack agent\'s read_thread')
  w.clock.at += 61000
  w.api.limited = { 'conversations.replies': 120 }
  assert.equal(await one.replies(CHANNEL.id, '1795187400.000004'), null, 'Slack said slow down')
  w.api.limited = {}
  w.clock.at += 61000
  assert.equal(await one.replies(CHANNEL.id, '1795187400.000004'), null, 'held for Retry-After (120 s), not a minute')
  w.clock.at += 60000
  assert.ok(await one.replies(CHANNEL.id, '1795187400.000004'))
  // A listed (Marketplace or internal) app has no once-a-minute gate.
  const listed = slackWorld({ listed: true })
  const li = listed.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const ls = await listed.vendor.session(li)
  assert.ok(await ls.replies(CHANNEL.id, '1.000001'))
  assert.ok(await ls.replies(CHANNEL.id, '1.000001'))
})

test('session: backfill searches the channel by name since a day (5 pages at most), and stops on a 429', async () => {
  const pages = []
  const w = slackWorld({ search: (query, page) => {
    pages.push({ query, page })
    return { matches: page === 1 ? [{ ts: '1795187400.000004', user: 'U0ANA', text: 'hello', channel: { id: CHANNEL.id }, permalink: 'https://acme.slack.com/archives/C0CHECKOUT1/p1795187400000004' }, { ts: '1795187500.000005', user: 'U0RAJ', text: 'reply', channel: { id: CHANNEL.id }, permalink: 'https://acme.slack.com/archives/C0CHECKOUT1/p1795187500000005?thread_ts=1795187400.000004&cid=C0CHECKOUT1' }] : [], pages: 9 }
  } })
  const instance = w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  const s = await w.vendor.session(instance)
  const back = await s.backfill(CHANNEL.id, { since: Date.parse('2026-11-13T18:00:00Z') })
  assert.equal(pages[0].query, 'in:#proj-checkout after:2026-11-12')
  assert.equal(back.messages.length, 2)
  assert.equal(back.messages[1].threadTs, '1795187400.000004', 'the thread from the permalink')
  assert.deepEqual(back.threads, [{ ts: '1795187400.000004', replies: 1 }])
  const many = slackWorld({ search: (q, page) => ({ matches: [{ ts: `17951874${String(page).padStart(2, '0')}.000001`, user: 'U0ANA', text: 'x', channel: { id: CHANNEL.id } }], pages: 9 }) })
  const ms = await many.vendor.session(many.addInstance('i2', 'slack-decision-log', { channels: [CHANNEL.id] }))
  const capped = await ms.backfill(CHANNEL.id, { since: Date.parse('2026-11-13T18:00:00Z') })
  assert.equal(many.fake.counts['search.messages'], 5)
  assert.equal(capped.partial, 'more_history')
  w.api.limited = { 'search.messages': 30 }
  assert.equal((await s.backfill(CHANNEL.id, { since: Date.parse('2026-11-13T18:00:00Z') })).partial, 'rate_limited')
})

test('intake: watched channels only; no direct messages; an edit replaces the text; a deletion keeps only "deleted"; reactions counted; each recipe triggered', async () => {
  const w = slackWorld()
  w.addInstance('i1', 'slack-decision-log', { channels: [CHANNEL.id] })
  w.addInstance('i2', 'slack-timeline', { channels: [CHANNEL.id] })
  const send = (event) => w.vendor.ingest.handle({ type: 'event_callback', team_id: TEAM, event })
  assert.deepEqual(await send({ type: 'message', channel: CHANNEL.id, channel_type: 'channel', ts: '1795200000.000001', user: 'U0ANA', text: 'We decided to ship Friday', files: [{ id: 'F1' }], attachments: [{ text: 'secret' }] }), { kept: 1, triggered: 2 })
  assert.deepEqual(w.triggers.map((t) => t.instanceId), ['i1', 'i2'])
  assert.deepEqual(w.triggers[0].trigger, { kind: 'vendor', event: 'slack.message', channels: [CHANNEL.id] })
  assert.deepEqual(await send({ type: 'message', channel: OTHER_CHANNEL.id, channel_type: 'channel', ts: '1795200000.000002', user: 'U0RAJ', text: 'not watched' }), { kept: 0, triggered: 0 })
  assert.deepEqual(await send({ type: 'message', channel: 'D0DIRECT01', channel_type: 'im', ts: '1795200000.000003', user: 'U0RAJ', text: 'a DM' }), { kept: 0, triggered: 0 })
  await send({ type: 'message', subtype: 'message_changed', channel: CHANNEL.id, message: { ts: '1795200000.000001', user: 'U0ANA', text: 'We decided to ship Monday' } })
  await send({ type: 'reaction_added', reaction: 'white_check_mark', user: 'U0RAJ', item: { type: 'message', channel: CHANNEL.id, ts: '1795200000.000001' } })
  await send({ type: 'reaction_added', reaction: 'white_check_mark::skin-tone-2', user: 'U0LEE', item: { type: 'message', channel: CHANNEL.id, ts: '1795200000.000001' } })
  await send({ type: 'reaction_removed', reaction: 'white_check_mark', user: 'U0LEE', item: { type: 'message', channel: CHANNEL.id, ts: '1795200000.000001' } })
  let [row] = await w.stores.inbox.list(TEAM, CHANNEL.id)
  assert.equal(row.text, 'We decided to ship Monday')
  assert.deepEqual(row.reactions, [{ name: 'white_check_mark', count: 1 }])
  const stored = w.stores.inbox._rows.get(`slack:${TEAM}:${CHANNEL.id}:1795200000.000001`)
  assert.ok(!('files' in stored) && !('attachments' in stored), 'files and attachments are never kept')
  assert.ok(stored.expiresAt - Date.parse('2026-11-27T18:00:00Z') <= 2 * 86400000, 'two days')
  await send({ type: 'message', subtype: 'message_deleted', channel: CHANNEL.id, deleted_ts: '1795200000.000001', previous_message: { ts: '1795200000.000001', text: 'We decided to ship Monday' } })
  ;[row] = await w.stores.inbox.list(TEAM, CHANNEL.id)
  assert.equal(row.deleted, true)
  assert.equal(row.text, '')
  // Deleting the instances: rows no other instance reads go.
  await w.vendor.forget('i1')
  assert.equal((await w.stores.inbox.list(TEAM, CHANNEL.id)).length, 1, 'i2 still reads it')
  await w.vendor.forget('i2')
  assert.equal((await w.stores.inbox.list(TEAM, CHANNEL.id)).length, 0)
})

test('the Slack events route: a signed message event reaches the recipe ingest after the answer; none while recipes are off', async () => {
  const SIGNING = 'slack-signing-secret-0123456789'
  const handled = []
  let later = []
  const routes = slackRoutes({
    slack: () => ({ signingSecret: async () => SIGNING }),
    events: { claim: async () => true },
    recipes: slackRecipeIngest,
    later: (fn) => later.push(fn),
    now: () => 1795200000000,
  })
  const events = routes.find((r) => r.path === '/integrations/slack/events')
  const post = async (body) => {
    const raw = JSON.stringify(body)
    const timestamp = '1795200000'
    const req = { headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': signatureOf(SIGNING, timestamp, raw) }, rawBody: Buffer.from(raw), async *[Symbol.asyncIterator]() { yield Buffer.from(raw) } }
    const res = { statusCode: 0, status(code) { this.statusCode = code; return this }, end() { return this }, json() { return this } }
    await events.handler(req, res)
    return res
  }
  const body = { type: 'event_callback', event_id: 'Ev01', team_id: TEAM, event: { type: 'message', channel: CHANNEL.id, ts: '1795200000.000001', text: 'hi' } }
  setSlackRecipeIngest(null)
  assert.equal((await post(body)).statusCode, 200)
  assert.equal(later.length, 0, 'recipes off: nothing to hand to')
  setSlackRecipeIngest({ handles: (type) => type === 'message', handle: async (b) => handled.push(b.event.ts) })
  const res = await post({ ...body, event_id: 'Ev02' })
  assert.equal(res.statusCode, 200)
  assert.equal(handled.length, 0, 'answered first')
  for (const fn of later) await fn()
  assert.deepEqual(handled, ['1795200000.000001'])
  setSlackRecipeIngest(null)
})

test('the Slack app manifest subscribes to the connected people\'s channel messages (user events)', () => {
  const manifest = slackManifest({ origin: 'https://app.slatebox.com' })
  assert.deepEqual(manifest.settings.event_subscriptions.user_events, [...SLACK_USER_EVENTS])
  assert.deepEqual(SLACK_USER_EVENTS, ['message.channels', 'message.groups'])
  for (const scope of ['channels:history', 'groups:history']) assert.ok(manifest.oauth_config.scopes.user.includes(scope), `${scope} backs the events`)
})

test('a post: only in the granted channel, never empty or too long; performed as the owner with its link', async () => {
  const grant = { scope: { channels: [CHANNEL.id] } }
  const post = { kind: 'slack.post', target: { channel: CHANNEL.id }, body: { text: 'Week of Nov 23 digest' }, key: 'digest:2026-11-23' }
  assert.equal(checkSlackHardLimits(post, grant), null)
  assert.equal(checkSlackHardLimits({ ...post, target: { channel: OTHER_CHANNEL.id } }, grant), 'refused')
  assert.equal(checkSlackHardLimits({ ...post, body: { text: ' ' } }, grant), 'refused')
  assert.equal(checkSlackHardLimits({ ...post, body: { text: 'x'.repeat(3001) } }, grant), 'refused')
  assert.equal(checkSlackHardLimits({ ...post, kind: 'github.pull_request' }, grant), 'refused')
  const w = slackWorld()
  const instance = w.addInstance('i1', 'slack-digest', { channels: [CHANNEL.id] })
  await assert.rejects(w.vendor.perform({ ...post, target: { channel: OTHER_CHANNEL.id } }, { instance, grant }), { code: 'refused' })
  assert.equal(w.api.posted.length, 0)
  const done = await w.vendor.perform(post, { instance, grant })
  assert.deepEqual(w.api.posted.map((p) => p.channel), [CHANNEL.id])
  assert.match(done.ref, /^https:\/\/acme\.slack\.com\/archives\/C0CHECKOUT1\/p/)
  assert.equal(OWNER, instance.ownerId)
})
