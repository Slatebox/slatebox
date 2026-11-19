// Runs once at every container start, before any service. It reads the few
// optional settings, creates the installation's secrets the first time, and
// renders what each process needs. It never prints a secret.
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_PORT, DATABASE, DB_DIR, FRONT_PORT, HOME, MONGO_KEY_FILE, MONGO_PORT, Plain, RELAY_PATH, RELAY_PORT, RUN,
  TMP_DIR, DATA, ensureSecrets, envFile, fail, mongoUrl, writePrivate,
} from './common.mjs'

const KNOWN = [
  'SLATEBOX_URL', 'SLATEBOX_HTTPS', 'SLATEBOX_ACME_CA', 'SLATEBOX_MAIL_URL',
  'SLATEBOX_AI_KEY', 'SLATEBOX_AI_URL', 'SLATEBOX_AI_MODEL', 'SLATEBOX_SETTINGS',
]

function setting(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseUrl(name, value, protocols) {
  let url
  try { url = new URL(value) } catch { throw new Plain(`${name} is not a valid address: ${value}`) }
  if (!protocols.includes(url.protocol)) {
    throw new Plain(`${name} must start with ${protocols.map(p => `${p}//`).join(' or ')}`)
  }
  return url
}

function publicAddress() {
  const value = setting('SLATEBOX_URL') || `http://localhost:${FRONT_PORT}`
  const url = parseUrl('SLATEBOX_URL', value, ['http:', 'https:'])
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Plain(
      `SLATEBOX_URL must be the address people type, with nothing after the host, for example https://boards.example.com (received ${value})`)
  }
  return url
}

function httpsMode(url) {
  const mode = (setting('SLATEBOX_HTTPS') || 'auto').toLowerCase()
  if (!['auto', 'off'].includes(mode)) throw new Plain('SLATEBOX_HTTPS must be auto or off')
  if (url.protocol !== 'https:' || mode === 'off') return false
  const local = /^(localhost|.*\.localhost|\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)
  if (url.port || local) {
    throw new Plain(
      `Built-in HTTPS needs a public host name on the standard port, for example https://boards.example.com (received ${url.origin}).\n` +
      'If your own proxy terminates HTTPS, add SLATEBOX_HTTPS=off and forward to port 7070.')
  }
  return true
}

function mergeSettings(base, extra) {
  for (const [key, value] of Object.entries(extra)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
      mergeSettings(base[key], value)
    } else {
      base[key] = value
    }
  }
  return base
}

function extraSettings() {
  const raw = setting('SLATEBOX_SETTINGS')
  if (!raw) return {}
  let extra
  try { extra = JSON.parse(raw) } catch { throw new Plain('SLATEBOX_SETTINGS must be a JSON object') }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Plain('SLATEBOX_SETTINGS must be a JSON object')
  return extra
}

function caddyfile({ url, builtInHttps, acmeCa }) {
  // The published port answers for the configured address and for the
  // container's own loopback checks. Any other address gets a page that says
  // which setting to change, instead of an app whose links and live editing
  // point somewhere else.
  const allowed = [...new Set([url.host, `localhost:${FRONT_PORT}`, `127.0.0.1:${FRONT_PORT}`])]
  const routes = indent => `
@relay path ${RELAY_PATH} ${RELAY_PATH}/*
handle @relay {
	uri strip_prefix ${RELAY_PATH}
	reverse_proxy 127.0.0.1:${RELAY_PORT}
}
handle {
	reverse_proxy 127.0.0.1:${APP_PORT}
}`.replace(/\n/g, `\n${indent}`)
  const starting = `
	handle_errors 502 503 504 {
		root * ${HOME}/share
		rewrite * /starting.html
		header Cache-Control no-store
		header Retry-After 3
		file_server {
			status 503
		}
	}`
  const sites = [`
http://:${FRONT_PORT} {
	@expected expression \`{http.request.hostport} in [${allowed.map(host => JSON.stringify(host)).join(', ')}]\`
	handle @expected {${routes('\t\t')}
	}
	handle {
		root * ${join(RUN, 'share')}
		rewrite * /wrong-address.html
		header Cache-Control no-store
		file_server {
			status 421
		}
	}${starting}
}`]
  if (builtInHttps) sites.push(`
${url.hostname} {${routes('\t')}${starting}
}`)
  const options = [
    'admin off',
    'persist_config off',
    'grace_period 2s',
    `storage file_system ${join(DATA, 'caddy')}`,
    ...(builtInHttps ? [] : ['auto_https off']),
    ...(acmeCa ? [`acme_ca ${acmeCa}`] : []),
  ]
  return `# Rendered at start by configure.mjs. Change the SLATEBOX_ settings instead of this file.
{
	${options.join('\n\t')}
	log {
		format console {
			level_format upper
		}
		level ERROR
	}
}
${sites.join('\n')}
`
}

function wrongAddressPage(url) {
  const page = readFileSync(join(HOME, 'share/wrong-address.html'), 'utf8')
  return page.replaceAll('__SLATEBOX_URL__', url.origin)
}

function main() {
  const unknown = Object.keys(process.env).filter(name => name.startsWith('SLATEBOX_') && !KNOWN.includes(name))
  if (unknown.length) {
    throw new Plain(`Unknown setting ${unknown.join(', ')}. The settings are: ${KNOWN.join(', ')}, MONGO_URL, MONGO_OPLOG_URL.`)
  }

  const url = publicAddress()
  const builtInHttps = httpsMode(url)
  const acmeCa = setting('SLATEBOX_ACME_CA')
  if (acmeCa) parseUrl('SLATEBOX_ACME_CA', acmeCa, ['https:'])
  const wsUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${RELAY_PATH}`

  const mailUrl = setting('SLATEBOX_MAIL_URL')
  if (mailUrl) parseUrl('SLATEBOX_MAIL_URL', mailUrl, ['smtp:', 'smtps:'])

  const aiKey = setting('SLATEBOX_AI_KEY')
  const aiUrl = setting('SLATEBOX_AI_URL')
  const aiModel = setting('SLATEBOX_AI_MODEL')
  if (aiUrl) {
    parseUrl('SLATEBOX_AI_URL', aiUrl, ['http:', 'https:'])
    if (!aiModel) throw new Plain('SLATEBOX_AI_URL also needs SLATEBOX_AI_MODEL, the model name your endpoint serves')
  } else if (aiModel) {
    throw new Plain('SLATEBOX_AI_MODEL only applies together with SLATEBOX_AI_URL')
  }

  const externalMongo = setting('MONGO_URL')
  const externalOplog = setting('MONGO_OPLOG_URL')
  if (externalMongo) parseUrl('MONGO_URL', externalMongo, ['mongodb:', 'mongodb+srv:'])
  if (externalOplog && !externalMongo) throw new Plain('MONGO_OPLOG_URL only applies together with MONGO_URL')
  const extra = extraSettings()

  // Every setting is valid. Only now is anything written.
  for (const dir of [RUN, TMP_DIR, ...(externalMongo ? [] : [DB_DIR])]) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const { secrets, created } = ensureSecrets()

  // Generated values come last so SLATEBOX_SETTINGS cannot break the wiring
  // between the browser, the app and the relay.
  const settings = mergeSettings(extra, {
    public: { env: 'selfhost', baseUrl: url.origin, wsUrl, chatWoot: { enabled: false } },
    slateboxAPI: { publicKey: secrets.apiPublicKey, secretKey: secrets.apiSecretKey },
  })
  settings.mailGun = { server: '', ...settings.mailGun }
  settings.selfHosted = { ...settings.selfHosted }
  if (aiUrl) {
    settings.selfHosted.workshopAI = true
    settings.selfHosted.workshopProvider = { baseUrl: aiUrl, model: aiModel, ...(aiKey ? { apiKey: aiKey } : {}) }
  } else if (aiKey) {
    settings.selfHosted.workshopAI = true
  } else if (settings.selfHosted.workshopAI !== true) {
    settings.selfHosted.workshopAI = false
  }

  writePrivate(join(RUN, 'app.env'), envFile({
    NODE_ENV: 'production',
    ROOT_URL: url.origin,
    PORT: APP_PORT,
    BIND_IP: '127.0.0.1',
    HTTP_FORWARDED_COUNT: 1,
    MONGO_URL: externalMongo || mongoUrl('app', secrets.mongoAppPassword),
    MONGO_OPLOG_URL: externalMongo
      ? externalOplog
      : mongoUrl('app', secrets.mongoAppPassword, { database: 'local', authSource: DATABASE }),
    METEOR_SETTINGS: JSON.stringify(settings),
    MAIL_URL: mailUrl,
    API_KEY_DEEP_INFRA: aiUrl ? undefined : aiKey,
  }))
  writePrivate(join(RUN, 'relay.env'), envFile({
    NODE_ENV: 'production',
    // The relay's URL parsing draws a deprecation notice from Node 24 on every start.
    NODE_OPTIONS: '--no-deprecation',
    HOST: '127.0.0.1',
    PORT: RELAY_PORT,
    MONGO_URL: externalMongo || mongoUrl('relay', secrets.mongoRelayPassword),
    API_GEN_KEY: secrets.apiGenKey,
    API_KEYS: JSON.stringify([{ name: 'slatebox', publicKey: secrets.apiPublicKey, secretKey: secrets.apiSecretKey }]),
  }))
  writePrivate(join(RUN, 'Caddyfile'), caddyfile({ url, builtInHttps, acmeCa }))
  writePrivate(join(RUN, 'share/wrong-address.html'), wrongAddressPage(url))
  writePrivate(join(RUN, 'state.env'), envFile({
    SLATEBOX_PUBLIC_URL: url.origin,
    SLATEBOX_BUNDLED_MONGO: externalMongo ? 0 : 1,
  }))
  if (!externalMongo) {
    writePrivate(MONGO_KEY_FILE, secrets.mongoKey + '\n', 0o400)
    writePrivate(join(RUN, 'mongo-tools.yaml'),
      `uri: ${JSON.stringify(mongoUrl('root', secrets.mongoRootPassword, { database: '', authSource: 'admin' }))}\n`)
  }

  const identity = JSON.parse(readFileSync(join(HOME, 'identity.json'), 'utf8'))
  const say = line => process.stdout.write(`${line}\n`)
  say(`Slatebox (app ${identity.app}, engine ${identity.engine}, relay ${identity.relay})`)
  say(`Address:   ${url.origin}`)
  say(`HTTPS:     ${builtInHttps ? `built in, certificates for ${url.hostname} (publish ports 80 and 443)` : url.protocol === 'https:' ? 'handled by your proxy' : 'off'}`)
  say(`Database:  ${externalMongo ? 'external (MONGO_URL)' : `bundled MongoDB ${identity.mongodb}, stored in ${DB_DIR}`}`)
  say(`Secrets:   ${created === 'all' ? 'created for this new installation' : created ? `kept, ${created} new` : 'kept from earlier starts'} (${join(DATA, 'secrets')})`)
  say(`Mail:      ${mailUrl ? 'on' : 'off (set SLATEBOX_MAIL_URL to send invitations and sign-in mail)'}`)
  say(`AI drafts: ${aiUrl ? `on, using ${new URL(aiUrl).host}` : aiKey ? 'on, using DeepInfra' : settings.selfHosted.workshopAI ? 'on' : 'off (set SLATEBOX_AI_KEY to turn them on)'}`)
}

try { main() } catch (error) { fail(error) }
