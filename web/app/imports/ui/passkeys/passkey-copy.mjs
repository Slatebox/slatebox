// What the passkey screens say (the sign-in page, the account form, Profile › Sign-in). Plain
// functions, so the words and rules are tested without a browser (scripts/passkeys-ui.test.mjs).
// Plain words, US spelling, and always "passkey".

export const PASSKEY_WORDS = Object.freeze({
  signIn: 'Sign in with a passkey',
  signingIn: 'Waiting for your passkey…',
  useInstead: 'Use a passkey instead of a password',
  usePassword: 'Use a password instead',
  // (The account form's lede and button for a passkey are in common/accountCopy.mjs registrationCopy.)
  sectionTitle: 'Passkeys',
  sectionLede: 'A passkey signs you in with your fingerprint, face, PIN or screen lock instead of a password. It stays on your device or in your password manager, and it only works on this Slatebox.',
  add: 'Add a passkey',
  none: 'You have no passkeys yet.',
  unsupported: 'This browser cannot create passkeys. Try a current version of Chrome, Safari, Edge or Firefox.',
  off: 'Passkeys are not available on this server.',
  ssoLinked: 'This account signs in with single sign-on, so passkeys are not used here.',
  added: 'Passkey added. You can sign in with it from now on.',
  renamed: 'Passkey renamed.',
  removed: 'Passkey removed. Your device may still list it until it next syncs.',
  lastWayIn: 'This is your only way to sign in. Add another passkey or set a password before you remove it.',
  recovery: 'Lost your device? Use "Email me a sign-in link" on the sign-in page, then add a new passkey here.',
  passwordTitle: 'Password',
  noPassword: 'You sign in with a passkey and have no password. To add one, we can email you a link to set it.',
  setPassword: 'Email me a link to set a password',
  removeTitle: 'Remove this passkey?',
  removeMessage: (name) => `You will no longer be able to sign in with "${name}". It may stay in your device's passkey list until you delete it there too.`,
})

/** Words for an error the browser's passkey prompt ended with, or null when the person just closed it. */
export function browserErrorText(error) {
  const name = error?.name || ''
  const code = error?.code || ''
  if (name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED' || code === 'passkey-uninvited') return null
  if (name === 'NotAllowedError') return null
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') return 'This device already has a passkey for your account.'
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || name === 'SecurityError') return 'Passkeys do not work at this address. Open Slatebox at its usual address and try again.'
  if (name === 'NotSupportedError') return 'This device cannot make a passkey for Slatebox.'
  // A refusal from the server (Meteor.Error) carries its own words.
  if (typeof error?.reason === 'string' && error.reason) return error.reason
  return 'That passkey did not work. Try again, or sign in another way.'
}

const DAY = 24 * 60 * 60 * 1000
const dateText = (value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "Added Nov 3, 2026 · Last used today" */
export function passkeyDates({ createdAt, lastUsedAt }, now = Date.now()) {
  const added = createdAt ? `Added ${dateText(createdAt)}` : ''
  let used = 'Never used'
  if (lastUsedAt) {
    const at = new Date(lastUsedAt).getTime()
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    if (at >= today.getTime()) used = 'Last used today'
    else if (at >= today.getTime() - DAY) used = 'Last used yesterday'
    else used = `Last used ${dateText(at)}`
  }
  return [added, used].filter(Boolean).join(' · ')
}

/** Whether a passkey may be removed here: never the last way in (the server checks again). */
export function mayRemove({ passkeys = [], hasPassword = false } = {}) {
  return hasPassword || passkeys.length > 1
}

/** The name field: what the server accepts (1 to 60 characters once tidied). */
export function nameProblem(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim()
  if (!name) return 'Give the passkey a name.'
  if (name.length > 60) return 'Use 60 characters or fewer.'
  return null
}
