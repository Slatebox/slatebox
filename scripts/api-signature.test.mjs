// The signed HTTP hooks must really check the signature, and a browser must not be able to mint
// login links for an account it does not own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { createHmac } from 'node:crypto'

const root = new URL('../web/app/', import.meta.url)
const settings = { slateboxAPI: { publicKey: 'public-test', secretKey: 'secret-test' } }
const stubs = {
  'meteor/meteor': `export const Meteor = { settings: ${JSON.stringify(settings)}, methods() {}, Error: class extends Error {} }`,
}
registerHooks({
  resolve(specifier, context, next) {
    if (stubs[specifier]) return { url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true }
    if (specifier === '../../imports/api/common/constants') return next(new URL('imports/api/common/constants.js', root).href, context)
    if (specifier === '../common/createHmacString') return next(new URL('server/common/createHmacString.js', root).href, context)
    return next(specifier, context)
  },
})
const { isApiSignatureValid } = await import(new URL('server/methods/auth.js', root).href)
const { default: createHmacString } = await import(new URL('server/common/createHmacString.js', root).href)
const { collabCredential, hookSignatureIsValid } = await import(new URL('server/common/api-signature.mjs', root).href)

const signed = (date = new Date().toISOString()) => ({ bearer: encodeURIComponent(createHmacString('public-test', 'secret-test', date).authToken), dateString: date })

test('a correctly signed, current request passes', async () => {
  assert.equal(await isApiSignatureValid(signed()), true)
})
test('a wrong signature, a stale date, a far-future date and missing fields all fail', async () => {
  const good = signed()
  assert.equal(await isApiSignatureValid({ ...good, bearer: 'not-the-signature' }), false)
  assert.equal(await isApiSignatureValid(signed(new Date(Date.now() - 16 * 60e3).toISOString())), false)
  assert.equal(await isApiSignatureValid(signed(new Date(Date.now() + 60 * 60e3).toISOString())), false)
  assert.equal(await isApiSignatureValid(signed('not a date')), false)
  assert.equal(await isApiSignatureValid({}), false)
  assert.equal(await isApiSignatureValid({ bearer: good.bearer }), false)
})
test('a non-ISO date never passes, even when the hash over it is right', async () => {
  const loose = new Date().toString() // "Thu Nov 19 2026 ..." parses as a date but is not an ISO instant
  assert.equal(await isApiSignatureValid({ bearer: createHmacString('public-test', 'secret-test', loose).authToken, dateString: loose }), false)
})
test('the collaboration credential every viewer receives is not a hook signature', async () => {
  const { bearer, timestamp } = collabCredential({ publicKey: 'public-test', secretKey: 'secret-test' })
  const [publicKey, hash] = Buffer.from(bearer, 'base64').toString('utf8').split(':')
  assert.equal(publicKey, 'public-test')
  // The relay (collab.slatebox.com src/auth/isAuthenticated.js) recomputes HMAC(publicKey:timestamp).
  assert.equal(hash, createHmac('sha256', 'secret-test').update(`public-test:${timestamp}`).digest('base64'))
  assert.equal(timestamp.split('/')[0], timestamp, 'the relay strips a /room suffix from the stamp')
  // Replayed against the hook as an attacker would, with the stamp or with any date near it.
  for (const dateString of [timestamp, timestamp.replace(/^collab\./, ''), ` ${timestamp}`, encodeURIComponent(timestamp)]) {
    assert.equal(await isApiSignatureValid({ bearer: hash, dateString }), false, dateString)
    assert.equal(await isApiSignatureValid({ bearer: encodeURIComponent(hash), dateString }), false, dateString)
  }
  assert.equal(hookSignatureIsValid({ publicKey: 'public-test', secretKey: 'secret-test', bearer: hash, dateString: timestamp }), false)
})
test('collaborators.init hands out the relay credential, never the hook signature', () => {
  const source = readFileSync(new URL('server/methods/collaborators.js', root), 'utf8')
  assert.match(source, /collabCredential\(/)
  assert.doesNotMatch(source, /createHmacString/)
})
test('every signed hook awaits the check instead of testing a promise', () => {
  for (const file of ['server/ttsHooks.js', 'server/youtubeHooks.js']) {
    assert.throws(() => readFileSync(new URL(file, root)), /ENOENT/, file + ' should stay removed: nothing calls it')
  }
  for (const file of ['server/apiHooks.js']) {
    const source = readFileSync(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /Meteor\.call\(\s*CONSTANTS\.methods\.auth\.isAuthenticated/, file)
    assert.match(source, /await isApiSignatureValid\(/, file)
  }
})
test('the browser-callable login-link method only emails a link to an address', () => {
  const source = readFileSync(new URL('server/methods/users.js', root), 'utf8')
  const body = source.slice(source.indexOf('method[CONSTANTS.methods.users.generateSpecialUseLoginToken]'))
  const method = body.slice(0, body.indexOf('\n}\n'))
  assert.match(method, /asEmail: true/)
  assert.doesNotMatch(method, /userId/)
  assert.doesNotMatch(source, /Meteor\.call\(\s*CONSTANTS\.methods\.users\.generateSpecialUseLoginToken/)
})
