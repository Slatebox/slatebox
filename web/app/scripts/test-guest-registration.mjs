/* eslint-disable no-console */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  REGISTRATION_MODES,
  buildRegistrationForm,
  getRegistrationMode,
  isClaimFormComplete,
  isValidEmail,
  markClaimFieldsInvalid,
} from '../imports/ui/common/guestRegistration.mjs'

const partiallyPublishedGuest = {
  _id: 'guest-user',
  emails: [{ address: 'user@technical-credential.com' }],
}

assert.equal(
  getRegistrationMode(partiallyPublishedGuest),
  REGISTRATION_MODES.loading,
  'a user is not identified until the explicit anonymous flag arrives'
)
assert.equal(
  buildRegistrationForm(partiallyPublishedGuest, REGISTRATION_MODES.loading)
    .email.value,
  '',
  'a partially published guest credential must never hydrate the form'
)

const guest = { ...partiallyPublishedGuest, isAnonymous: true }
assert.equal(getRegistrationMode(guest), REGISTRATION_MODES.anonymous)
assert.equal(
  buildRegistrationForm(guest, REGISTRATION_MODES.anonymous).email.value,
  '',
  'an anonymous credential must never be displayed'
)

const identifiedUser = {
  _id: 'identified-user',
  isAnonymous: false,
  emails: [{ address: 'person@example.com' }],
  profile: { firstName: 'Ada', lastName: 'Lovelace' },
}
const identifiedForm = buildRegistrationForm(
  identifiedUser,
  REGISTRATION_MODES.identified
)
assert.equal(identifiedForm.email.value, 'person@example.com')
assert.equal(identifiedForm.email.valid, true)
assert.equal(identifiedForm.firstName.value, 'Ada')

assert.equal(isValidEmail('person@example.com'), true)
assert.equal(isValidEmail('not-an-email'), false)
assert.equal(
  isClaimFormComplete({
    email: { valid: true },
    password: { valid: true },
    firstName: { valid: null },
    lastName: { valid: null },
  }),
  true,
  'claiming a guest workspace only requires email and password'
)
assert.deepEqual(
  markClaimFieldsInvalid({
    email: { value: '', valid: null },
    password: { value: '', valid: null },
    firstName: { value: '', valid: null },
    lastName: { value: '', valid: null },
  }),
  {
    email: { value: '', valid: false },
    password: { value: '', valid: false },
    firstName: { value: '', valid: null },
    lastName: { value: '', valid: null },
  }
)

// Guest accounts are made in one place (server/common/accounts.js), which createAnonymous and the
// other guest entry points call.
const readServer = (path) => readFile(fileURLToPath(new URL(`../server/${path}`, import.meta.url)), 'utf8')
const accountsSource = await readServer('common/accounts.js')
assert.match(
  accountsSource,
  /export async function createGuestAccount[\s\S]{0,200}@anonymous\.slatebox\.invalid/,
  'new guest credentials should use a reserved, non-routable domain'
)
assert.match(await readServer('methods/users.js'), /await createGuestAccount\(/, 'createAnonymous makes its guest with createGuestAccount')

console.log('Guest registration contracts passed.')
