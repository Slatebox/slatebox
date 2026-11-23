import { Buffer } from 'buffer'
import multer from 'multer'
import { classifyUpload } from './common/upload-kinds.mjs'
import { SvgRenderError } from './common/render-svg.mjs'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Accounts } from 'meteor/accounts-base'
import { CachedImages } from '../imports/api/common/models'
import { uploadS3Object } from './common/s3Utils'
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

const uploadsRemembered = /^u_([A-Za-z0-9]{17})_[A-Za-z0-9]{17}\.(png|jpg|gif|webp|pdf|txt)$/
// The bucket key of an upload, when the url is one this app stored for that person.
export function uploadKeyOf(url, userId) {
  const prefix = `${Meteor.settings.aws?.cloudUrl}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  const m = /^\d{4}\/\d{2}\/\d{2}\/([^/]+)$/.exec(key)
  const name = m && uploadsRemembered.exec(m[1])
  return name && name[1] === userId ? key : null
}

const dateFolder = () => {
  const now = new Date()
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
}

app.post('/sbupload/image', async (req, res) => {
  try {
    const user = await signedInUser(req)
    if (!user) return res.status(401).type('text/plain').send('Sign in to upload.')
    await new Promise((resolve, reject) => upload(req, res, (error) => (error ? reject(error) : resolve())))
    if (!req.file?.buffer?.length) return res.status(400).type('text/plain').send('No file was sent.')
    const kind = await classifyUpload(req.file.buffer, req.file.originalname)
    if (!kind) return res.status(415).type('text/plain').send('Upload a PNG, JPG, GIF, WEBP, SVG, PDF or text file.')
    const key = `${dateFolder()}/u_${user._id}_${Random.id()}.${kind.ext}`
    const url = await uploadS3Object({ body: kind.body, key, contentType: kind.type })
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

// An async handler that throws must never take the process down with it.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason?.stack || reason)
})
