export const REGISTRATION_MODES = Object.freeze({
  signedOut: 'signed-out',
  loading: 'loading',
  anonymous: 'anonymous',
  identified: 'identified',
})

const field = (value = '', valid = null) => ({ value, valid })

export function getRegistrationMode(user) {
  if (!user) return REGISTRATION_MODES.signedOut
  if (typeof user.isAnonymous !== 'boolean') {
    return REGISTRATION_MODES.loading
  }
  return user.isAnonymous
    ? REGISTRATION_MODES.anonymous
    : REGISTRATION_MODES.identified
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function buildRegistrationForm(user, mode) {
  const canUseAccountDetails = mode === REGISTRATION_MODES.identified
  const email = canUseAccountDetails
    ? user?.emails?.[0]?.address?.trim() || ''
    : ''
  return {
    firstName: field(
      canUseAccountDetails ? user?.profile?.firstName || '' : ''
    ),
    lastName: field(canUseAccountDetails ? user?.profile?.lastName || '' : ''),
    email: field(email, canUseAccountDetails ? isValidEmail(email) : null),
    password: field(),
  }
}

// A guest saves with an email and a password, or with an email and a passkey (no password field).
export function isClaimFormComplete(form, { passkey = false } = {}) {
  return form.email.valid === true && (passkey || form.password.valid === true)
}

export function markClaimFieldsInvalid(form, { passkey = false } = {}) {
  return {
    ...form,
    email: {
      ...form.email,
      valid: form.email.valid === true,
    },
    password: passkey ? form.password : {
      ...form.password,
      valid: form.password.valid === true,
    },
  }
}
