// Both the Share dialog and authenticated owner API use the same grant and visibility mutations.
export function sharingVisibility(board) {
  return board.options?.isUnlisted
    ? 'unlisted'
    : board.options?.isPrivate
      ? 'private'
      : 'public'
}

export const generalGrantSelector = (slateId) => ({
  slateId,
  userId: null,
  type: { $in: ['public', 'unlisted'] },
})

export async function configureGeneralLink(
  { board, boards, grants, owner, session },
  { type, permission, initialize = false, generateKey }
) {
  const current = sharingVisibility(board)
  if (initialize && (current !== type || type === 'private')) return null
  const slateId = owner._id
  const general = generalGrantSelector(slateId)
  const canonical = { _id: slateId, userId: null }
  if (type === 'private' || current === 'private') {
    await grants.deleteMany({ $or: [canonical, general] }, { session })
  }
  let link = null
  if (type !== 'private') {
    link =
      (await grants.findOne(canonical, { session })) ||
      (await grants.findOne({ ...general, type: current }, { session }))
    if (link) {
      if (!initialize) {
        await grants.updateOne(
          { _id: link._id },
          { $set: { type, slateAccessPermissionId: permission } },
          { session }
        )
        link = { ...link, type, slateAccessPermissionId: permission }
      }
    } else {
      link = {
        _id: slateId,
        slateId,
        owningUserId: owner.userId,
        ...(board.orgId && { orgId: board.orgId }),
        accessKey: generateKey(),
        type,
        slateAccessPermissionId: initialize ? 'READ' : permission,
      }
      await grants.insertOne(link, { session })
    }
  }
  if (!initialize && current !== type) {
    await boards.updateOne(
      owner,
      {
        $set: {
          'options.isPublic': type === 'public',
          'options.isUnlisted': type === 'unlisted',
          'options.isPrivate': type === 'private',
        },
      },
      { session }
    )
  }
  return link
}
