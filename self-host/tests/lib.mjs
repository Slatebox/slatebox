// Helpers shared by the image tests. Every container, volume and network a
// test creates carries the prefix below and is removed when the test ends.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'

export const IMAGE = process.env.SLATEBOX_IMAGE
if (!IMAGE) throw new Error('Set SLATEBOX_IMAGE to the image under test, for example the tag printed by build-image.sh')

export const PREFIX = `slatebox-one-${process.env.SLATEBOX_TEST_RUN || process.pid}`
const created = { containers: new Set(), volumes: new Set(), networks: new Set() }
let counter = 0

/** Run docker and return { code, stdout, stderr }. A non-zero exit is a result, not an exception. */
export async function docker(args, { input, encoding = 'utf8', timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = [], err = []
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.stdout.on('data', chunk => out.push(chunk))
    child.stderr.on('data', chunk => err.push(chunk))
    child.on('error', reject)
    child.on('close', code => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out)
      resolve({ code, stdout: encoding ? stdout.toString(encoding) : stdout, stderr: Buffer.concat(err).toString('utf8') })
    })
    child.stdin.end(input)
  })
}

/** Run docker and fail loudly unless it exits 0. */
export async function ok(args, options) {
  const result = await docker(args, options)
  if (result.code !== 0) throw new Error(`docker ${args.join(' ')} exited ${result.code}\n${result.stderr}`)
  return typeof result.stdout === 'string' ? result.stdout.trim() : result.stdout
}

export function name(kind) {
  counter += 1
  return `${PREFIX}-${kind}-${counter}`
}

export async function volume() {
  const id = name('data')
  await ok(['volume', 'create', id])
  created.volumes.add(id)
  return id
}

export async function network() {
  const id = name('net')
  await ok(['network', 'create', id])
  created.networks.add(id)
  return id
}

/** A free port in the range reserved for these tests. */
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
  throw new Error('No free port between 17000 and 17999')
}

/**
 * Start a Slatebox container the way the documentation does, on a test port.
 * Returns { id, port, url, data }.
 */
export async function start({ data, port, env = {}, args = [], image = IMAGE, publish, containerName } = {}) {
  data ||= await volume()
  port ||= await freePort()
  const id = containerName || name('box')
  const url = env.SLATEBOX_URL || `http://localhost:${port}`
  const envArgs = Object.entries({ SLATEBOX_URL: url, ...env })
    .filter(([, value]) => value !== undefined)
    .flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const ports = (publish || [`${port}:7070`]).flatMap(mapping => ['-p', mapping])
  created.containers.add(id)
  await ok(['run', '-d', '--name', id, ...ports, '-v', `${data}:/data`, ...envArgs, ...args, image])
  return { id, port, url, data }
}

/** Have cleanup() remove a container this test started by other means, before its networks. */
export function adopt(id) {
  created.containers.add(id)
  return id
}

export async function inspect(id, format) {
  return ok(['inspect', '--format', format, id])
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Wait for Docker's own verdict from the image's HEALTHCHECK. Returns seconds waited. */
export async function healthy(id, { timeout = 900 } = {}) {
  const started = Date.now()
  for (;;) {
    const state = await docker(['inspect', '--format', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}', id])
    const [status, health] = state.stdout.trim().split(' ')
    if (status === 'running' && health === 'healthy') return (Date.now() - started) / 1000
    if (status === 'exited' || status === 'dead' || state.code !== 0) {
      throw new Error(`${id} stopped while starting:\n${await logs(id)}`)
    }
    if (Date.now() - started > timeout * 1000) throw new Error(`${id} was not healthy after ${timeout}s:\n${await logs(id)}`)
    await sleep(1000)
  }
}

export async function waitFor(check, { timeout = 120, every = 500, what = 'condition' } = {}) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout * 1000) throw new Error(`Timed out after ${timeout}s waiting for ${what}`)
    await sleep(every)
  }
}

export async function logs(id) {
  const result = await docker(['logs', id])
  return result.stdout + result.stderr
}

export async function remove(id) {
  await docker(['rm', '-f', id])
  created.containers.delete(id)
}

export async function removeVolume(id) {
  await docker(['volume', 'rm', '-f', id])
  created.volumes.delete(id)
}

/** Remove everything these tests created, and nothing else. */
export async function cleanup() {
  for (const id of created.containers) await docker(['rm', '-f', '-v', id])
  for (const id of created.volumes) await docker(['volume', 'rm', '-f', id])
  for (const id of created.networks) await docker(['network', 'rm', id])
  created.containers.clear(); created.volumes.clear(); created.networks.clear()
}

/** The secrets of a running installation, read from its volume for comparison only. Never print them. */
export async function secrets(id) {
  return JSON.parse(await ok(['exec', id, 'cat', '/data/secrets/secrets.json']))
}

/**
 * Playwright comes from a checkout that already has it installed. Point
 * PLAYWRIGHT_FROM at a package.json whose dependencies include @playwright/test.
 */
export function playwright() {
  const from = process.env.PLAYWRIGHT_FROM
  if (!from) throw new Error('Set PLAYWRIGHT_FROM to a package.json that can resolve @playwright/test (for example the SlateboxJS checkout)')
  return createRequire(from)('@playwright/test')
}

// Names under slatebox-one.test stand for a public host name and resolve to this machine.
export async function browser(args = ['--host-resolver-rules=MAP *.slatebox-one.test 127.0.0.1']) {
  const { chromium } = playwright()
  return chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args })
}
