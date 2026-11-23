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

export function principalFromToken(authenticated) {
  if (!authenticated?.token?._id) return null
  const { token } = authenticated
  return {
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
