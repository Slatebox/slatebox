import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const state = resolve(process.env.SLATEBOX_STATE || '.state')
const output = resolve(process.argv[2] || state)
const hex = () => randomBytes(32).toString('hex')
function port(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw Error('Invalid port')
  return n
}
function origin(value, protocols) {
  const url = new URL(value)
  if (!protocols.includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('Use a public origin URL without credentials, path, or query')
  }
  return url.origin
}
const appPort = port(process.env.APP_PORT || 7070)
const collabPort = port(process.env.COLLAB_PORT || 7071)
if (appPort === collabPort) throw Error('Choose separate HTTP and collaboration ports')
const root = origin(process.env.ROOT_URL || `http://localhost:${appPort}`, ['http:', 'https:'])
const wsUrl = origin(process.env.WS_URL || `ws://localhost:${collabPort}`, ['ws:', 'wss:'])
if (root.startsWith('https:') && !wsUrl.startsWith('wss:')) throw Error('HTTPS sites require a secure wss:// origin')
const publicKey = hex(), secretKey = hex()
const settings = {
  public: { env: 'selfhost', edition: 'self-host', baseUrl: root, wsUrl, chatWoot: { enabled: false } },
  mailGun: { server: '' },
  slateboxAPI: { publicKey, secretKey },
  selfHosted: { workshopAI: false },
  // Made once with the other secrets: a backup restored into a new installation gets a new id.
  instance: { id: randomUUID() },
}
const env = {
  SLATEBOX_STATE: state, APP_PORT: appPort, COLLAB_PORT: collabPort, ROOT_URL: root,
  APP_IMAGE: process.env.APP_IMAGE,
  COLLAB_IMAGE: process.env.COLLAB_IMAGE,
  MONGO_ROOT_PASSWORD: hex(), APP_PASSWORD: hex(), RELAY_PASSWORD: hex(), REPLICA_KEY: hex(),
  API_GEN_KEY: randomBytes(32).toString('base64'), API_KEYS: JSON.stringify([{ name: 'slatebox', publicKey, secretKey }]),
}
if (!env.APP_IMAGE || !env.COLLAB_IMAGE) throw Error('Set APP_IMAGE and COLLAB_IMAGE to the supplied release images or tags from build-images.sh')
if (process.env.SLATEBOX_HTTPS === '1') {
  const app = new URL(root), relay = new URL(wsUrl)
  if (app.protocol !== 'https:' || relay.protocol !== 'wss:' || app.hostname === relay.hostname) {
    throw Error('For managed HTTPS, set ROOT_URL and WS_URL to separate HTTPS and WSS hostnames.')
  }
  Object.assign(env, {
    COMPOSE_PROFILES: 'https',
    SLATEBOX_APP_HOST: app.hostname,
    SLATEBOX_RELAY_HOST: relay.hostname,
  })
}
const lines = Object.entries(env).map(([key, value]) => {
  if (/[\r\n']/.test(String(value))) throw Error('Unsupported character in installation path or configuration')
  return `${key}='${value}'`
})
// Optional provider keys, blank until the operator sets one: a connection in settings.json reads
// its key from the variable it names in apiKeyEnv (self-host/README.md).
lines.push('# Optional AI provider keys, read by a settings.json connection that names one in apiKeyEnv.')
for (const key of ['GEMINI_API_KEY', 'META_API_KEY']) lines.push(`${key}=''`)
await mkdir(output, { mode: 0o700 }) // Refuse to replace the secrets for an existing database.
await writeFile(resolve(output, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
await writeFile(resolve(output, 'instance.env'), lines.join('\n') + '\n', { mode: 0o600 })
console.log(`App URL: ${root}. Collaboration URL: ${wsUrl}.`)
