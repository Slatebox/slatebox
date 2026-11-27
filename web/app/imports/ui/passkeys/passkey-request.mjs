// When the sign-in page may ask the device for a passkey (2026-11-26). Plain functions, tested without
// a browser (scripts/passkeys-ui.test.mjs).
//
// Two ways, and only two:
//   autofill  conditional UI (mediation: 'conditional'): the passkeys sit in the email field's autofill
//             list (autocomplete="username webauthn") until the person picks one. Nothing opens by itself.
//   prompt    the modal passkey sheet (on iOS: "Scan QR Code / Use Security Key"). Only after the person
//             pressed "Sign in with a passkey": a trusted click, never on page load or from a script.
//
// And on a touch device the email field is not focused on load: focusing a webauthn field while the
// autofill request waits is what made iOS (in the app's system-browser sign-in sheet) raise its passkey
// sheet uninvited. The person taps the field, and the autofill offers the passkeys there.

/** A refusal for a modal passkey prompt nobody asked for. browserErrorText shows nothing for it. */
export const UNINVITED = 'passkey-uninvited'

/**
 * What to pass startAuthentication. autofill: true is always conditional; anything else needs
 * gesture: true (a trusted click on the passkey button), else it throws UNINVITED.
 */
export function authenticationRequest(optionsJSON, { autofill = false, gesture = false } = {}) {
  if (autofill === true) return { optionsJSON, useBrowserAutofill: true }
  if (gesture !== true) throw Object.assign(new Error('A passkey prompt opens only when the person asks for one.'), { name: 'NotAllowedError', code: UNINVITED })
  return { optionsJSON, useBrowserAutofill: false }
}

/** Whether a click was the person's own (a trusted event), the only thing that may open the prompt. */
export const isGesture = (event) => event?.isTrusted === true

/** Whether a sign-in field may take focus on load: never on a touch-first device (coarse pointer). */
export function focusOnLoad(win = globalThis.window) {
  try {
    return !win?.matchMedia?.('(pointer: coarse)')?.matches
  } catch {
    return false
  }
}
