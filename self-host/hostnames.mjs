import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function secureOrigin(value, protocol) {
  const url = new URL(value)
  if (url.protocol !== protocol || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Supply separate https:// app and wss:// relay origins without a path or credentials.')
  }
  return url
}

const app = secureOrigin(process.env.ROOT_URL, 'https:')
const relay = secureOrigin(process.env.WS_URL, 'wss:')
if (app.hostname === relay.hostname) throw new Error('Choose distinct hostnames for the app and relay.')

const source = '/opt/slatebox-source'
const settings = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'))
settings.public.baseUrl = app.origin
settings.public.wsUrl = relay.origin

// Preserve operator-defined variables and their quoting, including provider credentials.
const updates = {
  ROOT_URL: app.origin,
  SLATEBOX_STATE: process.env.SLATEBOX_STATE,
  COMPOSE_PROFILES: 'https',
  SLATEBOX_APP_HOST: app.hostname,
  SLATEBOX_RELAY_HOST: relay.hostname,
}
const original = await readFile(join(source, 'instance.env'), 'utf8')
const lines = original.split(/\r?\n/).filter(line => {
  const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1]
  return !Object.hasOwn(updates, key)
})
for (const [key, value] of Object.entries(updates)) {
  if (!value || /[\r\n']/.test(value)) throw new Error('Invalid installation path or hostname')
  lines.push(`${key}='${value}'`)
}

const output = process.argv[2]
await mkdir(output, { mode: 0o700 })
await writeFile(join(output, 'instance.env'), lines.join('\n') + '\n', { mode: 0o600 })
await writeFile(join(output, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
