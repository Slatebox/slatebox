import { randomUUID } from 'node:crypto'

const day = 24 * 60 * 60 * 1000

// Guests are never counted or turned away. Each admission writes one receipt: other code
// (creative slates, native saves, kept slates, permissions) reads it to check that this
// browser was admitted to this board within the last 24 hours. That window is an access
// rule, not a price.
export async function recordGuestAdmission({ views }, slate, viewer, visitor, now = Date.now()) {
  if (typeof visitor !== 'string' || !visitor.length || visitor.length > 128) return false
  const receipt = {
    guestCollaboratorId: visitor,
    slateId: slate._id,
    slateOrgId: slate.orgId ?? null,
    slateOwnerUserId: slate.userId,
    orgId: viewer?.orgId ?? null,
    userId: viewer?._id ?? null,
    actualGuest: !viewer,
    isUnlisted: Boolean(slate.options?.isUnlisted),
    isPublic: Boolean(slate.options?.isPublic),
    month: new Date(now).getUTCMonth() + 1,
    timestamp: now,
  }
  const id = JSON.stringify(['guest', slate._id, visitor, receipt.userId])
  const literal = Object.fromEntries(Object.entries(receipt).map(([key, value]) => [key, { $literal: value }]))
  // A receipt within its 24 hours keeps its pass; an older one starts a new pass.
  const live = { $gt: [{ $ifNull: ['$passStartedAt', { $ifNull: ['$timestamp', 0] }] }, now - day] }
  await views.updateOne({ _id: id }, [{ $set: {
    ...literal,
    passId: { $cond: [live, { $ifNull: ['$passId', '$_id'] }, { $literal: randomUUID() }] },
    passStartedAt: { $cond: [live, { $ifNull: ['$passStartedAt', '$timestamp'] }, { $literal: now }] },
  } }], { upsert: true })
  return true
}
