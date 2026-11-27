// Passkeys in the browser: the WebAuthn prompts (@simplewebauthn/browser) around the server's
// passkeys.* methods (server/passkeys). The server makes every challenge and checks every answer;
// the browser only asks the device and passes the answer on.
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import {
  WebAuthnAbortService, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, sendSignal, startAuthentication, startRegistration,
} from '@simplewebauthn/browser'
import CONSTANTS from '../../api/common/constants'
import { authenticationRequest } from './passkey-request.mjs'

const M = CONSTANTS.methods.passkeys

export const browserHasPasskeys = () => {
  try { return browserSupportsWebAuthn() } catch { return false }
}

/** Whether this browser and this server both do passkeys. */
export async function passkeysAvailable() {
  if (!browserHasPasskeys()) return false
  try { return (await Meteor.callAsync(M.available)) === true } catch { return false }
}

/** Whether the browser can offer passkeys in the email field's autofill (conditional UI). */
export async function autofillAvailable() {
  try { return await browserSupportsWebAuthnAutofill() } catch { return false }
}

/** Stop a passkey prompt or autofill request that is still waiting (leaving the page). */
export const cancelPasskeyPrompt = () => { try { WebAuthnAbortService.cancelCeremony() } catch { /* nothing waiting */ } }

const signal = (opts) => sendSignal(opts).catch(() => {})

function loginWith(response) {
  return new Promise((resolve, reject) => {
    Accounts.callLoginMethod({ methodArguments: [{ passkey: response }], userCallback: (error) => (error ? reject(error) : resolve()) })
  })
}

/**
 * Sign in with a passkey: the email field's autofill (autofill: true, conditional: it waits until the
 * person picks a passkey there and never opens a sheet), or the prompt (gesture: true, only from the
 * person's own click on the button; passkey-request.mjs). Resolves true once signed in, false when
 * passkeys are off here.
 */
export async function signInWithPasskey({ autofill = false, gesture = false } = {}) {
  // Refused before anything is asked of the server or the device.
  authenticationRequest(null, { autofill, gesture })
  const optionsJSON = await Meteor.callAsync(M.loginOptions)
  if (!optionsJSON) return false
  const response = await startAuthentication(authenticationRequest(optionsJSON, { autofill, gesture }))
  try {
    await loginWith(response)
  } catch (error) {
    // A passkey this server does not know: the device can drop it from its list.
    if (error?.error === 'unknown-passkey') signal({ signalName: 'unknownCredential', rpID: optionsJSON.rpId, credentialID: response.id })
    throw error
  }
  return true
}

/** Add a passkey to the signed-in account: the new passkey as Profile › Sign-in lists it. */
export async function addPasskey() {
  const optionsJSON = await Meteor.callAsync(M.registerOptions)
  const response = await startRegistration({ optionsJSON })
  return Meteor.callAsync(M.register, { response })
}

/**
 * A guest saves their account (or signs up) with a passkey instead of a password. Resolves what
 * users.identify does: true when the verification email went, else { verificationEmailSent: false }.
 */
export async function saveAccountWithPasskey({ email, firstName = '', lastName = '' }) {
  const optionsJSON = await Meteor.callAsync(M.claimOptions, { email })
  const response = await startRegistration({ optionsJSON })
  return Meteor.callAsync(M.claim, { response, email, firstName, lastName })
}

export const listPasskeys = () => Meteor.callAsync(M.list)
export const renamePasskey = (id, name) => Meteor.callAsync(M.rename, { id, name })

/** Remove a passkey, then tell the device which ones this account still accepts. */
export async function removePasskey(id, { rpId, userHandle } = {}) {
  const result = await Meteor.callAsync(M.remove, { id })
  if (rpId && userHandle) signal({ signalName: 'allAcceptedCredentials', rpID: rpId, userID: userHandle, allAcceptedCredentialIDs: result.remaining })
  return result
}

/** Keep the device's passkey list showing the account's current address and name. */
export function signalAccountDetails({ rpId, userHandle, email, name }) {
  if (!rpId || !userHandle || !email) return
  signal({ signalName: 'currentUserDetails', rpID: rpId, userID: userHandle, userName: email, userDisplayName: name || email })
}
