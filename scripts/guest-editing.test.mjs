// A visitor with no account who edits through a link saves their edits even when the collaboration
// relay is not set up. collaborators.init read Meteor.settings.slateboxAPI's key pair unguarded: with
// none (settings.example.json had none), it threw, the canvas's collaboration setup stopped before
// organizations.trackGuest recorded the visit, and every save by that visitor was refused
// ("You do not have permission to save this slate"; e2e app-save-path "Ship by the guest").
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { collaboratorDetails } from '../web/app/server/common/collaborator-details.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const keys = { publicKey: 'pk-test', secretKey: 'sk-test' }
const visitor = { user: null, userId: null, id: 'visitor-1', shareId: 'abc1234567' }

test('with the relay set up, a visitor gets the relay credential, a name, a colour and a key', () => {
  const details = collaboratorDetails({ ...visitor, settings: { slateboxAPI: keys, public: { wsUrl: 'ws://relay' } }, fallbackSecret: 'x' })
  assert.equal(details.isAnonymous, true)
  assert.equal(details.wsUrl, 'ws://relay')
  assert.ok(details.wsParams.bearer && details.wsParams.timestamp)
  assert.match(details.personKey, /^[A-Za-z0-9_-]{16}$/)
  assert.ok(details.userName)
  assert.ok(details.color)
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
  const canvas = app('imports/ui/pages/Canvas.jsx')
  const start = canvas.indexOf('onInitCollaboration: async (clientID) => {')
  const body = canvas.slice(start, canvas.indexOf('CONSTANTS.methods.organizations.trackGuest', start))
  assert.match(body, /try \{\s*collaboratorDetails = await Meteor\.callAsync\(\s*CONSTANTS\.methods\.collaborators\.init/)
  assert.match(body, /\} catch \(error\) \{/)
})

test('the example settings name the relay key pair, empty', () => {
  const example = JSON.parse(app('settings.example.json'))
  assert.deepEqual({ publicKey: example.slateboxAPI.publicKey, secretKey: example.slateboxAPI.secretKey }, { publicKey: '', secretKey: '' })
  assert.match(example.slateboxAPI['//'], /API_KEYS/)
})
