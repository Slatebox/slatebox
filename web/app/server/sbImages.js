import { Buffer } from 'buffer'
import multer from 'multer'
import { classifyUpload } from './common/upload-kinds.mjs'
import { SvgRenderError } from './common/render-svg.mjs'
import { Meteor } from 'meteor/meteor'
import { Accounts } from 'meteor/accounts-base'
import { CachedImages } from '../imports/api/common/models'
import { newUploadKey, readDatabaseFile, storeFile, storedFileKey } from './common/fileStore'
import { uploadKeyFor } from './common/upload-keys.mjs'
import app from './expressApp'

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

// The browser sends its Meteor login token in a header (never a cookie, so another site cannot
// make the browser upload).
async function signedInUser(req) {
  const token = req.get('x-slatebox-login-token')
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null
  return Meteor.users.findOneAsync(
    { 'services.resume.loginTokens.hashedToken': Accounts._hashLoginToken(token) },
    { fields: { _id: 1 } }
  )
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 } }).single('file')

// The stored key of an upload, when the url is one this app stored for that person.
export const uploadKeyOf = (url, userId) => uploadKeyFor(storedFileKey(url), userId)

app.post('/sbupload/image', async (req, res) => {
  try {
    const user = await signedInUser(req)
    if (!user) return res.status(401).type('text/plain').send('Sign in to upload.')
    await new Promise((resolve, reject) => upload(req, res, (error) => (error ? reject(error) : resolve())))
    if (!req.file?.buffer?.length) return res.status(400).type('text/plain').send('No file was sent.')
    const kind = await classifyUpload(req.file.buffer, req.file.originalname)
    if (!kind) return res.status(415).type('text/plain').send('Upload a PNG, JPG, GIF, WEBP, SVG, PDF or text file.')
    const key = newUploadKey(user._id, kind.ext)
    const url = await storeFile({ body: kind.body, key, contentType: kind.type })
    return res.status(200).type('text/plain').send(url)
  } catch (error) {
    if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).type('text/plain').send('The file is larger than 20 MB.')
    if (error?.code?.startsWith?.('LIMIT_')) return res.status(400).type('text/plain').send('Send one file.')
    // An SVG that is too large, too slow or unreadable to draw (server/common/render-svg.mjs).
    if (error instanceof SvgRenderError) {
      if (error.code === 'busy') return res.status(503).type('text/plain').send(error.message)
      if (error.code === 'too-large') return res.status(413).type('text/plain').send(error.message)
      return res.status(415).type('text/plain').send(error.message)
    }
    console.error('Upload failed', error?.message)
    return res.status(500).type('text/plain').send('The upload failed.')
  }
})

const servedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
app.get('/sbimages/:url', async (req, res) => {
  try {
    const image = await CachedImages.findOneAsync({ url: req.params.url }, { fields: { url: 1, bytes: 1, contentType: 1 } })
    const bytes = image?.bytes && Buffer.from(image.bytes.buffer ?? image.bytes)
    if (!bytes?.length) return res.status(404).end()
    let mime = image.contentType
    if (!servedTypes.includes(mime)) {
      mime = image.url.endsWith('.gif') ? 'image/gif' : image.url.endsWith('.png') ? 'image/png' : 'image/jpeg'
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': bytes.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=86400',
    })
    return res.end(bytes)
  } catch (error) {
    console.error('Cached image failed', error?.message)
    return res.status(500).end()
  }
})

// A file stored in the database (a self-hosted instance; Slatebox Cloud serves them from the
// bucket). It is never shown as a page of this site: no script runs, nothing is sniffed.
export const STORED_FILE_ROUTE = /^\/files\/(.+)$/
const storedTypes = {
  'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/gif': 'image/gif', 'image/webp': 'image/webp',
  'application/pdf': 'application/pdf', 'text/plain': 'text/plain; charset=utf-8',
}
app.get(STORED_FILE_ROUTE, async (req, res) => {
  try {
    const file = await readDatabaseFile(req.params[0])
    if (!file) return res.status(404).type('text/plain').send('Not found.')
    const type = storedTypes[String(file.contentType).split(';')[0].trim()]
    res.writeHead(200, {
      'Content-Type': type || 'application/octet-stream',
      'Content-Length': file.bytes.length,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=3600',
      ...(type && file.contentDisposition !== 'attachment' ? {} : { 'Content-Disposition': 'attachment' }),
    })
    return res.end(file.bytes)
  } catch (error) {
    console.error('Stored file failed', error?.message)
    return res.status(500).end()
  }
})

// An async handler that throws must never take the process down with it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason?.stack || reason)
})
