// The settings and commands this image accepts, in one place: configure.mjs refuses any other
// SLATEBOX_ name, and `slatebox settings --json` prints them for an installer to read from the
// image (no network, nothing kept), so it never writes a setting the image would refuse.
import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'

export const SETTINGS = Object.freeze([
  'SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_ACME_CA', 'SLATEBOX_MAIL_URL', 'SLATEBOX_MAIL_FROM',
  'SLATEBOX_AI_KEY', 'SLATEBOX_AI_URL', 'SLATEBOX_AI_MODEL', 'SLATEBOX_AI_CONFIG',
  'SLATEBOX_AI_PROVIDERS', 'SLATEBOX_AI_DEFAULT', 'SLATEBOX_AI_OWN_PROVIDERS', 'SLATEBOX_AI_PRIVATE_ENDPOINTS',
  'SLATEBOX_SETTINGS', 'SLATEBOX_SSO', 'SLATEBOX_SSO_ONLY', 'SLATEBOX_SSO_ADMIN', 'SLATEBOX_SSO_DEFAULT_ROLE', 'SLATEBOX_SSO_DOMAINS',
  'SLATEBOX_KEY_ENCRYPTION_KEY',
  // A Cloudflare Tunnel connector token: a team address (https://<name>.slatebox.team) or your own tunnel.
  'SLATEBOX_TUNNEL_TOKEN',
  // An on-prem license key from Slatebox LLC for the enterprise features (enterprise/README.md):
  // the key itself, or the path of a file inside the container that holds it.
  'SLATEBOX_LICENSE', 'SLATEBOX_LICENSE_FILE',
  // Updates from GitHub releases: auto (Admin › Updates decides), notify (never applied by itself) or
  // off (no update request ever leaves this server). SLATEBOX_UPDATE_FEED is another signed feed
  // (a test feed, or a mirror); what it serves must still be signed with a release key.
  'SLATEBOX_UPDATES', 'SLATEBOX_UPDATE_FEED',
])
export const DATABASE_SETTINGS = Object.freeze(['MONGO_URL', 'MONGO_OPLOG_URL'])
// One key variable per provider in SLATEBOX_AI_PROVIDERS (its keyEnv), never listed by name.
export const PROVIDER_KEY = /^SLATEBOX_AI_KEY_[A-Z0-9_]{1,40}$/
export const COMMANDS = Object.freeze(['backup', 'restore', 'password-link', 'setup-link', 'health', 'version', 'sso', 'ai', 'settings', 'tunnel', 'updates', 'restore-on-start'])

// Where this container runs, for Admin › Updates: on Kubernetes (every pod has KUBERNETES_SERVICE_HOST)
// the installer's StatefulSet names its one pod <install>-0, so the upgrade command can name the install.
export function runtimeFacts(env = process.env, host = hostname()) {
  if (!env.KUBERNETES_SERVICE_HOST) return { runtime: 'docker' }
  const name = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?)-\d+$/.exec(String(host || ''))?.[1] || null
  return { runtime: 'kubernetes', ...(name ? { install: name } : {}) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--json') {
    process.stderr.write('Usage: slatebox settings --json\n')
    process.exit(2)
  }
  process.stdout.write(`${JSON.stringify({ settings: [...SETTINGS, ...DATABASE_SETTINGS], providerKey: PROVIDER_KEY.source, commands: COMMANDS })}\n`)
}
