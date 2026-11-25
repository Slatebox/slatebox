// Paths and helpers shared by the start-up, health, backup and restore steps.
import { createHmac, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

export const DATA = '/data'
export const RUN = '/run/slatebox'
export const HOME = '/opt/slatebox'
export const SECRETS_DIR = join(DATA, 'secrets')
export const SECRETS_FILE = join(SECRETS_DIR, 'secrets.json')
export const MONGO_KEY_FILE = join(SECRETS_DIR, 'mongo.key')
// The key-encryption key made on first boot when SLATEBOX_KEY_ENCRYPTION_KEY is not set.
export const KEY_ENCRYPTION_KEY_FILE = join(SECRETS_DIR, 'key-encryption.key')
export const DB_DIR = join(DATA, 'db')
export const TMP_DIR = join(DATA, 'tmp')

// Ports inside the container. Only FRONT_PORT is meant to be published;
// the others listen on loopback.
export const FRONT_PORT = 7070
export const APP_PORT = 3000
export const RELAY_PORT = 7072
export const MONGO_PORT = 27017
export const RELAY_PATH = '/live'
// Single sign-on (SLATEBOX_SSO=keycloak): Keycloak on loopback, served under SSO_PATH.
export const KEYCLOAK_PORT = 7080
export const KEYCLOAK_MANAGEMENT_PORT = 7083
export const SSO_PATH = '/auth'
export const SSO_REALM = 'slatebox'
export const SSO_CLIENT = 'slatebox'
export const SCIM_CLIENT = 'scim'
export const SSO_INIT_CLIENT = 'slatebox-init'
export const KEYCLOAK_HOME = '/opt/keycloak'
export const KEYCLOAK_DATA = join(DATA, 'keycloak')
export const DATABASE = 'slatebox'
export const REPLICA_SET = 'rs0'

/** A message for the operator; the caller exits non-zero without a stack trace. */
export class Plain extends Error {}

export function fail(error) {
  const text = error instanceof Plain ? error.message : (error?.stack || String(error))
  process.stderr.write(`${text}\n`)
  process.exit(1)
}

/** Write a file that only the Slatebox account can read, replacing it atomically. */
export function writePrivate(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const next = `${path}.${process.pid}.next`
  writeFileSync(next, content, { mode: 0o600 })
  chmodSync(next, mode)
  renameSync(next, path)
}

const SECRET_NAMES = [
  'mongoKey', 'mongoRootPassword', 'mongoAppPassword', 'mongoRelayPassword',
  'apiPublicKey', 'apiSecretKey', 'apiGenKey',
]
// Made the first time single sign-on is turned on, and kept after that.
export const SSO_SECRET_NAMES = [
  'keycloakAdminPassword', 'keycloakInitSecret', 'keycloakDbPassword', 'ssoClientSecret', 'ssoStateKey', 'scimClientSecret',
]

export function readSecrets() {
  if (!existsSync(SECRETS_FILE)) return null
  return JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
}

/** Load this installation's secrets, creating any that do not exist yet. */
export function ensureSecrets({ sso = false } = {}) {
  const existing = readSecrets()
  if (!existing && existsSync(join(DB_DIR, 'WiredTiger'))) {
    throw new Plain(
      `${DATA} holds a database but ${SECRETS_FILE} is missing, so the database cannot be opened.\n` +
      'Start the container with the complete data volume, or with a new, empty volume.')
  }
  const secrets = { ...existing }
  let created = 0
  for (const name of [...SECRET_NAMES, ...(sso ? SSO_SECRET_NAMES : [])]) {
    if (typeof secrets[name] === 'string' && secrets[name]) continue
    // apiGenKey is an AES-256 key the relay reads as base64; the rest are hex.
    secrets[name] = randomBytes(32).toString(name === 'apiGenKey' ? 'base64' : 'hex')
    created += 1
  }
  if (created) writePrivate(SECRETS_FILE, JSON.stringify(secrets, null, 2) + '\n')
  return { secrets, created: !existing && created ? 'all' : created }
}

/** 32 bytes in base64 (standard or URL-safe), as the app's key vault reads it. */
export const isKeyEncryptionKey = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32

/**
 * The master key for every AI and call key saved on this server (the administrator's keys in
 * Admin → AI control, and people's own). SLATEBOX_KEY_ENCRYPTION_KEY wins when it is set (given,
 * already checked) and nothing is written. Without it, the key made on this installation's first
 * boot is read from the data volume; only when there is none is a new one made and kept there.
 * A kept key is never replaced: one that cannot be read stops the start instead, since a new key
 * would leave every saved key unreadable. Never prints the key.
 * → { value, source: 'setting' | 'kept' | 'generated' }
 */
export function ensureKeyEncryptionKey({ given, file = KEY_ENCRYPTION_KEY_FILE } = {}) {
  if (given) return { value: given, source: 'setting' }
  if (existsSync(file)) {
    const value = readFileSync(file, 'utf8').trim()
    if (!isKeyEncryptionKey(value)) {
      throw new Plain(
        `${file} does not hold a key-encryption key (32 bytes in base64), so the keys saved on this server cannot be read. ` +
        'Put the file back from the data volume it came from, or set SLATEBOX_KEY_ENCRYPTION_KEY to the key it held. Nothing was changed.')
    }
    return { value, source: 'kept' }
  }
  const value = randomBytes(32).toString('base64')
  writePrivate(file, `${value}\n`)
  return { value, source: 'generated' }
}

export function mongoUrl(user, password, { database = DATABASE, authSource } = {}) {
  const query = new URLSearchParams({ replicaSet: REPLICA_SET })
  if (authSource) query.set('authSource', authSource)
  return `mongodb://${user}:${password}@127.0.0.1:${MONGO_PORT}/${database}?${query}`
}

/** The MongoDB driver that ships with the relay; nothing else is installed for it. */
export function mongodb() {
  return createRequire(join(HOME, 'relay/package.json'))('mongodb')
}

/** The same signature the app hands a browser for the collaboration relay. */
export function relaySignature(publicKey, secretKey) {
  const timestamp = new Date().toISOString()
  const hash = createHmac('sha256', secretKey).update(`${publicKey}:${timestamp}`).digest('base64')
  return { bearer: Buffer.from(`${publicKey}:${hash}`).toString('base64'), timestamp }
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

export function envFile(values) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join('\n') + '\n'
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
