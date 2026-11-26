// Runs once at every container start, before any service. It reads the few
// optional settings, creates the installation's secrets the first time, and
// renders what each process needs. It never prints a secret.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  APP_PORT, DATABASE, DB_DIR, FRONT_PORT, HOME, KEYCLOAK_DATA, KEYCLOAK_PORT, MONGO_KEY_FILE, MONGO_PORT, Plain, RELAY_PATH,
  RELAY_PORT, RUN, SSO_PATH, TMP_DIR, DATA, TUNNEL_FAILED, TUNNEL_TOKEN_DATA_FILE, TUNNEL_TOKEN_FILE, ensureKeyEncryptionKey, ensureSecrets,
  envFile, fail, isKeyEncryptionKey, mongoUrl, writePrivate,
} from './common.mjs'
import { appSettings as ssoAppSettings, issuerFor, keycloakEnv, ssoMode } from './sso.mjs'
import { operatorAI } from './ai-config.mjs'
import { DATABASE_SETTINGS, PROVIDER_KEY, SETTINGS as KNOWN, runtimeFacts } from './settings.mjs'

// Payments and metering run only on Slatebox Cloud, under its signed license: a self-hosted
// Slatebox is never a paid service, so its settings cannot switch them on.
const CLOUD_ONLY = ['stripePrivateKey', 'stripe', 'metering', 'wallet']

function setting(name) {
  const value = process.env[name]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// An address as it may be shown in the log: a user name or password in it,
// such as a mail or database password, is replaced by ***.
function shown(value) {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1***@')
}

function parseUrl(name, value, protocols) {
  let url
  try { url = new URL(value) } catch { throw new Plain(`${name} is not a valid address: ${shown(value)}`) }
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
      `SLATEBOX_URL must be the address people type, with nothing after the host, for example https://boards.example.com (received ${shown(value)})`)
  }
  return url
}

// A Cloudflare Tunnel connector token (a team address, or your own tunnel): SLATEBOX_TUNNEL_TOKEN,
// or the file /data/tunnel/token (a Kubernetes Secret mounted there). It is base64 of
// {"a": account, "t": tunnel, "s": secret}; anything else is refused. It is never printed: only
// the tunnel's id, which is not a secret, appears in the log.
function tunnelToken() {
  let value = setting('SLATEBOX_TUNNEL_TOKEN')
  if (!value && existsSync(TUNNEL_TOKEN_DATA_FILE)) value = readFileSync(TUNNEL_TOKEN_DATA_FILE, 'utf8').trim() || undefined
  if (!value) return null
  let parsed = null
  try { parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) } catch { /* refused below */ }
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || !parsed?.a || !parsed?.t || !parsed?.s) {
    throw new Plain(`SLATEBOX_TUNNEL_TOKEN is not a Cloudflare Tunnel token (received ${value.length} characters, not shown)`)
  }
  return { value, tunnelId: String(parsed.t) }
}

function httpsMode(url, tunnel) {
  const given = setting('SLATEBOX_HTTPS')
  const mode = (given || 'auto').toLowerCase()
  if (!['auto', 'off'].includes(mode)) throw new Plain('SLATEBOX_HTTPS must be auto or off')
  if (tunnel) {
    // Cloudflare ends HTTPS; Caddy serves plain HTTP to cloudflared on loopback and never asks
    // for a certificate.
    if (given && mode === 'auto') throw new Plain('SLATEBOX_HTTPS=auto cannot be used with SLATEBOX_TUNNEL_TOKEN: the tunnel ends HTTPS at Cloudflare. Leave SLATEBOX_HTTPS out or set it to off.')
    if (url.protocol !== 'https:') throw new Plain(`With SLATEBOX_TUNNEL_TOKEN, SLATEBOX_URL is the tunnel's https:// address, for example https://acme.slatebox.team (received ${url.origin})`)
    return false
  }
  if (url.protocol !== 'https:' || mode === 'off') return false
  const local = /^(localhost|.*\.localhost|\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)
  if (url.port || local) {
    throw new Plain(
      `Built-in HTTPS needs a public host name on the standard port, for example https://boards.example.com (received ${url.origin}).\n` +
      'If your own proxy terminates HTTPS, add SLATEBOX_HTTPS=off and forward to port 7070.')
  }
  return true
}

// The sender of every mail. Mail services accept only a sender address
// their operator has verified, so it is the operator's own: SLATEBOX_MAIL_FROM,
// or else the mail account's user name when that is an address.
function mailSender(mailUrl) {
  const from = setting('SLATEBOX_MAIL_FROM')
  if (from && !mailUrl) throw new Plain('SLATEBOX_MAIL_FROM only applies together with SLATEBOX_MAIL_URL')
  if (!mailUrl) return undefined
  const address = /^(?:[^<>@\s][^<>@]*<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>|[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)$/
  if (from) {
    if (!address.test(from)) {
      throw new Plain(`SLATEBOX_MAIL_FROM must be an address, for example "Slatebox <boards@example.com>" or boards@example.com (received ${from})`)
    }
    return from
  }
  const user = decodeURIComponent(new URL(mailUrl).username)
  if (address.test(user)) return `Slatebox <${user}>`
  throw new Plain(
    'SLATEBOX_MAIL_URL also needs SLATEBOX_MAIL_FROM, the address mail is sent from, one your mail service accepts, ' +
    'for example SLATEBOX_MAIL_FROM="Slatebox <boards@example.com>"')
}

// The master key for every AI and call key saved on this server: the
// administrator's in Admin → AI control and people's own. The app reads it as
// 32 bytes in base64 (standard or URL-safe); anything else would silently
// decode to a different key, so it is refused here. Unset, the installation's
// own key is used (made on first boot and kept in /data/secrets, see
// ensureKeyEncryptionKey). The value is never printed, not even when it is refused.
function keyEncryptionKey() {
  const value = setting('SLATEBOX_KEY_ENCRYPTION_KEY')
  if (!value) return undefined
  if (!isKeyEncryptionKey(value)) {
    throw new Plain(
      'SLATEBOX_KEY_ENCRYPTION_KEY must be 32 random bytes in base64, for example the output of openssl rand -base64 32 ' +
      `(received ${value.length} characters, not shown)`)
  }
  return value
}

// An on-prem license key (enterprise/README.md): SLATEBOX_LICENSE holds the key, SLATEBOX_LICENSE_FILE
// the path of a file inside the container that holds it. Either goes into the app's private settings
// (enterprise.license / enterprise.licenseFile), where the app checks it offline. One license, said
// once: the same thing in SLATEBOX_SETTINGS as well stops the start. The key is never printed.
function licenseSettings(extra) {
  const key = setting('SLATEBOX_LICENSE')
  const file = setting('SLATEBOX_LICENSE_FILE')
  if (!key && !file) return null
  if (key && file) throw new Plain('Set SLATEBOX_LICENSE or SLATEBOX_LICENSE_FILE, not both')
  if (extra.enterprise?.license || extra.enterprise?.licenseFile) {
    throw new Plain(`${key ? 'SLATEBOX_LICENSE' : 'SLATEBOX_LICENSE_FILE'} and SLATEBOX_SETTINGS enterprise.license or enterprise.licenseFile both give a license: keep one`)
  }
  if (key) {
    if (!/^sblic1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) {
      throw new Plain(`SLATEBOX_LICENSE is not a Slatebox license key, which is one line starting with sblic1. (received ${key.length} characters, not shown)`)
    }
    return { license: key }
  }
  if (!file.startsWith('/')) throw new Plain(`SLATEBOX_LICENSE_FILE must be a path inside the container, starting with / (received ${file})`)
  if (!existsSync(file)) throw new Plain(`SLATEBOX_LICENSE_FILE: ${file} is not in the container. Mount the file there, for example -v /path/on/host/slatebox.license:${file}:ro`)
  return { licenseFile: file }
}

// Updates (lib/updates.mjs): SLATEBOX_UPDATES=auto|notify|off, SLATEBOX_UPDATE_FEED=<the feed's address>.
function updateSettings() {
  const mode = setting('SLATEBOX_UPDATES') || 'auto'
  if (!['auto', 'notify', 'off'].includes(mode)) throw new Plain(`SLATEBOX_UPDATES is auto, notify or off (received ${mode})`)
  const feed = setting('SLATEBOX_UPDATE_FEED')
  if (feed) {
    const url = parseUrl('SLATEBOX_UPDATE_FEED', feed, ['https:', 'http:'])
    if (!url.pathname.endsWith('/update-feed/channels.json')) throw new Plain(`SLATEBOX_UPDATE_FEED is the address of a channels.json in an update-feed folder (received ${url.origin}${url.pathname})`)
  }
  return { mode, feed: feed || '' }
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
  const cloudOnly = [...CLOUD_ONLY.filter(key => key in extra), ...(extra.public && typeof extra.public === 'object' && 'stripe' in extra.public ? ['public.stripe'] : [])]
  if (cloudOnly.length) throw new Plain(`SLATEBOX_SETTINGS: ${cloudOnly.join(', ')} ${cloudOnly.length > 1 ? 'are' : 'is'} not a setting of a self-hosted Slatebox (payments and metering run only on Slatebox Cloud)`)
  return extra
}

function caddyfile({ url, builtInHttps, acmeCa, sso, ssoAdminOpen = true, tunnel = false }) {
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
}${sso && !ssoAdminOpen ? `
@ssoAdmin path ${SSO_PATH}/admin ${SSO_PATH}/admin/* ${SSO_PATH}/realms/master ${SSO_PATH}/realms/master/*
handle @ssoAdmin {
	header Cache-Control no-store
	respond "Keycloak's admin console is closed on this address (SLATEBOX_SSO_ADMIN=closed)." 404
}` : ''}${sso ? `
@sso path ${SSO_PATH} ${SSO_PATH}/*
handle @sso {
	reverse_proxy 127.0.0.1:${KEYCLOAK_PORT}
}` : ''}
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
    // Behind the tunnel every request comes from cloudflared on loopback, which forwards the
    // visitor's address in X-Forwarded-For: keep it (and add ours) instead of replacing it.
    ...(tunnel ? ['servers {\n\t\ttrusted_proxies static 127.0.0.1/32 ::1/128\n\t}'] : []),
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
  // Names are matched without regard to case, so that slatebox_url is
  // reported rather than silently ignored.
  const exact = [...KNOWN, ...DATABASE_SETTINGS]
  const unknown = Object.keys(process.env).filter(name =>
    (name.toUpperCase().startsWith('SLATEBOX_') || exact.includes(name.toUpperCase())) && !exact.includes(name) && !PROVIDER_KEY.test(name))
  if (unknown.length) {
    throw new Plain(`Unknown setting ${unknown.join(', ')}. The settings are: ${exact.join(', ')} (in capitals).`)
  }

  const url = publicAddress()
  const tunnel = tunnelToken()
  const builtInHttps = httpsMode(url, tunnel)
  const acmeCa = setting('SLATEBOX_ACME_CA')
  if (acmeCa) parseUrl('SLATEBOX_ACME_CA', acmeCa, ['https:'])
  const wsUrl = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}${RELAY_PATH}`

  const mailUrl = setting('SLATEBOX_MAIL_URL')
  if (mailUrl) parseUrl('SLATEBOX_MAIL_URL', mailUrl, ['smtp:', 'smtps:'])
  const mailFrom = mailSender(mailUrl)

  // Any mix of AI the operator chooses (ai-config.mjs); nothing bundled, nothing named.
  const ai = operatorAI(setting)
  // A provider key variable that no provider names is a typo, not a setting.
  const strayKeys = Object.keys(process.env).filter(name => PROVIDER_KEY.test(name) && !ai.keyVariables.includes(name))
  if (strayKeys.length) throw new Plain(`${strayKeys.join(', ')}: no provider in SLATEBOX_AI_PROVIDERS names ${strayKeys.length > 1 ? 'these keys' : 'this key'} (keyEnv)`)

  const externalMongo = setting('MONGO_URL')
  const externalOplog = setting('MONGO_OPLOG_URL')
  if (externalMongo) parseUrl('MONGO_URL', externalMongo, ['mongodb:', 'mongodb+srv:'])
  if (externalOplog && !externalMongo) throw new Plain('MONGO_OPLOG_URL only applies together with MONGO_URL')
  const extra = extraSettings()
  const license = licenseSettings(extra)
  const sso = ssoMode(setting)
  const ownKeysKey = keyEncryptionKey()
  const updates = updateSettings()

  // Every setting is valid. Only now is anything written.
  for (const dir of [RUN, TMP_DIR, ...(externalMongo ? [] : [DB_DIR]), ...(sso.enabled ? [KEYCLOAK_DATA, join(RUN, 'keycloak-tmp')] : [])]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  const { secrets, created } = ensureSecrets({ sso: sso.enabled })
  const kek = ensureKeyEncryptionKey({ given: ownKeysKey })

  // Generated values come last so SLATEBOX_SETTINGS cannot break the wiring
  // between the browser, the app and the relay.
  const settings = mergeSettings(extra, {
    public: {
      // A self-hosted install: enterprise code stays locked until an on-prem license unlocks it.
      env: 'selfhost', edition: 'self-host', baseUrl: url.origin, wsUrl, chatWoot: { enabled: false },
      // Cloud links store images in S3, offered only when SLATEBOX_SETTINGS configures a bucket.
      cloudLinks: Boolean(extra.aws?.imageBucket),
    },
    slateboxAPI: { publicKey: secrets.apiPublicKey, secretKey: secrets.apiSecretKey },
  })
  if (license) settings.enterprise = { ...settings.enterprise, ...license }
  // Single sign-on is either wired to the bundled Keycloak or off; SLATEBOX_SETTINGS cannot half-configure it.
  delete settings.sso
  if (settings.public) delete settings.public.sso
  if (sso.enabled) mergeSettings(settings, ssoAppSettings({ url, secrets, only: sso.only, defaultRole: sso.defaultRole, domains: sso.domains }))
  if (mailFrom) settings.mailFrom = mailFrom
  settings.mailGun = { server: '', ...settings.mailGun }
  settings.selfHosted = { ...settings.selfHosted }
  // The AI settings win over the same fields in SLATEBOX_SETTINGS.
  if (ai.settings) settings.ai = { ...settings.ai, ...ai.settings, connections: { ...settings.ai?.connections, ...ai.settings.connections }, use: { ...settings.ai?.use, ...ai.settings.use } }
  // An app from before settings.ai reads this one endpoint for workshops.
  if (ai.legacy) settings.selfHosted.workshopProvider = ai.legacy
  settings.selfHosted.updates = { mode: updates.mode, ...(updates.feed ? { feedUrl: updates.feed } : {}), ...runtimeFacts() }
  if (ai.on) {
    settings.selfHosted.workshopAI = true
  } else if (settings.selfHosted.workshopAI !== true) {
    settings.selfHosted.workshopAI = false
  }

  writePrivate(join(RUN, 'app.env'), envFile({
    NODE_ENV: 'production',
    ROOT_URL: url.origin,
    PORT: APP_PORT,
    BIND_IP: '127.0.0.1',
    // The proxies in front of the app: Caddy, and with a tunnel also cloudflared (Caddy keeps the
    // visitor's address it forwards), so the app reads the visitor's address, not a proxy's.
    HTTP_FORWARDED_COUNT: tunnel ? 2 : 1,
    MONGO_URL: externalMongo || mongoUrl('app', secrets.mongoAppPassword),
    MONGO_OPLOG_URL: externalMongo
      ? externalOplog
      : mongoUrl('app', secrets.mongoAppPassword, { database: 'local', authSource: DATABASE }),
    METEOR_SETTINGS: JSON.stringify(settings),
    MAIL_URL: mailUrl,
    API_KEY_DEEP_INFRA: ai.deepInfraKey,
    // Read from the environment only, never from the settings (server/metering/vault.mjs).
    SLATEBOX_KEY_ENCRYPTION_KEY: kek.value,
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
  if (sso.enabled) writePrivate(join(RUN, 'keycloak.env'), envFile(keycloakEnv({ url, secrets })))
  writePrivate(join(RUN, 'Caddyfile'), caddyfile({ url, builtInHttps, acmeCa, sso: sso.enabled, ssoAdminOpen: sso.adminOpen, tunnel: Boolean(tunnel) }))
  // The token goes to cloudflared alone, in a file; slatebox-init removes it from every
  // process's environment. app.env and relay.env never hold it.
  if (tunnel) writePrivate(TUNNEL_TOKEN_FILE, tunnel.value)
  else rmSync(TUNNEL_TOKEN_FILE, { force: true })
  rmSync(TUNNEL_FAILED, { force: true })
  writePrivate(join(RUN, 'share/wrong-address.html'), wrongAddressPage(url))
  writePrivate(join(RUN, 'state.env'), envFile({
    SLATEBOX_PUBLIC_URL: url.origin,
    SLATEBOX_BUNDLED_MONGO: externalMongo ? 0 : 1,
    SLATEBOX_SSO: sso.enabled ? 'keycloak' : 'off',
    SLATEBOX_SSO_ADMIN: sso.adminOpen ? 'open' : 'closed',
    SLATEBOX_TUNNEL: tunnel ? 1 : 0,
    SLATEBOX_UPDATES: updates.mode,
    SLATEBOX_UPDATE_FEED: updates.feed,
  }))
  if (!externalMongo) {
    writePrivate(MONGO_KEY_FILE, secrets.mongoKey + '\n', 0o400)
    writePrivate(join(RUN, 'mongo-tools.yaml'),
      `uri: ${JSON.stringify(mongoUrl('root', secrets.mongoRootPassword, { database: '', authSource: 'admin' }))}\n`)
  }

  const identity = JSON.parse(readFileSync(join(HOME, 'identity.json'), 'utf8'))
  const say = line => process.stdout.write(`${line}\n`)
  say(`Slatebox ${identity.version ? `${identity.version} ` : ''}(app ${identity.app}, engine ${identity.engine}, relay ${identity.relay})`)
  say(`Address:   ${url.origin}`)
  say(`HTTPS:     ${builtInHttps ? `built in, certificates for ${url.hostname} (publish ports 80 and 443)` : tunnel ? 'at Cloudflare, through the secure tunnel' : url.protocol === 'https:' ? 'handled by your proxy' : 'off'}`)
  say(`Tunnel:    ${tunnel ? `on, Cloudflare Tunnel ${tunnel.tunnelId} for ${url.host} (outbound only; no ports to open)` : 'off'}`)
  say(`Database:  ${externalMongo ? 'external (MONGO_URL)' : `bundled MongoDB ${identity.mongodb}, stored in ${DB_DIR}`}`)
  say(`Secrets:   ${created === 'all' ? 'created for this new installation' : created ? `kept, ${created} new` : 'kept from earlier starts'} (${join(DATA, 'secrets')})`)
  say(`Mail:      ${mailUrl ? `on, from ${mailFrom}` : 'off (set SLATEBOX_MAIL_URL to send invitations and sign-in mail)'}`)
  say(`SSO:       ${sso.enabled ? `on, Keycloak ${identity.keycloak || ''} at ${url.origin}${SSO_PATH}/, issuer ${issuerFor(url)}${sso.only ? ', single sign-on only' : ''}${sso.defaultRole === 'none' ? ', new people join a team only by invitation' : ', new people join the first team as members'}${sso.domains.length ? `, email domains ${sso.domains.join(', ')}` : ''}${sso.adminOpen ? '' : ', admin console closed on this address'}`.replace('  ', ' ') : 'off (set SLATEBOX_SSO=keycloak to turn on single sign-on)'}`)
  say(`Updates:   ${{ auto: 'checked on GitHub every 6 hours; applied as Admin › Updates says', notify: 'checked on GitHub every 6 hours; never applied by themselves (SLATEBOX_UPDATES=notify)', off: 'off: no update check leaves this server (SLATEBOX_UPDATES=off)' }[updates.mode]}`)
  for (const line of ai.summary) say(line)
  const kekSource = {
    setting: 'the key from SLATEBOX_KEY_ENCRYPTION_KEY',
    kept: `this installation's own key, kept in ${join(DATA, 'secrets')}`,
    generated: `a key made for this installation, kept in ${join(DATA, 'secrets')} (backups do not hold it: keep it with them)`,
  }[kek.source]
  say(`Own keys:  on, AI and call keys saved here are encrypted with ${kekSource}`)
}

try { main() } catch (error) { fail(error) }
