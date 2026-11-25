// Is this Slatebox usable right now? Everything is asked the way a browser
// asks: through the front proxy on the one published port.
//
//   health.mjs            the app answers with its database, and the relay answers
//   health.mjs --deep     also opens a signed live-editing connection
//   health.mjs --wait N   keep trying for N seconds before giving up
//   health.mjs --json     also print {ok, tunnel} as one JSON line
//   health.mjs --tunnel   only the team-address tunnel: {configured, ready, connections, state}
//
// With a tunnel (SLATEBOX_TUNNEL_TOKEN), the plain check (Docker's HEALTHCHECK) also fails when
// the tunnel has had no connection for more than two minutes. A tunnel that Cloudflare refused
// (a revoked token, a suspended address) is "degraded" and does not fail the check: the
// container keeps serving this computer instead of being restarted over and over.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  FRONT_PORT, RELAY_PATH, RUN, SSO_PATH, SSO_REALM, TUNNEL_FAILED, TUNNEL_METRICS, TUNNEL_STARTED, fail, Plain, readSecrets,
  relaySignature, sleep,
} from './common.mjs'

const TUNNEL_GRACE_SECONDS = 120

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

const stateFile = () => (existsSync(join(RUN, 'state.env')) ? readFileSync(join(RUN, 'state.env'), 'utf8') : '')

/** The tunnel as cloudflared reports it on loopback. Never throws. */
export async function tunnelStatus() {
  if (!/^SLATEBOX_TUNNEL='1'$/m.test(stateFile())) return { configured: false, ready: false, connections: 0, state: 'off' }
  if (existsSync(TUNNEL_FAILED)) return { configured: true, ready: false, connections: 0, state: 'failed', error: 'Cloudflare refused the tunnel connection (a revoked token or a suspended address)' }
  const since = existsSync(TUNNEL_STARTED) ? Math.round((Date.now() - statSync(TUNNEL_STARTED).mtimeMs) / 1000) : null
  try {
    const response = await fetch(`http://${TUNNEL_METRICS}/ready`, { signal: AbortSignal.timeout(3000) })
    const body = await response.json().catch(() => ({}))
    const connections = Number(body.readyConnections) || 0
    return { configured: true, ready: response.status === 200 && connections > 0, connections, state: response.status === 200 ? 'connected' : 'connecting', since }
  } catch {
    return { configured: true, ready: false, connections: 0, state: 'starting', since }
  }
}

async function check(deep) {
  if (existsSync(join(RUN, 'paused'))) throw new Plain('Slatebox is paused while a backup is restored.')
  await appReady()
  await relayReady()
  await ssoReady()
  if (deep) await liveEditingReady()
}

async function tunnelOnly(json, deadline) {
  let status = await tunnelStatus()
  while (status.configured && !status.ready && status.state !== 'failed' && Date.now() < deadline) {
    await sleep(1000)
    status = await tunnelStatus()
  }
  if (json) process.stdout.write(`${JSON.stringify(status)}\n`)
  else process.stdout.write(`${!status.configured ? 'No tunnel: this Slatebox has no SLATEBOX_TUNNEL_TOKEN.' : status.ready ? `Tunnel connected (${status.connections} connection${status.connections === 1 ? '' : 's'}).` : status.state === 'failed' ? `Tunnel stopped: ${status.error}.` : `Tunnel ${status.state}.`}\n`)
  process.exit(status.ready ? 0 : 1)
}

async function main() {
  const args = process.argv.slice(2)
  const deep = args.includes('--deep')
  const json = args.includes('--json')
  const waitIndex = args.indexOf('--wait')
  const deadline = Date.now() + (waitIndex >= 0 ? Number(args[waitIndex + 1]) * 1000 : 0)
  if (args.includes('--tunnel')) return tunnelOnly(json, deadline)
  for (;;) {
    try {
      await check(deep)
      // Docker's check (no --deep): a tunnel that should be up and has not connected for two minutes is unhealthy.
      const tunnel = await tunnelStatus()
      if (json) process.stdout.write(`${JSON.stringify({ ok: true, tunnel })}\n`)
      if (tunnel.state === 'failed') process.stderr.write('degraded: the team address tunnel was refused; Slatebox still serves this computer.\n')
      else if (!deep && tunnel.configured && !tunnel.ready && (tunnel.since ?? 0) > TUNNEL_GRACE_SECONDS) {
        throw new Plain(`The secure tunnel has had no connection for ${tunnel.since} seconds (see the [tunnel] lines in docker logs).`)
      }
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
