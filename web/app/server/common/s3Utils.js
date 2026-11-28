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
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { pagedKeys } from './upload-removal.mjs'
import { UPLOAD_CACHE_CONTROL } from './cdn-invalidation.mjs'

const credentials = () => ({
  accessKeyId: Meteor.settings.aws.accessKey,
  secretAccessKey: Meteor.settings.aws.secretKey,
})

function createS3() {
  return new S3Client({
    region: Meteor.settings.aws.region || 'us-east-1',
    credentials: credentials(),
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

    console.log('listedLegacyObjects', { objects: listedLegacyObjects.Contents?.length ?? 0 })

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

// The S3 side of the file store (fileStore.js): put and delete one object of the image bucket.
export async function putS3Object({ body, key, contentType, contentDisposition }) {
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
      // A cached copy (the CDN's, a browser's) lives a day at most: a removed file stops being
      // served within the day even when the CDN is not told (cdn-invalidation.mjs).
      CacheControl: UPLOAD_CACHE_CONTROL,
      Body: body,
    })
  )
  console.log('uploading s3 success', key)
}

export async function deleteS3Object(key) {
  await sendS3(new DeleteObjectCommand({ Bucket: Meteor.settings.aws.imageBucket, Key: key }))
}

// Every key of the image bucket that starts with prefix, page by page.
export function listS3Keys(prefix) {
  const Bucket = Meteor.settings.aws.imageBucket
  return pagedKeys((ContinuationToken) => sendS3(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken })))
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

// One CloudFront invalidation (cdn-invalidation.mjs builds it): the CDN in front of the image
// bucket drops its copies of these paths. CloudFront is global; its API answers in us-east-1.
export async function createCloudFrontInvalidation(input) {
  const client = new CloudFrontClient({ region: 'us-east-1', credentials: credentials() })
  try {
    return await client.send(new CreateInvalidationCommand(input))
  } finally {
    client.destroy()
  }
}
