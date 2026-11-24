// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Google in the browser: Google Identity Services (accounts.google.com/gsi/client) and the Picker
// (apis.google.com/js/api.js), loaded only when a Google control is shown.
//   connectGoogle()  a GIS code client (popup, redirect_uri "postmessage", offline, drive.file only):
//                    the one-time code goes to google.connect, and the server keeps what Google issues.
//   pickFiles()      a GIS token client gives the Picker a short browser token (drive.file), held in
//                    memory for this page only and never sent to Slatebox; files picked under
//                    drive.file become ones Slatebox may open, on the server too.
// Both must start inside a click, so the browser allows Google's window.
import { Meteor } from 'meteor/meteor'

export const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'
const GIS = 'https://accounts.google.com/gsi/client'
const API = 'https://apis.google.com/js/api.js'

const loaded = new Map()
function script(src) {
  if (loaded.has(src)) return loaded.get(src)
  const promise = new Promise((resolve, reject) => {
    const tag = document.createElement('script')
    tag.src = src
    tag.async = true
    tag.onload = () => resolve()
    tag.onerror = () => {
      loaded.delete(src)
      reject(new Error('Google could not be reached. Check your connection and try again.'))
    }
    document.head.appendChild(tag)
  })
  loaded.set(src, promise)
  return promise
}

/** Loads Google's sign-in (and the Picker when asked) ahead of the click that needs them. */
export function preloadGoogle({ picker = false } = {}) {
  const jobs = [script(GIS)]
  if (picker) jobs.push(script(API).then(() => new Promise((resolve) => window.gapi.load('picker', resolve))))
  return Promise.all(jobs)
}

const ready = () => Boolean(window.google?.accounts?.oauth2)

/**
 * Connect Google (inside a click). → the google.connect answer, or throws { code, message }.
 * prompt "consent" so Google issues lasting access (a refresh token) every time.
 */
export function connectGoogle(clientId) {
  if (!ready()) return Promise.reject({ code: 'loading', message: 'Google is still loading. Try again in a moment.' })
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: DRIVE_FILE,
      ux_mode: 'popup',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: false,
      callback: (answer) => {
        if (!answer?.code) return reject({ code: answer?.error || 'cancelled', message: 'Google sign-in was cancelled.' })
        Meteor.callAsync('google.connect', { code: answer.code }).then(resolve, reject)
      },
      error_callback: (problem) => reject({ code: problem?.type || 'cancelled', message: problem?.type === 'popup_failed_to_open' ? 'Your browser blocked Google\'s window. Allow pop-ups for Slatebox, then try again.' : 'Google sign-in was cancelled.' }),
    })
    client.requestCode()
  })
}

// The Picker's own short browser token: in memory for this page, never sent to Slatebox.
// account: the Google account connected on the server, so the Picker uses the same one (files picked
// under another account are ones Slatebox's sign-in could never open).
let pickerToken = null
function tokenForPicker(clientId, account = null) {
  if (pickerToken && pickerToken.until > Date.now() + 60000 && pickerToken.account === account) return Promise.resolve(pickerToken.value)
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE,
      prompt: '',
      ...(account && { login_hint: account }),
      callback: (answer) => {
        if (!answer?.access_token) return reject({ code: 'cancelled', message: 'Google sign-in was cancelled.' })
        pickerToken = { value: answer.access_token, until: Date.now() + (Number(answer.expires_in) || 0) * 1000, account }
        resolve(pickerToken.value)
      },
      error_callback: () => reject({ code: 'cancelled', message: 'Google sign-in was cancelled.' }),
    })
    client.requestAccessToken()
  })
}

/**
 * The Google Picker (inside a click): Docs, Sheets, Slides and text files. → [{ id, name, mimeType }]
 * ([] when the person closes it).
 */
export async function pickFiles({ clientId, apiKey, appId, account = null, multiple = false }) {
  if (!ready() || !window.google?.picker) throw { code: 'loading', message: 'Google is still loading. Try again in a moment.' }
  const token = await tokenForPicker(clientId, account)
  const { picker } = window.google
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes('application/vnd.google-apps.document,application/vnd.google-apps.spreadsheet,application/vnd.google-apps.presentation,text/plain,text/markdown,text/csv')
    const builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve((data.docs || []).map((doc) => ({ id: doc.id, name: doc.name, mimeType: doc.mimeType })))
        else if (data.action === picker.Action.CANCEL) resolve([])
      })
    if (multiple) builder.enableFeature(picker.Feature.MULTISELECT_ENABLED)
    builder.build().setVisible(true)
  })
}
