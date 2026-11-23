import { createHash, randomBytes } from 'node:crypto'
import {
  configureGeneralLink,
  generalGrantSelector,
  sharingVisibility,
} from './methods/general-slate-link.mjs'

const problem = (status, code, message) =>
  Object.assign(new Error(message), { status, code })
const invalid = (message) => problem(400, 'invalid_request', message)
const changed = () =>
  problem(
    409,
    'invite_changed',
    'This invitation has changed. Check the current sharing settings.'
  )
const unavailable = () =>
  problem(404, 'not_found', 'Slate not found or unavailable.')
const invitationId = /^[a-f0-9]{32}$/

export function createSlateInviteOperation({
  users,
  slates,
  grants,
  runs,
  withTransaction,
  generateKey,
  appOrigin,
  now = Date.now,
}) {
  return async function manage({
    token,
    shareId,
    key,
    body,
    inviteId,
    revoke,
  }) {
    if (typeof shareId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(shareId))
      throw unavailable()
    if (typeof key !== 'string' || !/^[!-~]{1,128}$/.test(key))
      throw invalid(
        'Supply an Idempotency-Key of 1–128 printable characters without spaces.'
      )
    if (revoke) {
      if (
        typeof inviteId !== 'string' ||
        !invitationId.test(inviteId) ||
        body !== undefined
      )
        throw invalid('Supply an invitation ID in the path and no body.')
    } else if (
      !body ||
      Object.keys(body).length !== 1 ||
      !['read', 'comment', 'edit'].includes(body.role)
    ) {
      throw invalid('Choose a role of read, comment or edit.')
    }
    const receiptKey = { tokenId: token._id, idempotencyKey: key }
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          revoke ? 'revoke' : 'share',
          shareId,
          revoke ? inviteId : body.role,
        ])
      )
      .digest('hex')
    const urlFor = (grant) =>
      new URL('/canvas/' + grant.accessKey, appOrigin()).href

    async function change(session) {
      if (
        !(await users.findOne(
          { _id: token.userId, isAnonymous: { $ne: true } },
          { projection: { _id: 1 }, session }
        ))
      )
        throw problem(
          403,
          'forbidden',
          'A registered owner account is required.'
        )
      const owner = { shareId, userId: token.userId }
      const board = await slates.findOne(owner, {
        projection: { orgId: 1, options: 1 },
        session,
      })
      if (!board) throw unavailable()
      const prior = await runs.findOne(receiptKey, { session })
      const visibility = sharingVisibility(board)
      const identity = { slateId: board._id, type: 'unlisted', userId: null }
      if (prior) {
        if (
          prior.userId !== token.userId ||
          prior.slateId !== board._id ||
          prior.inviteFingerprint !== fingerprint
        )
          throw problem(
            409,
            'idempotency_conflict',
            'This key belongs to another request.'
          )
        if (revoke)
          return { status: 200, body: { shareId, inviteId, revoked: true } }
        const current =
          visibility === 'unlisted' &&
          (await grants.findOne(
            {
              ...identity,
              inviteId: prior.inviteId,
              slateAccessPermissionId: body.role.toUpperCase(),
            },
            { session }
          ))
        if (!current?.accessKey) throw changed()
        return {
          status: 200,
          body: {
            shareId,
            inviteId: current.inviteId,
            role: body.role,
            url: urlFor(current),
          },
        }
      }
      if (board.options?.isPublic || visibility === 'public')
        throw problem(
          409,
          'public_slate',
          'Use Share on the slate to change its public visibility.'
        )
      // The existing DDP sharing methods also update this board in the transaction.
      // Mongo retries overlapping owner changes with a new snapshot, including all grants.
      const lock = await slates.updateOne(
        { _id: board._id, userId: token.userId },
        { $inc: { sharingRevision: 1 } },
        { session }
      )
      if (!lock.matchedCount) throw unavailable()
      const context = {
        board,
        boards: slates,
        grants,
        owner: { _id: board._id, userId: token.userId },
        session,
      }
      let response, status
      if (revoke) {
        if (
          visibility !== 'unlisted' ||
          !(await grants.findOne(
            { ...identity, inviteId },
            { session, projection: { _id: 1 } }
          ))
        )
          throw changed()
        await configureGeneralLink(context, {
          type: 'private',
          permission: 'READ',
          generateKey,
        })
        response = { shareId, inviteId, revoked: true }
        status = 200
      } else {
        // Historical boards can have several active general keys. An API operation
        // must not claim a downgrade while an independent older edit URL stays live.
        const active =
          visibility === 'unlisted'
            ? await grants
                .find(
                  { ...generalGrantSelector(board._id), type: 'unlisted' },
                  { session }
                )
                .limit(2)
                .toArray()
            : []
        const canonical =
          visibility === 'unlisted' &&
          (await grants.findOne(
            { _id: board._id, userId: null },
            { session, projection: { _id: 1, type: 1, slateId: 1 } }
          ))
        if (
          active.length > 1 ||
          (canonical &&
            (canonical.type !== 'unlisted' || canonical.slateId !== board._id))
        )
          throw problem(
            409,
            'multiple_invites',
            'Use Share on the slate to withdraw its older links before creating a new invitation.'
          )
        const link = await configureGeneralLink(context, {
          type: 'unlisted',
          permission: body.role.toUpperCase(),
          generateKey,
        })
        if (!link?.accessKey) throw changed()
        const generation = link.inviteId || randomBytes(16).toString('hex')
        if (!link.inviteId)
          await grants.updateOne(
            { _id: link._id },
            { $set: { inviteId: generation } },
            { session }
          )
        response = {
          shareId,
          inviteId: generation,
          role: body.role,
          url: urlFor(link),
        }
        status = active.length ? 200 : 201
      }
      // Store the public generation identifier only. A replay resolves the active URL
      // under current ownership and permissions rather than returning a withdrawn secret.
      await runs.insertOne(
        {
          ...receiptKey,
          _id:
            'invite-' +
            createHash('sha256')
              .update(JSON.stringify([token._id, key]))
              .digest('hex'),
          userId: token.userId,
          slateId: board._id,
          slateShareId: shareId,
          inviteFingerprint: fingerprint,
          inviteId: response.inviteId,
          createdAt: now(),
        },
        { session }
      )
      return { status, body: response }
    }
    try {
      return await withTransaction(change)
    } catch (error) {
      // Two simultaneous requests can reserve this token key on different boards.
      if (
        error.code === 11000 &&
        (await runs.findOne(receiptKey, { projection: { _id: 1 } }))
      )
        return withTransaction(change)
      throw error
    }
  }
}
