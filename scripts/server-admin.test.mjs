// Server admin (the uberMensch claim) and the admin home's Overview.
//   - A server administrator is the uberMensch row alone ({ userId, claimId: 'uberMensch' }, no
//     orgId): a person with no team who holds it opens /admin, /admin/ai and /admin/library, and
//     their methods answer; a team admin without it is refused everywhere. (2026-11-24: the owner
//     held the row on prod with no team and met the 404 page: the permissions publication sends a
//     team's rows only, and AuthManager.userHasClaim demanded the team 'admin' claim as well.)
//   - The browser asks admin.status for the links it draws; the server stays the gate.
//   - admin.dashboard: administrators only, kept a minute, Stripe read only (a fake client here),
//     "Payments are off on this server" without payments, masked emails, one card's failure alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_SECTIONS, SERVER_ADMIN_CLAIM, adminLinksFor, adminRouteState, decideClaims, isServerAdminFromRows, serverAdminSelector, splitClaims,
} from '../web/app/imports/api/common/server-admin.mjs'
import {
  PAYMENTS_OFF_WORDS, classifyPrice, createAdminDashboard, listAll, maskEmail, monthlyAmount, plainError, stripeDashboardUrl, stripeSummary, summarizeSubscriptions,
} from '../web/app/server/admin/dashboard-core.mjs'
import { count, micros, money, moneyTotals } from '../web/app/imports/ui/pages/admin/overview-format.mjs'
import { libraryCollection, makeLibrary } from './library-test-stores.mjs'
import { createAISettings } from '../web/app/server/methods/ai/ai-settings-core.mjs'
import { loadMasterKey } from '../web/app/server/metering/vault.mjs'
import { PRO_LOOKUP_KEYS } from '../web/app/imports/api/pro/prices.mjs'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')

// The owner's account on prod: the uberMensch row, no orgId, no team. Ann runs a team and is its admin.
const PERMISSIONS = [
  { _id: 'p1', userId: 'tim', claimId: 'uberMensch' },
  { _id: 'p2', userId: 'ann', orgId: 'team1', claimId: 'admin' },
  { _id: 'p3', userId: 'ann', orgId: 'team1', claimId: 'canViewUsers' },
]
const USERS = { tim: { _id: 'tim' }, ann: { _id: 'ann', orgId: 'team1' }, guest: { _id: 'guest', isAnonymous: true } }
// the server's check, against the rows as Mongo would match its selector (permissions.js isInstanceAdmin)
const permissions = libraryCollection(PERMISSIONS)
const isInstanceAdmin = async (userId) => Boolean(userId && (await permissions.findOne(serverAdminSelector(userId))))

// ---------- who is a server administrator ----------
test('the uberMensch row alone makes a server administrator; a team admin is not one', async () => {
  assert.deepEqual(serverAdminSelector('tim'), { userId: 'tim', claimId: SERVER_ADMIN_CLAIM })
  assert.equal(await isInstanceAdmin('tim'), true, 'a team-less uberMensch row')
  assert.equal(await isInstanceAdmin('ann'), false, 'a team admin without uberMensch')
  assert.equal(await isInstanceAdmin(''), false)
  assert.equal(isServerAdminFromRows(PERMISSIONS, 'tim'), true)
  assert.equal(isServerAdminFromRows(PERMISSIONS, 'ann'), false)
})

test('AuthManager asks for uberMensch alone: it never also demands the team admin claim (mustBeInAll)', () => {
  assert.deepEqual(splitClaims(['uberMensch']), { serverAdmin: true, team: [] })
  assert.deepEqual(splitClaims(['canViewUsers']), { serverAdmin: false, team: ['canViewUsers', 'admin'] })
  // the owner: uberMensch, no team, no team claims
  assert.equal(decideClaims({ claims: ['uberMensch'], isServerAdmin: true, teamClaimIds: [], mustBeInAll: true }), true)
  assert.equal(decideClaims({ claims: ['uberMensch'], isServerAdmin: true, mustBeInAll: false }), true)
  // a team admin holding every team claim is still not a server administrator
  assert.equal(decideClaims({ claims: ['uberMensch'], isServerAdmin: false, teamClaimIds: ['admin', 'canViewUsers'], mustBeInAll: true }), false)
  assert.equal(decideClaims({ claims: ['uberMensch'], isServerAdmin: false, teamClaimIds: ['admin'], mustBeInAll: false }), false)
  // team claims read as before: the team admin claim counts for any of them
  assert.equal(decideClaims({ claims: ['canViewUsers'], isServerAdmin: false, teamClaimIds: ['admin'] }), true)
  assert.equal(decideClaims({ claims: ['canViewUsers'], isServerAdmin: false, teamClaimIds: ['canViewUsers'], mustBeInAll: true }), false)
  assert.equal(decideClaims({ claims: ['canViewUsers'], isServerAdmin: true, teamClaimIds: [] }), false, 'uberMensch is not a team claim')

  const auth = read('imports/api/common/AuthManager.js')
  assert.match(auth, /decideClaims\(/)
  assert.match(auth, /serverAdminSelector\(userId\)/)
  assert.match(auth, /CONSTANTS\.methods\.admin\.status/, 'a browser asks the server, which has the row')
  assert.doesNotMatch(auth, /uclaims\.concat\(CONSTANTS\.claims\.admin\._id\)/)
})

test('no admin gate reads uberMensch through the team claim check', () => {
  for (const file of ['imports/ui/SBRoutes.jsx', 'imports/ui/pages/AdminTools.jsx', 'server/methods/users.js']) {
    assert.doesNotMatch(read(file), /userHasClaim\([\s\S]{0,80}uberMensch/, file)
  }
  const users = read('server/methods/users.js')
  assert.equal((users.match(/await isInstanceAdmin\(Meteor\.userId\(\)\)/g) || []).length, 2, 'users.search and users.certifyForEducation')
  // the other server gates read the row alone already
  assert.match(read('server/permissions.js'), /Permissions\.findOneAsync\(\{ userId, claimId: CONSTANTS\.claims\.uberMensch\._id \}/)
  assert.match(read('server/library/meteor.js'), /Permissions\.findOneAsync\(\{ userId, claimId: CONSTANTS\.claims\.uberMensch\._id \}/)
  assert.match(read('server/methods/ai/ai-settings.js'), /isServerAdmin = \(userId\) => isInstanceAdmin\(userId\)/)
  assert.match(read('server/enterprise.js'), /Permissions\.findOneAsync\(\{ userId, claimId: CONSTANTS\.claims\.uberMensch\._id \}/)
})

// ---------- the admin routes ----------
test('/admin, /admin/ai and /admin/library open for a team-less administrator and show Not found to anyone else', () => {
  assert.equal(adminRouteState({ userId: 'tim', admin: true }), 'allow')
  assert.equal(adminRouteState({ userId: 'ann', admin: false }), 'notfound')
  assert.equal(adminRouteState({ userId: 'tim', admin: null }), 'wait', 'never a 404 before the server answers')
  assert.equal(adminRouteState({ loggingIn: true, userId: null, admin: null }), 'wait')
  assert.equal(adminRouteState({ userId: null, admin: false }), 'notfound')

  const routes = read('imports/ui/SBRoutes.jsx')
  for (const [path, page] of [['/admin', 'AdminTools'], ['/admin/library', 'LibraryReview'], ['/admin/ai', 'AIControl']]) {
    assert.ok(routes.includes(`<Route path="${path}" element={<PrivateRoute><AdminRoute><${page} /></AdminRoute></PrivateRoute>} />`), path)
  }
  assert.doesNotMatch(routes, /isElevatedUser/, 'routes are always defined; the gate decides')
  assert.match(routes, /const admin = useServerAdmin\(\)/)
  assert.match(routes, /adminRouteState\(/)
  const hook = read('imports/ui/common/useServerAdmin.js')
  assert.match(hook, /Meteor\.callAsync\(CONSTANTS\.methods\.admin\.status\)/)
})

// ---------- the account menu and the profile ----------
test('the Admin item and the profile\'s Server admin section are for administrators only', () => {
  assert.deepEqual(adminLinksFor(true).map((s) => s.to), ['/admin', '/admin/ai', '/admin/library'])
  assert.deepEqual(adminLinksFor(false), [])
  assert.deepEqual(adminLinksFor(null), [], 'nothing while the server has not answered')
  assert.deepEqual(adminLinksFor('yes'), [])
  assert.deepEqual(ADMIN_SECTIONS.map((s) => s.title), ['Admin overview', 'AI control', 'Library review'])
  assert.match(ADMIN_SECTIONS[1].detail, /models, providers, bindings and prompts/i)

  const menu = read('imports/ui/components/AccountMenu.jsx')
  assert.match(menu, /const admin = useServerAdmin\(\)/)
  assert.match(menu, /const \[adminHome\] = adminLinksFor\(admin\)/)
  assert.match(menu, /\{!guest && adminHome && <MenuItem onClick=\{go\(\(\) => navigate\(adminHome\.to\)\)\} data-account-admin="">/)
  assert.match(menu, /<ListItemText>Admin<\/ListItemText>/)
  // the hook runs before the menu's early return (rules of hooks)
  assert.ok(menu.indexOf('useServerAdmin()') < menu.indexOf('if (!user) return null'))

  const profile = read('imports/ui/pages/Profile.jsx')
  assert.match(profile, /const adminLinks = adminLinksFor\(useServerAdmin\(\)\)/)
  assert.match(profile, /\{adminLinks\.length > 0 && \(\s*<AccountSection title="Server admin"/)
  assert.match(profile, /adminLinks\.map\(\(section\) =>/)

  const home = read('imports/ui/pages/AdminTools.jsx')
  assert.match(home, /ADMIN_SECTIONS\.map/, 'the admin home links its sections')
  assert.match(home, /<AdminOverview \/>/)
  assert.doesNotMatch(home, /AuthManager/)
})

// ---------- the methods of the admin pages, for a team-less administrator ----------
test('library review answers a team-less administrator and refuses a team admin', async () => {
  const reviewers = []
  for (const id of Object.keys(USERS)) if (await isInstanceAdmin(id)) reviewers.push(id)
  assert.deepEqual(reviewers, ['tim'])
  const { library, ready } = makeLibrary({ slates: libraryCollection(), saveCore: {}, reviewers, users: USERS, teamAdmins: [{ userId: 'ann', orgId: 'team1' }] })
  await ready
  const answer = await library.review.queue({ userId: 'tim' }, { status: 'waiting' })
  assert.equal(typeof answer.total, 'number')
  await assert.rejects(library.review.queue({ userId: 'ann' }, { status: 'waiting' }), (error) => error.status === 403 && error.code === 'reviewer_required')
})

test('AI control\'s server connections answer a team-less administrator and refuse a team admin', async () => {
  const keys = []
  const store = {
    async listConnections() { return keys.map((k) => ({ ...k })) },
    async saveConnection(owner, doc) { keys.push({ ...doc }) },
    async removeConnection() {},
    async getUse() { return null },
    async setUse() {},
  }
  const ai = createAISettings({
    store,
    // a key made for this test run only
    master: loadMasterKey({ SLATEBOX_KEY_ENCRYPTION_KEY: randomBytes(32).toString('base64') }),
    settings: {}, hosted: true,
    loadUser: async (userId) => USERS[userId] || null,
    isAdmin: isInstanceAdmin,
    isTeamAdmin: async (user) => Boolean(user?.orgId && PERMISSIONS.some((p) => p.userId === user._id && p.orgId === user.orgId && p.claimId === 'admin')),
    check: async () => ({ ok: true }),
  })
  const answer = await ai.serverConnections('tim')
  assert.ok(Array.isArray(answer.connections))
  await assert.rejects(ai.serverConnections('ann'), (error) => error.status === 403)
})

// ---------- the Overview ----------
test('emails are masked t…@domain; nothing that is not an address is shown', () => {
  assert.equal(maskEmail('tim@slatebox.com'), 't…@slatebox.com')
  assert.equal(maskEmail('  a.b+c@x.co '), 'a…@x.co')
  assert.equal(maskEmail('a@b@c.com'), 'a…@c.com')
  for (const bad of ['', '@x.com', 'nobody', 'x@', null, undefined, 42]) assert.equal(maskEmail(bad), null, String(bad))
})

test('an error never carries a key', () => {
  const said = plainError(new Error('Invalid API Key provided: sk_live_********************abcd'))
  assert.ok(!/sk_live/.test(said))
  assert.match(said, /\[key\]/)
  assert.equal(plainError(null), 'Could not read this.')
})

test('Stripe Dashboard links say live or test', () => {
  assert.equal(stripeDashboardUrl('live', 'customers'), 'https://dashboard.stripe.com/customers')
  assert.equal(stripeDashboardUrl('test', '/subscriptions'), 'https://dashboard.stripe.com/test/subscriptions')
})

// A fake Stripe client: list calls only, in pages of `limit`, newest first. Any other call throws,
// so the Overview is proven read only.
function fakeStripe(data, { fail = {} } = {}) {
  const calls = []
  const lister = (name) => async (params = {}) => {
    calls.push({ name, params })
    if (fail[name]) throw new Error(fail[name])
    let rows = data[name] || []
    if (params.created?.gte) rows = rows.filter((r) => (r.created ?? 0) >= params.created.gte)
    if (name === 'checkout.sessions' && params.status) rows = rows.filter((r) => r.status === params.status)
    if (name === 'invoices' && params.status) rows = rows.filter((r) => r.status === params.status)
    const start = params.starting_after ? rows.findIndex((r) => r.id === params.starting_after) + 1 : 0
    const page = rows.slice(start, start + (params.limit || 10))
    return { data: page, has_more: start + page.length < rows.length }
  }
  const refuse = (name) => () => { throw new Error(`write call ${name}`) }
  const resource = (name) => ({ list: lister(name), create: refuse(`${name}.create`), update: refuse(`${name}.update`), del: refuse(`${name}.del`), retrieve: refuse(`${name}.retrieve`) })
  return {
    calls,
    customers: resource('customers'), subscriptions: resource('subscriptions'), invoices: resource('invoices'), refunds: resource('refunds'), charges: resource('charges'),
    checkout: { sessions: resource('checkout.sessions') },
  }
}

const NOW = Date.parse('2026-11-24T12:00:00Z')
const sec = (iso) => Math.floor(Date.parse(iso) / 1000)
const PLANS = { pro: PRO_LOOKUP_KEYS, business: { month: 'price_bizM', year: 'price_bizY' } }
const proMonth = { id: 'price_proM', lookup_key: PRO_LOOKUP_KEYS.month, unit_amount: 500, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }
const proYear = { id: 'price_proY', lookup_key: PRO_LOOKUP_KEYS.year, unit_amount: 5000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } }
const bizMonth = { id: 'price_bizM', unit_amount: 1200, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }
const bizYear = { id: 'price_bizY', unit_amount: 12000, currency: 'usd', recurring: { interval: 'year', interval_count: 1 } }
const sub = (id, status, price, quantity = 1) => ({ id, status, items: { data: [{ price, quantity }] } })

function stripeWorld() {
  const customers = Array.from({ length: 130 }, (_, i) => ({ id: `cus_${String(200 - i).padStart(3, '0')}`, email: `person${i}@example.com`, created: sec('2026-11-24T00:00:00Z') - i * 86400 }))
  return {
    customers,
    subscriptions: [
      sub('sub_1', 'active', proMonth), sub('sub_2', 'active', proMonth), sub('sub_3', 'trialing', proYear), sub('sub_4', 'active', proYear),
      sub('sub_5', 'past_due', bizMonth, 7), sub('sub_6', 'active', bizYear, 10), sub('sub_7', 'canceled', proMonth), sub('sub_8', 'incomplete', bizMonth, 3),
    ],
    invoices: [
      { id: 'in_1', status: 'paid', amount_paid: 500, currency: 'usd', created: sec('2026-11-20T00:00:00Z') },
      { id: 'in_2', status: 'paid', amount_paid: 8400, currency: 'usd', created: sec('2026-11-01T00:00:00Z') },
      { id: 'in_3', status: 'open', amount_paid: 0, currency: 'usd', created: sec('2026-11-02T00:00:00Z') },
      { id: 'in_old', status: 'paid', amount_paid: 99999, currency: 'usd', created: sec('2026-09-01T00:00:00Z') },
    ],
    refunds: [
      { id: 're_1', status: 'succeeded', amount: 500, currency: 'usd', created: sec('2026-11-21T00:00:00Z') },
      { id: 're_2', status: 'failed', amount: 700, currency: 'usd', created: sec('2026-11-21T00:00:00Z') },
    ],
    charges: [
      { id: 'ch_1', status: 'succeeded', amount: 500, currency: 'usd', created: sec('2026-11-20T00:00:00Z') },
      { id: 'ch_2', status: 'failed', amount: 1200, currency: 'usd', created: sec('2026-11-19T00:00:00Z') },
      { id: 'ch_3', status: 'failed', amount: 500, currency: 'usd', created: sec('2026-11-18T00:00:00Z') },
    ],
    'checkout.sessions': [
      { id: 'cs_1', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 2000, currency: 'usd', created: sec('2026-11-15T00:00:00Z') },
      { id: 'cs_2', mode: 'subscription', status: 'complete', payment_status: 'paid', amount_total: 500, currency: 'usd', created: sec('2026-11-15T00:00:00Z') },
      { id: 'cs_3', mode: 'payment', status: 'expired', amount_total: 1000, currency: 'usd', created: sec('2026-11-15T00:00:00Z') },
    ],
  }
}

test('subscriptions split by plan and status, with members and MRR/ARR at list price', () => {
  assert.equal(classifyPrice(proMonth, PLANS), 'pro_monthly')
  assert.equal(classifyPrice({ product: 'slatebox_pro', recurring: { interval: 'year' } }, PLANS), 'pro_yearly')
  assert.equal(classifyPrice(bizYear, PLANS), 'business_yearly')
  assert.equal(classifyPrice({ id: 'price_x' }, PLANS), 'other')
  assert.equal(monthlyAmount(proYear), 5000 / 12)
  assert.equal(monthlyAmount(bizMonth, 7), 8400)
  assert.equal(monthlyAmount({ unit_amount: 100, recurring: { interval: 'month', interval_count: 3 } }), 100 / 3)
  const { byPlan, totals, mrr, arr } = summarizeSubscriptions(stripeWorld().subscriptions, PLANS)
  assert.deepEqual(totals, { active: 4, trialing: 1, past_due: 1, canceled: 1, other: 1 })
  assert.deepEqual(byPlan.pro_monthly, { active: 2, trialing: 0, past_due: 0, canceled: 1, other: 0, members: 2 })
  assert.deepEqual(byPlan.pro_yearly, { active: 1, trialing: 1, past_due: 0, canceled: 0, other: 0, members: 2 })
  assert.deepEqual(byPlan.business_monthly, { active: 0, trialing: 0, past_due: 1, canceled: 0, other: 1, members: 7 })
  assert.deepEqual(byPlan.business_yearly, { active: 1, trialing: 0, past_due: 0, canceled: 0, other: 0, members: 10 })
  // active + past due: 2×500 + 5000/12 + 7×1200 + 10×12000/12 (the trial and the canceled one left out)
  assert.deepEqual(mrr, { usd: Math.round(1000 + 5000 / 12 + 8400 + 10000) })
  assert.deepEqual(arr, { usd: mrr.usd * 12 })
})

test('listAll pages with starting_after and stops at the cap', async () => {
  const stripe = fakeStripe(stripeWorld())
  const all = await listAll((p) => stripe.customers.list(p), {}, 2000)
  assert.equal(all.items.length, 130)
  assert.equal(all.capped, false)
  assert.equal(stripe.calls.filter((c) => c.name === 'customers').length, 2)
  assert.equal(stripe.calls[1].params.starting_after, all.items[99].id)
  const capped = await listAll((p) => stripe.customers.list(p), {}, 50)
  assert.equal(capped.items.length, 50)
  assert.equal(capped.capped, true)
})

test('the Stripe cards: customers (newest 10 masked), invoices, refunds, failed payments, top-ups; list calls only', async () => {
  const stripe = fakeStripe(stripeWorld())
  const out = await stripeSummary({ stripe, plans: PLANS, mode: 'test', now: NOW })
  assert.equal(out.on, true)
  assert.equal(out.mode, 'test')
  assert.equal(out.customers.ok, true)
  assert.equal(out.customers.count, 130)
  assert.equal(out.customers.recent, 30, 'created in the last 30 days')
  assert.equal(out.customers.newest.length, 10)
  assert.deepEqual(out.customers.newest[0], { email: 'p…@example.com', created: '2026-11-24T00:00:00.000Z' })
  assert.ok(out.customers.newest.every((c) => !/person\d/.test(c.email)), 'no full address')
  assert.equal(out.customers.url, 'https://dashboard.stripe.com/test/customers')
  assert.deepEqual([out.invoices.count, out.invoices.total], [2, { usd: 8900 }])
  assert.deepEqual([out.refunds.count, out.refunds.total], [1, { usd: 500 }])
  assert.deepEqual([out.failed.count, out.failed.total], [2, { usd: 1700 }])
  assert.deepEqual([out.topUps.count, out.topUps.total], [1, { usd: 2000 }])
  assert.equal(out.subscriptions.byPlan.business_yearly.members, 10)
  assert.ok(out.revenue.mrr.usd > 0)
  assert.ok(stripe.calls.every((c) => ['customers', 'subscriptions', 'invoices', 'refunds', 'charges', 'checkout.sessions'].includes(c.name)))
  assert.equal(stripe.calls.filter((c) => c.name === 'subscriptions').length, 1, 'subscriptions read once for two cards')
  assert.ok(stripe.calls.filter((c) => c.name === 'subscriptions').every((c) => c.params.status === 'all'))
})

test('a Stripe failure shows on its own card; the others stay', async () => {
  const stripe = fakeStripe(stripeWorld(), { fail: { invoices: 'Stripe is down for sk_test_abc123', subscriptions: 'boom' } })
  const out = await stripeSummary({ stripe, plans: PLANS, mode: 'live', now: NOW })
  assert.equal(out.invoices.ok, false)
  assert.ok(!/sk_test/.test(out.invoices.error))
  assert.equal(out.subscriptions.ok, false)
  assert.equal(out.revenue.ok, false)
  assert.equal(out.customers.ok, true)
  assert.equal(out.refunds.ok, true)
})

function localIo(overrides = {}) {
  return {
    people: async () => ({ members: 40, guests: 300, signups7: 3, signups30: 12 }),
    plans: async () => ({ pro: { active: 4, trialing: 1, pastDue: 0 }, business: { teams: 2, members: 17 } }),
    usage: async () => ({
      spent: { includedMicros: 1_200_000, balanceMicros: 300_000, costMicros: 1_500_000 },
      byModel: [{ name: 'muse-ember-1.0', costMicros: 900_000, uses: 40 }],
      byFeature: [{ name: 'chat', costMicros: 900_000, uses: 40 }],
      calls: { voiceMinutes: 120, videoMinutes: 30 },
      topSpenders: [{ payerType: 'user', payerId: 'tim', costMicros: 700_000, chargeMicros: 0 }, { payerType: 'org', payerId: 'team1', costMicros: 100_000 }],
    }),
    grants: async () => ({ proPeople: 5, topUpMicros: 20_000_000 }),
    library: async () => ({ waiting: 3 }),
    emailsOf: async () => ({ tim: 'tim@slatebox.com' }),
    ...overrides,
  }
}

function dashboard({ payments = () => ({ on: false, mode: null }), stripe, io = localIo(), meterOn = () => true, clock } = {}) {
  let at = NOW
  const now = clock || (() => at)
  const made = createAdminDashboard({
    isAdmin: isInstanceAdmin, payments, stripe: stripe || (() => { throw new Error('Stripe must not be asked') }),
    plans: () => PLANS, io, meterOn, proAllowanceMicros: 3_750_000, now,
  })
  return { ...made, tick: (ms) => { at += ms } }
}

test('admin.status and admin.dashboard: a team-less administrator yes; a team admin, a guest and nobody are refused', async () => {
  const d = dashboard()
  assert.deepEqual(await d.status('tim'), { admin: true })
  assert.deepEqual(await d.status('ann'), { admin: false })
  assert.deepEqual(await d.status(null), { admin: false })
  for (const who of ['ann', 'guest', null, '']) await assert.rejects(d.dashboard(who), { code: 'denied' }, String(who))
  const out = await d.dashboard('tim')
  assert.equal(out.people.members, 40)
})

test('payments off: no Stripe call, and the page says so', async () => {
  const d = dashboard()
  const out = await d.dashboard('tim')
  assert.deepEqual(out.payments, { ok: true, on: false, words: PAYMENTS_OFF_WORDS })
  assert.equal(PAYMENTS_OFF_WORDS, 'Payments are off on this server')
  assert.equal(out.library.waiting, 3)
})

test('payments on: Stripe cards in the key\'s mode; a client that cannot be made shows on the payments card only', async () => {
  const stripe = fakeStripe(stripeWorld())
  const on = await dashboard({ payments: () => ({ on: true, mode: 'live' }), stripe: () => stripe }).dashboard('tim')
  assert.equal(on.payments.ok, true)
  assert.equal(on.payments.mode, 'live')
  assert.equal(on.payments.customers.url, 'https://dashboard.stripe.com/customers')
  const broken = await dashboard({ payments: () => ({ on: true, mode: 'test' }), stripe: () => { throw new Error('This works on Slatebox Cloud only.') } }).dashboard('tim')
  assert.equal(broken.payments.ok, false)
  assert.equal(broken.people.ok, true)
})

test('agent usage: credits granted against spent, masked top spenders, calls; the meter off says so', async () => {
  const out = await dashboard().dashboard('tim')
  assert.equal(out.usage.ok, true)
  assert.deepEqual(out.usage.granted, { proAllowanceMicros: 5 * 3_750_000, proPeople: 5, topUpMicros: 20_000_000 })
  assert.equal(out.usage.spent.includedMicros, 1_200_000)
  assert.deepEqual(out.usage.topSpenders.map((s) => s.who), ['t…@slatebox.com', 'A team'])
  assert.ok(!JSON.stringify(out).includes('tim@slatebox.com'), 'no full address anywhere in the answer')
  assert.deepEqual(out.usage.calls, { voiceMinutes: 120, videoMinutes: 30 })
  assert.equal(out.usage.month, '2026-11')
  const off = await dashboard({ meterOn: () => false }).dashboard('tim')
  assert.deepEqual(off.usage, { ok: true, meterOn: false })
})

test('a database failure shows on its own card', async () => {
  const out = await dashboard({ io: localIo({ people: async () => { throw new Error('db down') } }) }).dashboard('tim')
  assert.deepEqual(out.people, { ok: false, error: 'db down' })
  assert.equal(out.plans.ok, true)
  assert.equal(out.usage.ok, true)
})

test('the overview is kept a minute; Refresh asks again at most every 10 seconds', async () => {
  let reads = 0
  const d = dashboard({ io: localIo({ people: async () => { reads += 1; return { members: reads } } }) })
  assert.equal((await d.dashboard('tim')).people.members, 1)
  d.tick(30_000)
  assert.equal((await d.dashboard('tim')).people.members, 1, 'kept')
  assert.equal((await d.dashboard('tim', { refresh: true })).people.members, 2, 'refresh after 10 s')
  d.tick(5_000)
  assert.equal((await d.dashboard('tim', { refresh: true })).people.members, 2, 'refresh within 10 s is the kept one')
  d.tick(61_000)
  assert.equal((await d.dashboard('tim')).people.members, 3, 'older than a minute')
  // the check comes first: a non-admin never gets the kept answer
  await assert.rejects(d.dashboard('ann'), { code: 'denied' })
})

test('the Meteor glue: administrators only, Stripe on Cloud only through the app\'s client, never a key', () => {
  const glue = read('server/admin/meteor.js')
  assert.match(glue, /isAdmin: isInstanceAdmin/)
  assert.match(glue, /payments: \(\) => \(\{ on: paymentsOn\(\), mode: keyMode\(Meteor\.settings\.stripePrivateKey\) \}\)/)
  assert.match(glue, /stripe: \(\) => stripeClient\(\)/, 'the app\'s client: Cloud license checked, pinned API version')
  assert.doesNotMatch(glue, /console\.(log|warn|error)/)
  assert.doesNotMatch(glue, /\.(create|update|del)\(/, 'read only')
  assert.match(read('server/main.js'), /import '\.\/admin\/meteor'/)
  const core = read('server/admin/dashboard-core.mjs')
  assert.doesNotMatch(core, /\.(create|update|del|retrieve)\(/, 'list calls only')
})

test('the Overview says its numbers plainly', () => {
  assert.equal(money(500), '$5')
  assert.equal(money(123456), '$1,234.56')
  assert.equal(money(-250), '-$2.50')
  assert.equal(money(1000, 'sek'), '10 SEK')
  assert.equal(moneyTotals({ usd: 500, eur: 200 }), '$5 · €2')
  assert.equal(moneyTotals({}), '$0')
  assert.equal(micros(3_750_000), '$3.75')
  assert.equal(micros(5), '<$0.01')
  assert.equal(count(2000, true), '2,000+')
  const page = read('imports/ui/pages/admin/AdminOverview.jsx')
  assert.match(page, /Open in Stripe/)
  assert.match(page, /CONSTANTS\.methods\.admin\.dashboard/)
  assert.match(page, /Agent usage/)
  assert.doesNotMatch(page, />[^<]*\bAI usage\b/, 'agent, not AI, in the copy')
})
