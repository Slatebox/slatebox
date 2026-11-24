// Shared helpers for the integration tests. They run the real CLI against
// real Docker with a locally built image (SLATEBOX_IMAGE, as for the
// self-host tests), on ports 17000-17999, and remove every container, volume,
// network and image they create, and nothing else.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BASE_IMAGE = process.env.SLATEBOX_IMAGE
export const RUN_ID = `sbxi${process.pid}`
const BIN = fileURLToPath(new URL('../../bin/slatebox.mjs', import.meta.url))
export const SELF_HOST_LIB = fileURLToPath(new URL('../../../../self-host/rootfs/opt/slatebox/lib/', import.meta.url))

const created = { containers: new Set(), volumes: new Set(), images: new Set(), networks: new Set() }

export function docker(args, { input, timeout = 900_000 } = {}) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 })
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' }
}

export function ok(args, options) {
  const result = docker(args, options)
  if (result.code !== 0) throw new Error(`docker ${args.join(' ')} exited ${result.code}\n${result.stderr}`)
  return result.stdout.trim()
}

export const track = {
  container: name => created.containers.add(name),
  volume: name => created.volumes.add(name),
  image: name => created.images.add(name),
  network: name => created.networks.add(name),
}

export function cleanup() {
  for (const name of created.containers) docker(['rm', '-f', '-v', name])
  for (const name of created.volumes) docker(['volume', 'rm', '-f', name])
  for (const name of created.networks) docker(['network', 'rm', name])
  for (const name of created.images) docker(['image', 'rm', '-f', name])
}

export async function freePort() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const port = 17000 + Math.floor(Math.random() * 1000)
    const free = await new Promise(resolve => {
      const server = createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Error('no free port in 17000-17999')
}

export function home() {
  return mkdtempSync(join(tmpdir(), 'sbxi-home-'))
}

/** Run the real CLI as a person or an agent would. Returns { code, stdout, stderr, events }. */
export function slatebox(args, { env = {}, input = '', timeout = 1_200_000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('close', code => {
      clearTimeout(timer)
      const events = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line) } catch { return { unparsed: line } } })
      resolve({ code, stdout, stderr, events })
    })
    child.stdin.end(input)
  })
}

/**
 * Test images, built from SLATEBOX_IMAGE: "current" carries this checkout's
 * configure.mjs (so it matches the branch), "broken" never passes its health
 * check (for rollback).
 */
export function buildTestImages() {
  const dir = mkdtempSync(join(tmpdir(), 'sbxi-build-'))
  const current = `${RUN_ID}-image:current`
  const broken = `${RUN_ID}-image:broken`
  ok(['build', '-q', '-t', current, '--build-context', `lib=${SELF_HOST_LIB}`, '-f', '-', dir], {
    input: `FROM ${BASE_IMAGE}\nCOPY --from=lib --chown=root:root configure.mjs /opt/slatebox/lib/configure.mjs\nLABEL org.opencontainers.image.version=installer-test-current\n`,
  })
  track.image(current)
  writeFileSync(join(dir, 'health.mjs'), "process.stderr.write('The app is not ready (this image is broken on purpose).\\n'); process.exit(1)\n")
  ok(['build', '-q', '-t', broken, '-f', '-', dir], {
    input: `FROM ${current}\nUSER root\nCOPY health.mjs /opt/slatebox/lib/health.mjs\nUSER slatebox\nLABEL org.opencontainers.image.version=installer-test-broken\n`,
  })
  track.image(broken)
  return { current, broken, base: BASE_IMAGE }
}

/** An OpenAI-compatible stand-in on this computer that records what reaches it. */
export async function fakeAiEndpoint() {
  const { createServer: http } = await import('node:http')
  const seen = []
  const port = await freePort()
  const server = http((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, auth: request.headers.authorization || null, body })
      response.setHeader('content-type', 'application/json')
      if (request.url === '/v1/models') return response.end(JSON.stringify({ data: [{ id: 'fake-model' }] }))
      if (request.url === '/v1/chat/completions') {
        return response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name: 'ping', arguments: '{"ok":true}' } }] } }] }))
      }
      response.statusCode = 404
      response.end('{}')
    })
  })
  await new Promise(resolve => server.listen(port, '0.0.0.0', resolve))
  return { port, seen, close: () => new Promise(resolve => server.close(resolve)) }
}

export const available = () => Boolean(BASE_IMAGE) && docker(['image', 'inspect', BASE_IMAGE]).code === 0
