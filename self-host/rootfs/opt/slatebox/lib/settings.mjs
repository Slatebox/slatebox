// The settings and commands this image accepts, in one place: configure.mjs refuses any other
// SLATEBOX_ name, and `slatebox settings --json` prints them for an installer to read from the
// image (no network, nothing kept), so it never writes a setting the image would refuse.
import { fileURLToPath } from 'node:url'

export const SETTINGS = Object.freeze([
  'SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_ACME_CA', 'SLATEBOX_MAIL_URL', 'SLATEBOX_MAIL_FROM',
  'SLATEBOX_AI_KEY', 'SLATEBOX_AI_URL', 'SLATEBOX_AI_MODEL', 'SLATEBOX_AI_CONFIG',
  'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT', 'SLATEBOX_AI_OWN_PROVIDERS', 'SLATEBOX_AI_PRIVATE_ENDPOINTS',
  'SLATEBOX_SETTINGS', 'SLATEBOX_SSO', 'SLATEBOX_SSO_ONLY', 'SLATEBOX_SSO_ADMIN', 'SLATEBOX_KEY_ENCRYPTION_KEY',
])
export const DATABASE_SETTINGS = Object.freeze(['MONGO_URL', 'MONGO_OPLOG_URL'])
// One key variable per provider in SLATEBOX_AI_PROVIDERS (its keyEnv), never listed by name.
export const PROVIDER_KEY = /^SLATEBOX_AI_KEY_[A-Z0-9_]{1,40}$/
export const COMMANDS = Object.freeze(['backup', 'restore', 'password-link', 'health', 'version', 'sso', 'ai', 'settings'])

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--json') {
    process.stderr.write('Usage: slatebox settings --json\n')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify({ settings: [...SETTINGS, ...DATABASE_SETTINGS], providerKey: PROVIDER_KEY.source, commands: COMMANDS })}\n`)
}
