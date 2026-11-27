// Who is calling. Every action runs as a principal, whichever surface it arrived on:
//   person  a signed-in account, through the app (DDP)
//   guest   an anonymous account the app made for a visitor (DDP)
//   agent   a personal access token, through /api/v1 (and so MCP and the CLI)
// Handlers read principal.userId and never Meteor.userId(). Tier 3 adds a principal from a
// link assertion here, with no handler change.

export function principalFromUser(user, allScopes) {
  if (!user?._id) return null
  return {
    kind: user.isAnonymous ? 'guest' : 'person',
    userId: user._id,
    tokenId: null,
    tokenName: null,
    // A session acts with the account's own rights; slate access is still decided per slate.
    scopes: [...allScopes],
  }
}

// A connected app's token (sbo_) authenticates on /api/v1 only when it was issued for a purpose
// that names its actions: a move sign-in (server/oauth/device.mjs, purpose "move") or the viewer
// app (server/oauth/viewer.mjs) is bound to `audiences` → its action ids (or { actions, refusal }),
// and the registry admits it for those actions only (onlyActions), saying `refusal` otherwise.
export function principalFromToken(authenticated, { audiences = null } = {}) {
  if (!authenticated?.token?._id) return null
  const { token } = authenticated
  const purpose = token.kind === 'oauth' && audiences && Object.hasOwn(audiences, token.resource) ? audiences[token.resource] : null
  const only = Array.isArray(purpose) ? purpose : purpose?.actions || null
  const refusal = !Array.isArray(purpose) && typeof purpose?.refusal === 'string' ? purpose.refusal : null
  // Slatebox's own app (the viewer, purpose.firstParty 'viewer'): what it adds is the person's own edit.
  const firstParty = !Array.isArray(purpose) && typeof purpose?.firstParty === 'string' ? purpose.firstParty : null
  return {
    ...(only && { onlyActions: [...only] }),
    ...(only && refusal && { onlyRefusal: refusal }),
    ...(only && firstParty && { firstParty }),
    kind: 'agent',
    userId: token.userId,
    tokenId: token._id,
    tokenName: token.name,
    scopes: [...(token.scopes || [])],
    // A connected app's token (server/oauth): it can sign the person in again for more scopes.
    ...(token.kind === 'oauth' && { oauth: true }),
  }
}

// Someone with no token and no account: reads what is public. Over HTTP it carries the
// address it is counted by (limited per address); a signed-out app page (DDP) has none.
export function principalFromVisitor(address) {
  return { kind: 'visitor', userId: null, tokenId: null, tokenName: null, address: address ? `${address}` : null, scopes: [] }
}

// The shape the existing operation cores take for "who is writing": a token id for receipts
// and an account id for permissions. A session principal has no token id.
export const tokenLike = (principal) => ({ _id: principal.tokenId, userId: principal.userId, name: principal.tokenName })
