// A visitor with no account who edits through a link saves their edits even when the collaboration
// relay is not set up. collaborators.init read Meteor.settings.slateboxAPI's key pair unguarded: with
// none (settings.example.json had none), it threw, the canvas's collaboration setup stopped before
// organizations.trackGuest recorded the visit, and every save by that visitor was refused
// ("You do not have permission to save this slate"; e2e app-save-path "Ship by the guest").
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import collaboratorDetails from '../web/app/server/common/collaborator-details.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const keys = { publicKey: 'pk-test', secretKey: 'sk-test' }
const visitor = { user: null, userId: null, id: 'visitor-1', shareId: 'abc1234567' }

test('with the relay set up, a visitor the slate is open to gets the room token, a name, a colour and a key', () => {
  // relay-access.mjs decides the access; scripts/relay-token.test.mjs covers who gets which.
  const access = { code: 'ok', role: 'read', room: 'slate-1' }
  const details = collaboratorDetails({ ...visitor, settings: { slateboxAPI: keys, public: { wsUrl: 'ws://relay' } }, fallbackSecret: 'x', access })
  assert.equal(details.isAnonymous, true)
  assert.equal(details.wsUrl, 'ws://relay')
  assert.ok(details.wsParams.token && details.wsParams.exp)
  assert.equal(details.wsParams.bearer, undefined, 'no legacy pair by default, and never for a read role')
  assert.equal(details.wsParams.timestamp, undefined)
  assert.equal(details.relayRole, 'read')
  assert.match(details.personKey, /^[A-Za-z0-9_-]{16}$/)
  assert.ok(details.userName)
  assert.ok(details.color)
})

test('a visitor the slate is not open to still gets a name, a colour and a key, with no relay credential', () => {
  for (const access of [undefined, { code: 'no-access' }, { code: 'slate-not-found' }]) {
    const details = collaboratorDetails({ ...visitor, settings: { slateboxAPI: keys, public: { wsUrl: 'ws://relay' } }, fallbackSecret: 'x', access })
    assert.equal(details.wsParams, null)
    assert.equal(details.relayRole, null)
    assert.match(details.personKey, /^[A-Za-z0-9_-]{16}$/)
    assert.ok(details.userName)
  }
})

test('with no relay key pair, the details still come back, with no relay credential', () => {
  for (const settings of [{}, { slateboxAPI: {} }, { slateboxAPI: { publicKey: '', secretKey: '' } }, { public: {} }]) {
    const details = collaboratorDetails({ ...visitor, settings, fallbackSecret: 'process-secret' })
    assert.equal(details.wsParams, null)
    assert.match(details.personKey, /^[A-Za-z0-9_-]{16}$/)
    assert.ok(details.userName)
  }
  // The same visitor on the same slate keeps one key (their tabs count once).
  const one = collaboratorDetails({ ...visitor, settings: {}, fallbackSecret: 'process-secret' })
  const two = collaboratorDetails({ ...visitor, settings: {}, fallbackSecret: 'process-secret' })
  assert.equal(one.personKey, two.personKey)
})

test('an account is named from its profile or its email', () => {
  const user = { _id: 'u1', isAnonymous: false, emails: [{ address: 'pat@example.com' }] }
  assert.equal(collaboratorDetails({ user, userId: 'u1', id: 'tab', shareId: 's', settings: {}, fallbackSecret: 'x' }).userName, 'pat')
  const named = { ...user, profile: { firstName: 'Pat', lastName: 'Lee' } }
  assert.equal(collaboratorDetails({ user: named, userId: 'u1', id: 'tab', shareId: 's', settings: {}, fallbackSecret: 'x' }).userName, 'Pat Lee')
})

test('the method hands its work to collaboratorDetails with a secret made once per server', () => {
  const source = app('server/methods/collaborators.js')
  assert.doesNotMatch(source, /=\s*Meteor\.settings\.slateboxAPI\s*$/m, 'the key pair is never read unguarded')
  assert.match(source, /collaboratorDetails\(/)
  assert.match(source, /randomBytes\(32\)/)
})

test('the canvas records a visit even when collaborators.init fails', () => {
  // The visit is recorded before collaborators.init is asked (the guest's admission decides the
  // relay role), and a failing collaborators.init is caught, so it can never stop the visit.
  const canvas = app('imports/ui/pages/Canvas.jsx')
  const start = canvas.indexOf('onInitCollaboration: async (clientID) => {')
  const end = canvas.indexOf('return userBaseData', start)
  const body = canvas.slice(start, end)
  const visit = body.indexOf('CONSTANTS.methods.organizations.trackGuest')
  const init = body.indexOf('CONSTANTS.methods.collaborators.init')
  assert.ok(visit > 0 && init > visit, 'the visit is recorded first')
  assert.match(body.slice(visit), /try \{\s*collaboratorDetails = await Meteor\.callAsync\(\s*CONSTANTS\.methods\.collaborators\.init/)
  assert.match(body.slice(init), /\} catch \(error\) \{/)
})

test('the example settings name the relay key pair, empty', () => {
  const example = JSON.parse(app('settings.example.json'))
  assert.deepEqual({ publicKey: example.slateboxAPI.publicKey, secretKey: example.slateboxAPI.secretKey }, { publicKey: '', secretKey: '' })
  assert.match(example.slateboxAPI['//'], /API_KEYS/)
})
