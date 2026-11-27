// Every file the app keeps (an upload, an image the server draws) goes through here. With an S3
// bucket in the settings (Slatebox Cloud) it is stored in the bucket and served from its address
// (aws.cloudUrl). Without one (a self-hosted instance) it is stored in the app's own database
// and served by the app at /files/, so a backup of the database carries it too.
import { Buffer } from 'buffer'
import { Meteor } from 'meteor/meteor'
import { MongoInternals } from 'meteor/mongo'
import { Random } from 'meteor/random'
import { dateFolder, uploadKey } from './upload-keys.mjs'
import { deleteS3Object, putS3Object, readS3Object } from './s3Utils'

const inBucket = () => Boolean(Meteor.settings.aws?.imageBucket)

// The address every stored file's URL starts with, without a trailing slash.
export const storedFileBase = () => (inBucket()
  ? String(Meteor.settings.aws.cloudUrl).replace(/\/+$/, '')
  : Meteor.absoluteUrl('files').replace(/\/+$/, ''))

// A key is a path of plain names ending in an extension: 2026/11/19/u_<user>_<id>.png.
const KEY = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]{2,4}$/
export const isStoredFileKey = (key) => typeof key === 'string' && key.length <= 300 && KEY.test(key)

// The key of a stored file's URL, or null when the URL is not one of this app's stored files.
export function storedFileKey(url) {
  const prefix = `${storedFileBase()}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) return null
  const key = url.slice(prefix.length)
  return isStoredFileKey(key) ? key : null
}

function databaseFiles() {
  const { db } = MongoInternals.defaultRemoteCollectionDriver().mongo
  return new MongoInternals.NpmModules.mongodb.module.GridFSBucket(db, { bucketName: 'files' })
}

async function databaseFileIds(key) {
  return (await databaseFiles().find({ filename: key }, { projection: { _id: 1 } }).toArray()).map((file) => file._id)
}

export async function storeFile({ body, key, contentType, contentDisposition }) {
  if (!isStoredFileKey(key)) throw new Error('A stored file needs a plain key.')
  if (inBucket()) {
    await putS3Object({ body, key, contentType, contentDisposition })
  } else {
    const files = databaseFiles()
    const older = await databaseFileIds(key)
    await new Promise((resolve, reject) => {
      const stream = files.openUploadStream(key, { metadata: { contentType, ...(contentDisposition ? { contentDisposition } : {}) } })
      stream.once('finish', resolve)
      stream.once('error', reject)
      stream.end(Buffer.from(body))
    })
    // A key stored again (a slate's preview image) replaces what was there.
    for (const id of older) await files.delete(id).catch(() => {})
  }
  return `${storedFileBase()}/${key}`
}

// A person's upload (the editor's image upload, a photo from the phone app): one name for both
// (upload-keys.mjs), so uploadKeyOf and images.removeImage know either as theirs.
export const newUploadKey = (userId, ext) => uploadKey(userId, Random.id(), ext)

// An image the server made for a slate: <date>/<name>_<time>.<ext>, or <date>/<name>.<ext>.
export function storeImage(imgBuffer, name, isSvg, ctype, fileExt, skipTimestamp = false) {
  const stamp = skipTimestamp ? '' : `_${Date.now()}`
  const file = isSvg ? `${name}${stamp}.svg` : `${name}${stamp}.${fileExt || 'png'}`
  return storeFile({
    body: imgBuffer,
    key: `${dateFolder()}/${file}`,
    contentType: ctype || (isSvg ? 'image/svg+xml' : 'image/png'),
  })
}

export async function deleteStoredFile(key) {
  if (!isStoredFileKey(key)) return
  if (inBucket()) {
    await deleteS3Object(key)
    return
  }
  const files = databaseFiles()
  for (const id of await databaseFileIds(key)) await files.delete(id).catch(() => {})
}

// A file kept in the database, by key: { bytes, contentType, contentDisposition }, or null.
export async function readDatabaseFile(key) {
  if (inBucket() || !isStoredFileKey(key)) return null
  const files = databaseFiles()
  const [file] = await files.find({ filename: key }).sort({ uploadDate: -1 }).limit(1).toArray()
  if (!file) return null
  const chunks = []
  for await (const chunk of files.openDownloadStream(file._id)) chunks.push(chunk)
  return { bytes: Buffer.concat(chunks), contentType: file.metadata?.contentType, contentDisposition: file.metadata?.contentDisposition }
}

// The server reads a file it stored in its database directly, never over the network (its own
// address may be a loopback one the outbound fetch refuses). Null when the URL is not such a
// file, so the caller fetches it as any public address.
export async function readStoredFile(url) {
  if (inBucket()) return null
  const key = storedFileKey(url)
  if (!key) return null
  const file = await readDatabaseFile(key)
  if (!file) throw new Error('That file is no longer stored.')
  return file
}

// A stored file's bytes by key, or null when it is not there. Larger than maxBytes answers with
// maxBytes + 1 bytes, so the caller refuses it by its size (as readS3Object does).
export async function readStoredObject(key, maxBytes) {
  if (!isStoredFileKey(key)) return null
  if (inBucket()) return readS3Object(key, maxBytes)
  const files = databaseFiles()
  const [file] = await files.find({ filename: key }).sort({ uploadDate: -1 }).limit(1).toArray()
  if (!file) return null
  if (Number(file.length) > maxBytes) return Buffer.alloc(maxBytes + 1)
  const chunks = []
  for await (const chunk of files.openDownloadStream(file._id)) chunks.push(chunk)
  return Buffer.concat(chunks)
}
