// The self-hosted relay checks the room tokens the self-hosted app mints (v2, scripts/relay-token.test.mjs)
// with no new secret: the relay derives the token key from the API secret it already has in API_KEYS,
// and the app derives it from settings.slateboxAPI.secretKey. Both must be the one generated secret,
// in the one-container image (configure.mjs) and in the compose kit (init.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mintRoomToken, verifyRoomToken } from '../../web/app/server/common/relay-token.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

test('the image gives the app and the relay the same API key pair', () => {
  const configure = read('self-host/rootfs/opt/slatebox/lib/configure.mjs')
  assert.match(configure, /slateboxAPI: \{ publicKey: secrets\.apiPublicKey, secretKey: secrets\.apiSecretKey \}/)
  assert.match(configure, /API_KEYS: JSON\.stringify\(\[\{ name: 'slatebox', publicKey: secrets\.apiPublicKey, secretKey: secrets\.apiSecretKey \}\]\)/)
})

test('the compose kit gives the app and the relay the same API key pair', () => {
  const init = read('self-host/init.mjs')
  assert.match(init, /slateboxAPI: \{ publicKey, secretKey \}/)
  assert.match(init, /API_KEYS: JSON\.stringify\(\[\{ name: 'slatebox', publicKey, secretKey \}\]\)/)
})

test('a token the app mints with settings.slateboxAPI verifies against the relay\'s API_KEYS', () => {
  const secrets = { apiPublicKey: 'a'.repeat(32), apiSecretKey: 'b'.repeat(64) }
  const appSettings = { slateboxAPI: { publicKey: secrets.apiPublicKey, secretKey: secrets.apiSecretKey } }
  const API_KEYS = JSON.stringify([{ name: 'slatebox', publicKey: secrets.apiPublicKey, secretKey: secrets.apiSecretKey }])
  // The relay looks the secret up by the token's pk (src/auth, API_KEYS for the slatebox org).
  const secretFor = (pk) => JSON.parse(API_KEYS).find((row) => row.publicKey === pk)?.secretKey ?? null
  const { token } = mintRoomToken({ ...appSettings.slateboxAPI, room: 'slate-1', role: 'write' })
  assert.equal(verifyRoomToken(token, { room: 'slate-1', secretFor })?.role, 'write')
  assert.equal(verifyRoomToken(token, { room: 'slate-2', secretFor }), null)
})

test('a self-hosted install turns the room-less legacy relay credential off, in the app and the relay', () => {
  const configure = read('self-host/rootfs/opt/slatebox/lib/configure.mjs')
  assert.match(configure, /relay: \{ legacy: false \}/)
  assert.match(configure, /RELAY_ALLOW_LEGACY: 'false'/)
  assert.match(read('self-host/init.mjs'), /relay: \{ legacy: false \}/)
  assert.match(read('self-host/compose.yaml'), /RELAY_ALLOW_LEGACY: "false"/)
})

test('the health check opens the live connection with a room token, not the legacy signature', async () => {
  const health = read('self-host/rootfs/opt/slatebox/lib/health.mjs')
  assert.match(health, /relayRoomToken\(apiPublicKey, apiSecretKey, 'slatebox-health'\)/)
  assert.doesNotMatch(health, /relaySignature/)
  assert.match(health, /socket\.onclose/)
  const { relayRoomToken } = await import('../rootfs/opt/slatebox/lib/common.mjs')
  const secrets = { apiPublicKey: 'c'.repeat(32), apiSecretKey: 'd'.repeat(64) }
  const secretFor = (pk) => (pk === secrets.apiPublicKey ? secrets.apiSecretKey : null)
  const { token } = relayRoomToken(secrets.apiPublicKey, secrets.apiSecretKey, 'slatebox-health')
  const claims = verifyRoomToken(token, { room: 'slatebox-health', secretFor })
  assert.equal(claims?.role, 'read')
  assert.ok(claims.exp - Math.floor(Date.now() / 1000) <= 60, 'a short-lived token')
  assert.equal(verifyRoomToken(token, { room: 'some-slate', secretFor }), null, 'bound to the health room')
})
