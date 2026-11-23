// Both creation surfaces use the same identity, timestamps and default visibility.
export function privateSlateDocument({ content, id, user, shareId, now }) {
  return {
    ...content,
    _id: id,
    userId: user._id,
    shareId,
    ...(user.orgId ? { orgId: user.orgId } : {}),
    created: now,
    lastSaved: now,
    options: {
      ...content.options,
      id,
      isPrivate: true,
      isPublic: false,
      isUnlisted: false,
    },
  }
}
