// The image's settings for a set of answers: plain settings (env, safe to
// show and to keep in a ConfigMap or slatebox.env) and secret references
// (secrets, resolved only when the secrets file or Secret is written).
// Settings the image does not list are left out with a warning, or refused
// when the person asked for what they turn on.
import { EXIT, InstallError } from '../errors.mjs'
import { aiEnv } from '../ai/settings-adapter.mjs'

/**
 * @param {object} answers resolved answers
 * @param {{settings: string[]}} caps what the image accepts
 * @returns {{env: Record<string,string>, secrets: Record<string,string>, warnings: string[], notes: string[], hostGateway: boolean}}
 */
export function settingsFor(answers, caps) {
  const known = new Set(caps?.settings || [])
  const env = {}
  const secrets = {}
  const warnings = []
  const notes = []
  const require = (name, what) => {
    if (!known.has(name)) throw new InstallError(EXIT.PRECONDITION, `This Slatebox image does not support ${what} (it does not accept ${name}). Use a newer image, or leave ${what} off.`)
  }
  const k8s = answers.target === 'k8s' || Boolean(answers.k8s)

  env.SLATEBOX_URL = answers.address.url
  // Behind an Ingress or a Gateway, HTTPS ends at the edge.
  if (k8s && answers.k8s?.route !== 'none' && answers.address.url?.startsWith('https:')) env.SLATEBOX_HTTPS = 'off'
  if (answers.acmeCa) { require('SLATEBOX_ACME_CA', 'a custom certificate authority'); env.SLATEBOX_ACME_CA = answers.acmeCa }

  if (answers.mail?.urlFrom) {
    require('SLATEBOX_MAIL_URL', 'mail')
    if (answers.mail.from) env.SLATEBOX_MAIL_FROM = answers.mail.from
  }

  if (answers.sso?.enabled) {
    require('SLATEBOX_SSO', 'single sign-on')
    env.SLATEBOX_SSO = 'keycloak'
    if (answers.sso.only) { require('SLATEBOX_SSO_ONLY', 'single sign-on only'); env.SLATEBOX_SSO_ONLY = 'true' }
    if (answers.sso.adminConsole === 'closed') { require('SLATEBOX_SSO_ADMIN', 'closing the Keycloak admin console'); env.SLATEBOX_SSO_ADMIN = 'closed' }
  }

  const ai = aiEnv(answers.ai, caps, { target: k8s ? 'k8s' : answers.target })
  // A multi-provider image names one key variable per provider; those are not in its list.
  for (const name of [...Object.keys(ai.env), ...Object.keys(ai.secrets).filter(name => !name.startsWith('SLATEBOX_AI_KEY_'))]) require(name, 'this AI setup')
  Object.assign(env, ai.env)
  notes.push(...ai.notes)

  if (answers.settings && Object.keys(answers.settings).length) {
    require('SLATEBOX_SETTINGS', 'extra settings')
    env.SLATEBOX_SETTINGS = JSON.stringify(answers.settings)
  }

  if (known.has('SLATEBOX_KEY_ENCRYPTION_KEY')) secrets.SLATEBOX_KEY_ENCRYPTION_KEY = 'generate'
  else warnings.push('This image does not accept SLATEBOX_KEY_ENCRYPTION_KEY, so people cannot save their own AI and call keys on it. A newer image can.')
  Object.assign(secrets, ai.secrets)
  if (answers.mail?.urlFrom) secrets.SLATEBOX_MAIL_URL = answers.mail.urlFrom

  return { env, secrets, warnings, notes, hostGateway: ai.hostGateway }
}
