// Is this Slatebox usable right now? Everything is asked the way a browser
// asks: through the front proxy on the one published port.
//
//   health.mjs            the app answers with its database, and the relay answers
//   health.mjs --deep     also opens a signed live-editing connection
//   health.mjs --wait N   keep trying for N seconds before giving up
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FRONT_PORT, RELAY_PATH, RUN, SSO_PATH, SSO_REALM, fail, Plain, readSecrets, relaySignature, sleep } from './common.mjs'

const front = `127.0.0.1:${FRONT_PORT}`

async function appReady() {
  const response = await fetch(`http://${front}/readyz`, { signal: AbortSignal.timeout(5000) })
  const body = response.ok ? await response.json().catch(() => null) : null
  if (!body?.ok) throw new Plain(`The app is not ready (HTTP ${response.status} from /readyz).`)
}

async function relayReady() {
  const response = await fetch(`http://${front}${RELAY_PATH}/`, { signal: AbortSignal.timeout(5000) })
  const body = await response.text()
  if (!response.ok || !body.includes('Websocket')) throw new Plain(`The collaboration relay is not answering (HTTP ${response.status}).`)
}

// A browser opens a slate's live connection with a signature from the app.
// Do the same and expect the relay's first sync message back.
async function liveEditingReady() {
  const { apiPublicKey, apiSecretKey } = readSecrets()
  const query = new URLSearchParams(relaySignature(apiPublicKey, apiSecretKey))
  const socket = new WebSocket(`ws://${front}${RELAY_PATH}/slatebox-health?${query}`)
  socket.binaryType = 'arraybuffer'
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Plain('The live-editing connection did not answer in time.')), 8000)
      socket.onmessage = event => {
        clearTimeout(timer)
        if (typeof event.data === 'string') reject(new Plain(`The relay refused the app's signature (${event.data}).`))
        else resolve()
      }
      socket.onerror = () => { clearTimeout(timer); reject(new Plain('The live-editing connection could not be opened.')) }
    })
  } finally {
    socket.close()
  }
}

// With single sign-on on, Keycloak must answer for the realm through the same port.
async function ssoReady() {
  const state = existsSync(join(RUN, 'state.env')) ? readFileSync(join(RUN, 'state.env'), 'utf8') : ''
  if (!/^SLATEBOX_SSO='keycloak'$/m.test(state)) return
  const response = await fetch(`http://${front}${SSO_PATH}/realms/${SSO_REALM}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) })
  const body = response.ok ? await response.json().catch(() => null) : null
  if (!body?.issuer) throw new Plain(`Single sign-on (Keycloak) is not ready (HTTP ${response.status}).`)
  if (!existsSync(join(RUN, 'sso-ready'))) throw new Plain('Single sign-on (Keycloak) is still being set up.')
}

async function check(deep) {
  if (existsSync(join(RUN, 'paused'))) throw new Plain('Slatebox is paused while a backup is restored.')
  await appReady()
  await relayReady()
  await ssoReady()
  if (deep) await liveEditingReady()
}

async function main() {
  const args = process.argv.slice(2)
  const deep = args.includes('--deep')
  const waitIndex = args.indexOf('--wait')
  const deadline = Date.now() + (waitIndex >= 0 ? Number(args[waitIndex + 1]) * 1000 : 0)
  for (;;) {
    try {
      await check(deep)
      return
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error instanceof Plain ? error : new Plain(`Slatebox is not answering on port ${FRONT_PORT} (${error.cause?.code || error.message}).`)
      }
      await sleep(1000)
    }
  }
}

main().then(() => process.exit(0), fail)
