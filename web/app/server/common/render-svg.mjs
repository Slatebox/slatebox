import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setPriority } from 'node:os'
import { dirname, join } from 'node:path'

// Drawing an SVG has no cost bound: a few filter primitives (feGaussianBlur, feMorphology) over a
// large canvas keep librsvg busy for minutes, and sharp cannot stop a render it has started. So an
// SVG from a caller is drawn in a child process that is killed when its time is up. The child
// gets no environment (no settings, no keys), a small heap, a low priority, and one vips thread;
// at most two run at once and a few more wait, and anything beyond that is refused.
const MAX_RUNNING = 2
const MAX_WAITING = 8
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

const CHILD = `
const sharp = require('sharp')
sharp.cache(false)
sharp.concurrency(1)
const opts = JSON.parse(process.argv[1])
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', async () => {
  try {
    const input = sharp(Buffer.concat(chunks), { density: opts.density, limitInputPixels: opts.limitInputPixels })
    const meta = await input.metadata()
    if (meta.format !== 'svg') throw new Error('not an svg')
    let pipeline = input
    if (opts.resize) pipeline = pipeline.resize(opts.resize)
    const png = await pipeline.png({ compressionLevel: opts.compressionLevel }).toBuffer()
    const head = Buffer.from(JSON.stringify({ width: meta.width, height: meta.height }) + '\\n')
    process.stdout.write(Buffer.concat([head, png]), () => process.exit(0))
  } catch (error) {
    process.stderr.write(String((error && error.message) || error).slice(0, 500))
    process.exit(2)
  }
})
`

export class SvgRenderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SvgRenderError'
    this.code = code
  }
}

// The directory whose node_modules holds sharp: the Meteor server bundle's npm folder, or (outside
// Meteor, in the unit tests) the nearest one above this process's working directory.
function sharpHome() {
  const serverDir = globalThis.__meteor_bootstrap__?.serverDir
  const candidates = []
  if (serverDir) candidates.push(join(serverDir, 'npm'))
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    candidates.push(dir, join(dir, 'web', 'app'))
    if (dirname(dir) === dir) break
  }
  const home = candidates.find((dir) => existsSync(join(dir, 'node_modules', 'sharp', 'package.json')))
  if (!home) throw new SvgRenderError('unavailable', 'The image renderer is not installed.')
  return home
}

let running = 0
const waiting = []
function slot() {
  if (running < MAX_RUNNING) {
    running += 1
    return Promise.resolve()
  }
  if (waiting.length >= MAX_WAITING) return Promise.reject(new SvgRenderError('busy', 'Too many images are being drawn right now. Try again shortly.'))
  return new Promise((resolve) => waiting.push(resolve))
}
function release() {
  const next = waiting.shift()
  if (next) next()
  else running -= 1
}

function renderInChild(svg, opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=256', '-e', CHILD, JSON.stringify(opts)], {
      cwd: sharpHome(),
      env: { PATH: process.env.PATH || '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    try { setPriority(child.pid, 10) } catch { /* lowering the priority is best effort */ }
    const out = []
    let outBytes = 0
    let err = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill('SIGKILL')
        reject(error)
      } else resolve(value)
    }
    const timer = setTimeout(() => finish(new SvgRenderError('timeout', 'That image took too long to draw.')), timeoutMs)
    child.stdout.on('data', (chunk) => {
      outBytes += chunk.length
      if (outBytes > MAX_OUTPUT_BYTES) return finish(new SvgRenderError('too-large', 'That image is too large to draw.'))
      out.push(chunk)
    })
    child.stderr.on('data', (chunk) => { if (err.length < 1000) err += chunk })
    child.on('error', (error) => finish(new SvgRenderError('failed', error.message)))
    child.on('close', (code) => {
      if (code !== 0) return finish(new SvgRenderError('invalid', `That image could not be drawn${err ? `: ${err.trim()}` : '.'}`))
      const all = Buffer.concat(out)
      const newline = all.indexOf(10)
      if (newline < 0) return finish(new SvgRenderError('failed', 'The image renderer gave no answer.'))
      try {
        const meta = JSON.parse(all.subarray(0, newline).toString('utf8'))
        finish(null, { png: all.subarray(newline + 1), width: meta.width, height: meta.height })
      } catch (error) {
        finish(new SvgRenderError('failed', error.message))
      }
    })
    child.stdin.on('error', () => {}) // the child may be killed before it has read everything
    child.stdin.end(Buffer.isBuffer(svg) ? svg : Buffer.from(String(svg), 'utf8'))
  })
}

// A PNG of an SVG, with its drawn width and height. Refuses with an SvgRenderError whose code is
// 'too-large', 'busy', 'timeout' or 'invalid'.
export async function renderSvgToPng(svg, {
  density = 72,
  resize = null,
  compressionLevel = 6,
  timeoutMs = 10000,
  maxInputBytes = 5 * 1024 * 1024,
  limitInputPixels = 40e6,
} = {}) {
  const size = Buffer.isBuffer(svg) ? svg.length : Buffer.byteLength(String(svg))
  if (size > maxInputBytes) throw new SvgRenderError('too-large', 'That image is too large to draw.')
  await slot()
  try {
    return await renderInChild(svg, { density, resize, compressionLevel, limitInputPixels }, timeoutMs)
  } finally {
    release()
  }
}
