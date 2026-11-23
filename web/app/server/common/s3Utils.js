/* eslint-disable new-cap */
/* eslint-disable no-nested-ternary */
import { Buffer } from 'buffer'
import { Meteor } from 'meteor/meteor'
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

function createS3() {
  return new S3Client({
    region: Meteor.settings.aws.region || 'us-east-1',
    credentials: {
      accessKeyId: Meteor.settings.aws.accessKey,
      secretAccessKey: Meteor.settings.aws.secretKey,
    },
  })
}

async function sendS3(command) {
  const client = createS3()
  try {
    return await client.send(command)
  } finally {
    client.destroy()
  }
}

async function deletePriorObjects(bucket, prefix) {
  const listParams = {
    Bucket: bucket,
    Prefix: prefix, // slatebox-images 2025/04/14/sb_square_120.png
  }

  const listedObjects = await sendS3(new ListObjectsV2Command(listParams))

  if (!listedObjects.Contents?.length) return

  const deleteParams = {
    Bucket: bucket,
    Delete: { Objects: [] },
  }

  listedObjects.Contents.forEach(({ Key }) => {
    deleteParams.Delete.Objects.push({ Key })
  })

  // console.log('deleting prior objects', { deleteParams, listedObjects })
  await sendS3(new DeleteObjectsCommand(deleteParams))

  if (listedObjects.IsTruncated) await deletePriorObjects(bucket, prefix)
}

// Function to get the date prefix in YYYY/MM/DD format
function getDatePrefix() {
  const now = new Date()
  const year = now.getFullYear()
  const month = (now.getMonth() + 1).toString().padStart(2, '0') // Months are 0-indexed
  const day = now.getDate().toString().padStart(2, '0')
  return `${year}/${month}/${day}`
}

async function deletePriorObjectsWithDateCleanup(bucket, slateId) {
  const currentDatePrefix = getDatePrefix()

  // 1. Delete objects from the current date's folder
  const datePrefixedSlateId = `${currentDatePrefix}/${slateId}`
  await deletePriorObjects(bucket, datePrefixedSlateId) // Reuse the core delete logic

  // 2. Clean up legacy objects at the root level for this slateId
  const listParamsLegacy = {
    Bucket: bucket,
    Prefix: slateId, // List objects starting with slateId
  }

  try {
    const listedLegacyObjects = await sendS3(
      new ListObjectsV2Command(listParamsLegacy)
    )

    console.log('listedLegacyObjects', listedLegacyObjects)

    if (listedLegacyObjects.Contents?.length > 0) {
      const legacyObjectsToDelete = {
        Bucket: bucket,
        Delete: { Objects: [] },
      }

      const datePattern = /^\d{4}\/\d{2}\/\d{2}\// // Regex to check for YYYY/MM/DD/ prefix

      listedLegacyObjects.Contents.forEach(({ Key }) => {
        // Only delete if the key starts directly with slateId (or slateId + _) and NOT the date pattern
        if (
          Key.startsWith(slateId) &&
          !datePattern.test(Key) &&
          !Key.startsWith(currentDatePrefix) // Avoid double-listing if slateId happens to match date pattern start
        ) {
          console.log('Adding legacy object for deletion:', Key)
          legacyObjectsToDelete.Delete.Objects.push({ Key })
        }
      })

      if (legacyObjectsToDelete.Delete.Objects.length > 0) {
        console.log(
          `Deleting ${legacyObjectsToDelete.Delete.Objects.length} legacy objects for prefix:`,
          slateId
        )
        await sendS3(new DeleteObjectsCommand(legacyObjectsToDelete))
        // Note: We are not handling IsTruncated for legacy cleanup for simplicity,
        // assuming large numbers of legacy files for a single slateId is rare.
      }
    }
  } catch (error) {
    console.error('Error during legacy object cleanup:', error)
    // Decide if this error should halt the process or just be logged
  }
}

async function uploadS3Object({ body, key, contentType, contentDisposition }) {
  const bucket = Meteor.settings.aws.imageBucket

  console.log('uploading s3', {
    bucket,
    key,
    contentType,
    bodyLength: body.length,
  })

  await sendS3(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
      ...(contentDisposition && { ContentDisposition: contentDisposition }),
      Body: body,
    })
  )

  const finalUrl = `${Meteor.settings.aws.cloudUrl}/${key}`
  console.log('uploading s3 success', key, finalUrl)
  return finalUrl
}

async function uploadImage(
  imgBuffer,
  slateId,
  isSvg,
  isTemplate,
  ctype,
  fileExt,
  skipTimestamp = false
) {
  // Deletion is now handled externally before calling uploadImage
  // await deletePriorObjects(Meteor.settings.aws.imageBucket, slateId) // REMOVED

  const fileId = skipTimestamp ? '' : `_${new Date().valueOf()}`
  const baseFileName = isSvg
    ? `${slateId}${fileId}.svg`
    : `${slateId}${fileId}.${fileExt || 'png'}`
  const fullKey = `${getDatePrefix()}/${baseFileName}`

  return uploadS3Object({
    body: imgBuffer,
    key: fullKey,
    contentType: ctype || (isSvg ? 'image/svg+xml' : 'image/png'),
  })
}

// Export the new deletion function alongside the upload function
// The original deletePriorObjects is kept as a helper for the new one, but not exported directly.
export { deletePriorObjectsWithDateCleanup, uploadImage, uploadS3Object }

export async function deleteImageByKey(key) {
  await sendS3(new DeleteObjectCommand({ Bucket: Meteor.settings.aws.imageBucket, Key: key }))
}

// An object's bytes, or null when it is not there. An object larger than maxBytes answers with
// maxBytes + 1 bytes, unread, so the caller refuses it by its size. The client stays open until
// the body is read.
export async function readS3Object(key, maxBytes) {
  const client = createS3()
  try {
    let result
    try {
      result = await client.send(new GetObjectCommand({ Bucket: Meteor.settings.aws.imageBucket, Key: key }))
    } catch (error) {
      if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null
      throw error
    }
    const tooLarge = () => {
      result.Body?.destroy?.()
      return Buffer.alloc(maxBytes + 1)
    }
    if (Number(result.ContentLength) > maxBytes) return tooLarge()
    const parts = []
    let size = 0
    for await (const part of result.Body) {
      size += part.length
      if (size > maxBytes) return tooLarge()
      parts.push(part)
    }
    return Buffer.concat(parts)
  } finally {
    client.destroy()
  }
}
