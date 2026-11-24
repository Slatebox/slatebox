// What the server fetches for a caller, and what it accepts as an upload.
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkUrl, isPublicAddress, publicLookup, safeFetch, FetchRefused } from '../web/app/server/common/safe-fetch.mjs'
import { pbkdf2 } from 'node:crypto'
import { classifyUpload, isRasterImage } from '../web/app/server/common/upload-kinds.mjs'
import { renderSvgToPng } from '../web/app/server/common/render-svg.mjs'

// The SVG the hostile test used: 30 rects, each with a huge blur and morphology, on 2000x2000.
export const filterBomb = () => {
  const rects = Array.from({ length: 30 }, (_, i) => `<rect x="${i * 10}" y="${i * 10}" width="1900" height="1900" fill="#${(i * 7919).toString(16).padStart(6, '0').slice(0, 6)}" filter="url(#f)"/>`).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><defs><filter id="f" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="300"/><feMorphology operator="dilate" radius="200"/></filter></defs>${rects}</svg>`)
}
const hashOnce = () => new Promise((resolve, reject) => {
  const start = Date.now()
  pbkdf2('password', 'salt', 1000, 32, 'sha256', (error) => (error ? reject(error) : resolve(Date.now() - start)))
})

test('private, loopback, link-local, metadata and other reserved addresses are not public', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe',
    '64:ff9b::a9fe:a9fe', '2002:7f00:1::', 'ff02::1', '2001:db8::1', 'not an address']) {
    assert.equal(isPublicAddress(address), false, address)
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(address), true, address)
  }
})

test('only https addresses on public hosts are fetched', () => {
  for (const url of ['http://example.com/a.png', 'file:///etc/passwd.png', 'ftp://example.com/x', 'https://localhost/x', 'https://127.0.0.1/x',
    'https://[::1]/x', 'https://169.254.169.254/latest/meta-data/', 'https://user:pass@example.com/', 'https://metadata.google.internal/', 'nonsense']) { // trufflehog:ignore (fake URL fixtures)
    assert.throws(() => checkUrl(url), FetchRefused, url)
  }
  assert.equal(checkUrl('https://cdn.pixabay.com/photo/a.jpg').hostname, 'cdn.pixabay.com')
})

test('a public-looking name that resolves to a private address is refused before connecting', async () => {
  const resolver = (address) => (host, opts, cb) => cb(null, [{ address, family: 4 }])
  for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254']) {
    await assert.rejects(safeFetch('https://rebinding.example/x.png', { lookup: publicLookup(resolver(address)), timeoutMs: 2000 }), FetchRefused, address)
  }
  // Every address the name resolves to must be public, not just the first.
  const mixed = (host, opts, cb) => cb(null, [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }])
  await new Promise((resolve) => publicLookup(mixed)('x', { all: true }, (error) => { assert.ok(error instanceof FetchRefused); resolve() }))
})

test('the server fetch follows a redirect only through the same checks', async () => {
  const source = (await import('node:fs')).readFileSync(new URL('../web/app/server/common/safe-fetch.mjs', import.meta.url), 'utf8')
  assert.match(source, /url = checkUrl\(result\.redirect, allowHosts\)/)
  assert.match(source, /MAX_REDIRECTS = 3/)
})

test('uploads are told by their bytes: images, PDF and text pass, HTML and scripts do not, SVG becomes PNG', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  assert.deepEqual((await classifyUpload(png, 'x.html')).type, 'image/png')
  assert.equal((await classifyUpload(Buffer.from('%PDF-1.4 ...'), 'a.pdf')).ext, 'pdf')
  assert.equal((await classifyUpload(Buffer.from('plain notes'), 'notes.txt')).ext, 'txt')
  assert.equal(await classifyUpload(Buffer.from('<html><script>alert(1)</script></html>'), 'a.txt'), null)
  assert.equal(await classifyUpload(Buffer.from('<html></html>'), 'a.html'), null)
  assert.equal(await classifyUpload(Buffer.from('plain'), 'a.exe'), null)
  const svg = await classifyUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>'), 'logo.svg')
  assert.equal(svg.type, 'image/png')
  assert.ok(svg.body.subarray(0, 4).equals(png.subarray(0, 4)))
})

test('a slow SVG is drawn in a killable child: it times out, and this process stays free meanwhile', async () => {
  const started = Date.now()
  const renders = Array.from({ length: 6 }, () => classifyUpload(filterBomb(), 'logo.svg').then(() => 'drawn', (error) => error.code))
  // While six uploads are in flight, the thread pool (password hashing) and event loop still answer.
  for (let i = 0; i < 3; i++) assert.ok(await hashOnce() < 1000, 'password hashing waited on SVG drawing')
  const outcomes = await Promise.all(renders)
  assert.ok(outcomes.every((o) => o === 'timeout' || o === 'busy'), JSON.stringify(outcomes))
  assert.ok(Date.now() - started < 30000, 'took ' + (Date.now() - started) + ' ms')
  // The renderer is free again afterwards.
  const small = await renderSvgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>')
  assert.equal(small.width, 8)
})

test('the renderer refuses an oversized SVG, a non-SVG and a flood beyond its queue', async () => {
  await assert.rejects(renderSvgToPng(Buffer.alloc(6 * 1024 * 1024, 32)), { code: 'too-large' })
  await assert.rejects(renderSvgToPng(Buffer.from('not an image at all')), { code: 'invalid' })
  const flood = await Promise.all(Array.from({ length: 14 }, () => renderSvgToPng(filterBomb(), { timeoutMs: 1500 }).then(() => 'drawn', (e) => e.code)))
  assert.ok(flood.filter((o) => o === 'busy').length >= 4, JSON.stringify(flood))
})

test('bytes a caller supplies reach sharp only as a raster image', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
  assert.equal(isRasterImage(png), true)
  assert.equal(isRasterImage(filterBomb()), false)
  assert.equal(isRasterImage(Buffer.from('%PDF-1.4 ...........')), false)
  assert.equal(isRasterImage('not a buffer'), false)
})
