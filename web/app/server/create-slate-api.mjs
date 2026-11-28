import { nativeSlateFromBrief } from '../imports/api/common/native-diagram-brief.mjs'
import { summarizeSlate } from 'slateboxjs/operations'
import { createHash } from 'node:crypto'
import { workshopFromTeamBrief } from '../imports/api/common/team-map-brief.mjs'
import { portableWorkshopSlate } from '../imports/api/common/portableWorkshopSlate.mjs'
import { privateSlateDocument } from './private-slate-document.mjs'
import {
  summarizeWorkshop,
  WorkshopOperationError,
} from './workshop-operation-api.mjs'
import { runExpiry } from '../imports/api/common/slate-operation-runs.mjs'

const invalid = (message) =>
  new WorkshopOperationError(400, 'invalid_request', message)
const conflict = () =>
  new WorkshopOperationError(
    409,
    'idempotency_conflict',
    'This key belongs to another request.'
  )

function readCreation(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.brief !== 'string' ||
      Object.keys(body).some(key => !['kind', 'brief', 'source'].includes(key))) {
    throw invalid('Supply a brief, an optional kind, and an optional diagram source.')
  }
  const {kind = 'map', brief, source} = body
  if (kind === 'diagram') {
    if ('source' in body && typeof source !== 'string') throw invalid('Supply a named diagram source.')
    let content
    try {
      content = nativeSlateFromBrief(brief, source)
    } catch (error) { throw invalid(error.message) }
    // A valid legacy map brief cannot contain a NUL. Keep its prior fingerprint
    // byte-for-byte while separating diagram intents, including source selection.
    return {kind, content, fingerprintInput:'diagram\0' + JSON.stringify([source ?? null, brief.trim()])}
  }
  if (kind !== 'map' || 'source' in body) throw invalid('Choose map or diagram. Only diagrams accept a source.')
  let workshop
  try { workshop = workshopFromTeamBrief(brief) }
  catch { throw invalid('Use 1–160 characters of plain text for the map brief.') }
  const model = {kind:'workshop', version:1, workshop}
  return {
    kind, fingerprintInput:brief.trim(),
    content:{
      options:{name:portableWorkshopSlate.name(model), description:portableWorkshopSlate.describe(model)},
      nodes:[], creative:{revision:0, model},
    },
  }
}

export function createPrivateSlateOperation({
  users,
  slates,
  runs,
  saveCore,
  withTransaction,
  generateShareId,
  appOrigin,
  now = Date.now,
}) {
  // placement: where the slate goes, already checked by the action (server/projects/place.mjs):
  // { projectId, orgId }, or null for the person's own slates.
  return async function create({ token, key, body, placement = null }) {
    if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key))
      throw invalid(
        'Supply an Idempotency-Key of 1–128 printable characters without spaces.'
      )
    const {kind, content, fingerprintInput} = readCreation(body)
    // A slate made in a project is a different request from the same brief made outside one.
    const intent = createHash('sha256').update(placement?.projectId ? `${fingerprintInput}\0project:${placement.projectId}` : fingerprintInput).digest('hex')
    const receiptKey = { tokenId: token._id, idempotencyKey: key }
    const replay = async (session) => {
      const receipt = await runs.findOne(receiptKey, { session })
      if (!receipt) return null
      if (
        receipt.createMapFingerprint !== intent ||
        receipt.userId !== token.userId
      )
        throw conflict()
      const owned = await slates.findOne(
        { _id: receipt.slateId, userId: token.userId },
        { projection: { _id: 1 }, session }
      )
      if (!owned)
        throw new WorkshopOperationError(
          410,
          'slate_unavailable',
          'The slate created by this request is no longer available.'
        )
      return { status: 200, body: receipt.response }
    }
    try {
      return await withTransaction(async (session) => {
        const user = await users.findOne(
          { _id: token.userId, isAnonymous: { $ne: true } },
          { projection: { _id: 1, orgId: 1 }, session }
        )
        if (!user)
          throw new WorkshopOperationError(
            403,
            'forbidden',
            'A registered account is required.'
          )
        const prior = await replay(session)
        if (prior) return prior
        const shareId = await generateShareId()
        const createdAt = now()
        const row = privateSlateDocument({
          content,
          id: 'api-' + kind + '-' + shareId,
          user: placement?.projectId ? { _id: user._id, orgId: placement.orgId } : user,
          shareId,
          now: createdAt,
        })
        if (placement?.projectId) row.projectId = placement.projectId
        const response = {
          shareId,
          url: new URL('/canvas/' + shareId, appOrigin()).href,
          // Store the HTTP representation. BSON would turn optional undefined
          // connection attributes into null on a replay of the same request.
          ...(kind === 'diagram' ? {diagram:JSON.parse(JSON.stringify(summarizeSlate(row)))} : {workshop:summarizeWorkshop(row)}),
        }
        // The save core stores it (revision 1, search fields) and logs its creation.
        await saveCore.create({
          row,
          actor: { kind: 'agent', userId: user._id, tokenId: token._id, tokenName: token.name },
          source: 'create',
          session,
        })
        await runs.insertOne(
          {
            ...receiptKey,
            _id:
              'create-map-' +
              createHash('sha256')
                .update(JSON.stringify([token._id, key]))
                .digest('hex'),
            userId: user._id,
            slateId: row._id,
            slateShareId: shareId,
            createMapFingerprint: intent,
            createdAt,
            expiresAt: runExpiry(createdAt),
            response,
          },
          { session }
        )
        return { status: 201, body: response }
      })
    } catch (error) {
      if (error.code === 11000) {
        const prior = await replay()
        if (prior) return prior
      }
      throw error
    }
  }
}
