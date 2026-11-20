import { resolveSlateRole, slateVisibility } from './methods/slate-role.mjs'
/* eslint-disable no-underscore-dangle */
import { createHash, randomBytes } from 'node:crypto'

// A scope exists only while an action needs it; each package adds the scope with its action.
// ai:admin: on top of ai:settings, change or test a team's or this server's AI (the person must
// also be that team's admin or an administrator), and change AI control (administrators).
// ai:admin:read: read AI control (what answers each AI feature, its health and its audit trail)
// without being able to change anything (administrators only). ai:admin holds it too.
// team:export: download everything the team owns (the person must be a team admin).
// slates:delete: delete slates the account owns and remove comments (separate from editing).
// team:import: import a team export as a new team, and confirm or discard it (administrators).
// library:review: review, refine, publish and unpublish library submissions (administrators).
export const API_TOKEN_SCOPES = ['slates:read', 'slates:write', 'slates:share', 'slates:delete', 'ai:settings', 'ai:admin', 'ai:admin:read', 'team:export', 'team:import', 'library:review']
export const ACTIVE_TOKEN_LIMIT = 10

export function hashApiToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function extractBearerToken(req) {
  const header = req.get?.('authorization') || req.headers?.authorization || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export function createApiTokenService({
  apiTokens,
  users,
  slates,
  slateAccess,
  now = Date.now,
  randomBytesImpl = randomBytes,
}) {
  async function createApiToken({ userId, name, scopes }) {
    const prefix = randomBytesImpl(4).toString('hex')
    const secret = randomBytesImpl(24).toString('base64url')
    const token = `sbx_${prefix}_${secret}`
    const createdAt = now()
    const doc = {
      userId,
      name: `${name || 'Slatebox API'}`.trim().slice(0, 80),
      prefix,
      tokenHash: hashApiToken(token),
      scopes: [...new Set(scopes)],
      createdAt,
      lastUsedAt: null,
      revokedAt: null,
    }
    const id = await apiTokens.insertAsync(doc)
    const { tokenHash, ...safeDoc } = doc
    return { id, token, ...safeDoc }
  }

  // Resolves the bearer token and the account behind it. Scopes are checked by the action
  // registry, which answers 403 insufficient_scope; a token whose account is gone, or was
  // never a registered account, does not authenticate.
  // A personal token (sbx_) works wherever tokens do. A connected app's access token (sbo_,
  // server/oauth) works only where it was issued for (audience: the /mcp resource) and only
  // until it expires; without an audience (/api/v1) it never authenticates.
  async function authenticateApiRequest(req, { audience } = {}) {
    const rawToken = extractBearerToken(req)
    if (!rawToken?.startsWith('sbx_') && !rawToken?.startsWith('sbo_')) return null
    const token = await apiTokens.findOneAsync({
      tokenHash: hashApiToken(rawToken),
      revokedAt: null,
    })
    if (!token) return null
    const oauth = token.kind === 'oauth'
    if (oauth !== rawToken.startsWith('sbo_')) return null
    if (oauth && (!audience || token.resource !== audience || !(token.expiresAt > now()))) return null
    // A token is only as good as its account: none for an account that was deleted, disabled,
    // or whose single sign-on identity provider has removed the person.
    const account = await users.findOneAsync(
      { _id: token.userId },
      { fields: { _id: 1, isAnonymous: 1, isDisabled: 1, 'services.sso.revokedAt': 1 } }
    )
    if (!account || account.isAnonymous || account.isDisabled || account.services?.sso?.revokedAt) return null
    await apiTokens.updateAsync(
      { _id: token._id },
      { $set: { lastUsedAt: now() } }
    )
    return { token, account }
  }

  // Without the hashes. onlyTokenId narrows the list to one token (a token sees itself only).
  // A connected app (kind oauth) shows when its connection lapses (refreshExpiresAt).
  async function listApiTokens(userId, { onlyTokenId } = {}) {
    return apiTokens
      .find(
        { userId, ...(onlyTokenId && { _id: onlyTokenId }) },
        {
          fields: { tokenHash: 0, refreshHash: 0, refreshHashPrev: 0, codeHash: 0, clientId: 0, resource: 0, expiresAt: 0 },
          sort: { createdAt: -1 },
        }
      )
      .fetchAsync()
  }

  // Personal tokens only: connected apps have their own limit (server/oauth).
  const countActiveApiTokens = (userId) =>
    apiTokens.find({ userId, revokedAt: null, kind: { $ne: 'oauth' } }).countAsync()

  // Revoking a revoked token is a no-op that still answers true; another account's token, or
  // one that does not exist, answers false.
  async function revokeApiToken(userId, tokenId) {
    const owned = await apiTokens.findOneAsync({ _id: tokenId, userId })
    if (!owned) return false
    if (!owned.revokedAt)
      await apiTokens.updateAsync(
        { _id: tokenId, userId, revokedAt: null },
        { $set: { revokedAt: now() } }
      )
    return true
  }

  // Whether the token's account may read (or write) the slate, and what it may do there:
  // access {role, canEdit, isOwner, linkRole, grantKey}. A visitor (no account) reads a public
  // slate with role READ, as the bare public address gives a signed-out person.
  async function authorizeTokenForSlate(token, shareId, write = false) {
    const slate = await slates.findOneAsync({ shareId })
    if (!slate) return { slate: null, authorized: false }
    const type = slateVisibility(slate)
    const grants = await slateAccess
      .find(
        { slateId: slate._id, type },
        {
          fields: {
            slateId: 1,
            type: 1,
            userId: 1,
            accessKey: 1,
            slateAccessPermissionId: 1,
          },
        }
      )
      .fetchAsync()
    const general = grants.filter((grant) => !grant.userId)
    const linkRole = general.length === 1 && general[0].slateAccessPermissionId !== 'NONE'
      ? general[0].slateAccessPermissionId
      : null
    const isOwner = Boolean(token.userId) && slate.userId === token.userId
    const member = token.userId ? grants.find((grant) => grant.userId === token.userId) : undefined
    let role
    if (isOwner) role = 'EDIT'
    // A bearer token identifies an account. It does not carry an unlisted invitation.
    else if (!member && type !== 'public') role = null
    else role = resolveSlateRole(slate, token.userId ? { _id: token.userId } : null, false, grants)
    // New workshop writes require an explicit collaborator; ordinary public canvases
    // retain their established default role for a signed-in account on the bare URL.
    const canEdit =
      isOwner ||
      (role === 'EDIT' && Boolean(token.userId) && (slate.creative?.model?.kind !== 'workshop' || Boolean(member)))
    const access = { role: role || null, canEdit, isOwner, linkRole, grantKey: member?.accessKey ?? null }
    return { slate, authorized: write ? canEdit : Boolean(role), access }
  }

  return {
    createApiToken,
    authenticateApiRequest,
    authorizeTokenForSlate,
    listApiTokens,
    countActiveApiTokens,
    revokeApiToken,
  }
}
