// Source guards for the server's access fixes. The behaviour itself is proven against a running
// app by server-access.live.test.mjs; these keep the shape from drifting back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../web/app/', import.meta.url))
const read = (path) => readFileSync(join(app, path), 'utf8')
const walk = (dir) => readdirSync(join(app, dir)).flatMap((name) => {
  const path = join(dir, name)
  return statSync(join(app, path)).isDirectory() ? walk(path) : /\.(m?js|jsx)$/.test(name) ? [path] : []
})
const server = walk('server')
const client = [...walk('imports'), ...walk('client')]

test('dead methods, routes and their files stay removed (nothing called them)', () => {
  for (const file of ['server/methods/svgImports.js', 'server/methods/tts.js', 'server/methods/youtube.js', 'server/methods/tags.js',
    'server/methods/humanticApi.js', 'imports/ui/components/profile/AiContext.jsx']) {
    assert.equal(existsSync(join(app, file)), false, file)
  }
  const constants = read('imports/api/common/constants.js')
  for (const name of ['slates.archive', 'slates.echo', 'slates.getNonPublic', 'slates.scaleAndTranslate', 'slates.convertTextToPaths',
    'layouts.aiCalculate', 'themes.getPrivate', 'svgImports.aws', 'tts.textToSpeechUrl', 'youtube.urlToAudio', 'utils.createImage',
    'utils.clearBase64Cache', 'utils.getBase64CacheStats', 'stripe.deleteCustomer', 'googleDocs.createFolder', 'images.svgToPaths',
    'images.searchGoogleImages', 'users.impersonate', 'users.getUserName', 'humanticApi.fetch', 'tags.remove']) {
    assert.ok(!constants.includes(`'${name}'`), 'constant ' + name)
    for (const file of server) assert.ok(!read(file).includes(`'${name}'`), name + ' in ' + file)
  }
  assert.ok(!read('server/publications.js').includes('publications.collaborators,'), 'the unused collaborators publication')
})

test('no guest shares a known password, and sign-up options cannot choose a team or plan', () => {
  for (const file of [...server, ...client]) assert.ok(!/anonUserPwd|'ANONYMOUS'/.test(read(file)), file)
  const accounts = read('server/common/accounts.js')
  assert.match(accounts, /attempt\.type === 'password' && attempt\.user\?\.isAnonymous/)
  assert.match(accounts, /const fields = trusted\.get\(\) \|\| \{\}/)
  assert.doesNotMatch(accounts, /suggested\.(orgId|planType|isAnonymous|isDemo)/)
  assert.match(read('server/startup.js'), /Accounts\.onCreateUser\(onCreateUser\)/)
})

test('a team claim counts only in the team the person is in', () => {
  const auth = read('imports/api/common/AuthManager.js')
  assert.match(auth, /\{ orgId: user\.orgId \}/)
  const orgs = read('server/methods/organizations.js')
  assert.doesNotMatch(orgs, /createdByUserId: opts\.createdByUserId|_id: opts\.createdByUserId/)
  const users = read('server/methods/users.js')
  assert.match(users, /claimIds\.includes\(CONSTANTS\.claims\.uberMensch\._id\)/)
  assert.doesNotMatch(users, /upd\.orgId = opts\.orgId/)
})

test('browser writes to shared collections need the writer\'s own row', () => {
  const rules = read('server/permissions.js')
  assert.doesNotMatch(rules, /Meteor\.userId\(\) === userId/)
  assert.doesNotMatch(rules, /IconPacks\.allow|Audit\.allow/)
  // Restated (P05a at the rebase): no browser writes the slates collection at all.
  assert.doesNotMatch(rules, /Slates\.allow/)
})

test('publications that take a slate check that the subscriber may read it', () => {
  const pubs = read('server/publications.js')
  for (const name of ['messages', 'comments', 'transcripts']) {
    const start = pubs.indexOf(`CONSTANTS.publications.${name},`)
    assert.ok(start > 0, name)
    assert.match(pubs.slice(start, start + 1400), /canReadSlate\(/, name)
  }
  const forGuest = pubs.slice(pubs.indexOf('CONSTANTS.publications.orgUsersForGuest'))
  assert.doesNotMatch(forGuest.slice(0, 600), /opts\.orgId|emails: 1/)
})

test('server code never tests the promise of an async method or read', () => {
  for (const file of server) {
    const source = read(file)
    assert.doesNotMatch(source, /(if \(|= |!)Meteor\.call\(/, file)
    assert.doesNotMatch(source, /Meteor\.userAsync\(\)\.[a-zA-Z]/, file)
    assert.doesNotMatch(source, /\.fetchAsync\(\)\s*\.(map|filter|forEach)\(/, file)
  }
})

test('the upload route and image cache never take the process down', () => {
  const routes = read('server/sbImages.js')
  assert.match(routes, /process\.on\('unhandledRejection'/)
  assert.match(routes, /limits: \{ fileSize: MAX_UPLOAD_BYTES, files: 1/)
  assert.match(routes, /if \(!user\) return res\.status\(401\)/)
  assert.doesNotMatch(routes, /req\.query\.skipTimestamp|originalname\.split/)
})

const { unsafeKeyPath, unsafeModifierPath, guardHandlers, skipsArgumentGuard } = await import('../web/app/server/common/document-keys.mjs')

test('keys a browser refuses, and Mongo operators, are found at any depth', () => {
  assert.equal(unsafeKeyPath({ shareId: 'abc', nodes: [{ options: { text: 'a.b $x' } }] }), null)
  assert.equal(unsafeKeyPath({ shareId: { $regex: '^a' } }), 'shareId.$regex')
  assert.equal(unsafeKeyPath([{ name: 'x', $gt: 1 }]), '[0].$gt')
  assert.equal(unsafeKeyPath({ gather: { items: [{ 'a.b': 1 }] } }), 'gather.items[0].a.b')
  assert.equal(unsafeKeyPath({ k: { 'x\0': 1 } }), 'k.x\0')
  let deep = {}
  for (let i = 0; i < 100; i++) deep = { d: deep }
  assert.match(unsafeKeyPath(deep), /nested too deeply/)
  assert.equal(unsafeKeyPath({ when: new Date(), bytes: new Uint8Array(4) }), null)
  // A modifier's own operators and dotted paths are its syntax; its values are checked.
  assert.equal(unsafeModifierPath({ $set: { 'options.isPublic': true, 'profile.aiSettings': { a: 1 } } }), null)
  assert.equal(unsafeModifierPath({ $set: { text: { $gt: 1 } } }), '$set.text.$gt')
  assert.equal(unsafeModifierPath({ $set: { 'a.$where': 1 } }), '$set.a.$where')
  assert.equal(unsafeModifierPath({ text: 'replacement' }), null)
  assert.equal(unsafeModifierPath({ 'a.b': 1 }), 'a.b')
})

test('every method and publication handler refuses such arguments before it runs', () => {
  let ran = 0
  const handlers = { 'slates.get': function get(opts) { ran++; return this.who + opts.shareId }, '/slates/update': () => 'mutator', __dynamicImport: () => 'tree' }
  guardHandlers(handlers, { skip: skipsArgumentGuard, refuse: (name, path) => new Error(`refused ${name} ${path}`) })
  assert.equal(handlers['slates.get'].call({ who: 'me:' }, { shareId: 'abc' }), 'me:abc')
  assert.throws(() => handlers['slates.get'].call({}, { shareId: { $ne: null } }), /refused slates\.get \[0\]\.shareId\.\$ne/)
  assert.equal(ran, 1)
  assert.equal(handlers['/slates/update']({ $set: {} }), 'mutator')
  assert.equal(handlers.__dynamicImport({ 'Canvas.jsx': 1 }), 'tree')
  const once = handlers['slates.get']
  guardHandlers(handlers, { skip: skipsArgumentGuard, refuse: () => new Error('x') })
  assert.equal(handlers['slates.get'], once, 'a handler is wrapped once')
})

test('a refused argument is logged by method name and kind of key, never by the key a person typed', () => {
  const logged = []
  const handlers = { 'chatIntentions.save': () => 'saved' }
  guardHandlers(handlers, { refuse: () => new Error('refused'), log: (...parts) => logged.push(parts.join(' ')) })
  assert.throws(() => handlers['chatIntentions.save']({ name: 'x', 'k.Tuesday plan for Ada': 1 }))
  assert.throws(() => handlers['chatIntentions.save']({ name: 'x', gather: [{ '$Ada secret': 1 }] }))
  assert.throws(() => handlers['chatIntentions.save']({ name: 'x', ['Ada\0note']: 1 }))
  assert.equal(logged.length, 3)
  for (const line of logged) {
    assert.match(line, /^chatIntentions\.save /)
    assert.doesNotMatch(line, /Ada|Tuesday|secret|note/, 'the log carries a key: ' + line)
  }
})


test('the argument guard is installed first, and the deny rules cover every browser-written collection', () => {
  const main = read('server/main.js')
  assert.ok(main.indexOf("import './argument-guard'") < main.indexOf("import './methods/"), 'argument guard after methods')
  const guard = read('server/argument-guard.js')
  assert.match(guard, /Meteor\.server\.method_handlers/)
  assert.match(guard, /Meteor\.server\.publish_handlers/)
  const rules = read('server/permissions.js')
  const allowed = [...rules.matchAll(/^([A-Za-z.]+)\.allow\(/gm)].map((m) => m[1])
  const denied = rules.slice(rules.indexOf('const unsafeWrites'), rules.indexOf('const unsafeWrites') + 600)
  for (const name of allowed) assert.ok(denied.includes(name), name + ' has an allow rule but no unsafe-key deny rule')
})

test('personas: no lookup by caller operator, no personas of other accounts without a team, no caller-set flags', () => {
  const intentions = read('server/methods/chatIntentions.js')
  assert.doesNotMatch(intentions, /chatIntentions\.get\]/)
  assert.ok(!read('imports/api/common/constants.js').includes("'chatIntentions.get'"))
  assert.match(intentions, /PERSONA_FIELDS/)
  assert.doesNotMatch(intentions.slice(intentions.indexOf('const PERSONA_FIELDS'), intentions.indexOf('const MASTER_FIELDS')), /isDefault|universal|system|userId|orgId/)
  const pubs = read('server/publications.js')
  const pub = pubs.slice(pubs.indexOf('CONSTANTS.publications.chatIntentions,'), pubs.indexOf("Meteor.publish('organizationSettings'"))
  assert.doesNotMatch(pub, /\{ orgId: user\.orgId \}, \{ universal/)
  assert.match(pub, /\{ userId: this\.userId \}/)
})

test('the signed hooks and the relay credential are separate, and a one-off AI request never reuses a credit', () => {
  assert.match(read('server/methods/auth.js'), /hookSignatureIsValid/)
  const ai = read('server/methods/openai.js')
  assert.match(ai, /if \(opts\.processImmediately\) opts = \{ \.\.\.opts, aid: undefined \}/)
  const prompt = ai.slice(ai.indexOf('methods.openai.fetchOriginalPrompt]'))
  assert.match(prompt.slice(0, 300), /check\(shareId, String\)[\s\S]*canReadSlate\(/)
  const welcome = ai.slice(ai.indexOf('methods.openai.welcome]'))
  assert.match(welcome.slice(0, 900), /checkConversationTarget\(user, \{ shareId, aid: slateAid \}\)/)
})

test('sharp reads caller bytes only after they are known to be raster; SVG is drawn in a child process', () => {
  for (const file of server) {
    const source = read(file)
    if (!/from 'sharp'/.test(source) || file.endsWith('render-svg.mjs')) continue
    assert.match(source, /isRasterImage\(/, file + ' hands caller bytes to sharp without a raster check')
  }
  assert.doesNotMatch(read('server/common/upload-kinds.mjs'), /from 'sharp'/)
  assert.match(read('server/methods/images.js'), /renderSvgToPng\(/)
})

test('metering, wallet and key methods need a signed-in person; budget methods need the uberMensch claim', () => {
  const meter = read('server/metering/meteor.js')
  const wallet = read('server/methods/wallet.js')
  const body = (source, name) => {
    const at = source.indexOf(name)
    assert.ok(at > 0, name)
    return source.slice(at, at + 700)
  }
  for (const name of ["'keys.list'", "'keys.save'", "'keys.remove'", "'meter.summary'"]) {
    assert.match(body(meter, name), /Meteor\.userAsync\(\)/, name)
  }
  assert.match(body(meter, "'keys.save'"), /keyOwnerFor\(user, input\.owner, true\)/)
  assert.match(meter, /if \(!user \|\| user\.isAnonymous\) throw new Meteor\.Error\('sign-in'/)
  // Restated (AI control S2): the uberMensch check is the one helper, permissions.js isInstanceAdmin.
  assert.match(meter, /import \{ isInstanceAdmin \} from '\.\.\/permissions'/)
  assert.match(meter, /function isUberMensch\(userId\) \{\n  return isInstanceAdmin\(userId\)/)
  assert.match(read('server/permissions.js'), /Permissions\.findOneAsync\(\{ userId, claimId: CONSTANTS\.claims\.uberMensch\._id \}/)
  for (const name of ["'meter.adminSummary'", "'meter.setBudget'"]) {
    assert.match(body(meter, name), /if \(!await isUberMensch\(/, name)
  }
  for (const name of ['wallet.createTopUp', 'wallet.refund', 'wallet.charges']) {
    assert.match(body(wallet, `[CONSTANTS.methods.${name}]`), /walletFor\(wallet, (true|false)\)/, name)
  }
  assert.match(wallet, /throw new Meteor\.Error\('sign-in', 'Sign in to use a balance\.'\)/)
  assert.match(wallet, /throw new Meteor\.Error\('team-admin'/)
  const daily = read('server/methods/daily.js')
  assert.doesNotMatch(daily, /generateAccessToken|daily\.createRoom/)
  assert.match(daily, /grant\.canStart/)
  const constants = read('imports/api/common/constants.js')
  for (const name of ['meter.summary', 'meter.adminSummary', 'meter.setBudget', 'wallet.createTopUp', 'wallet.confirmTopUp', 'wallet.refund',
    'wallet.charges', 'keys.save', 'keys.remove', 'keys.list', 'images.search', 'daily.join', 'daily.leave']) {
    assert.ok(constants.includes(`'${name}'`), name)
  }
})
