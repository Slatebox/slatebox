// Rate limit for calls made with a token, kept in the database so every app process counts
// the same calls. Two windows per minute: one for the token and one for the account behind
// it (tokens are free to make, so a per-token limit alone is no limit). The tighter one
// answers; the caller sees it in the RateLimit headers and, when refused, in Retry-After.
// A visitor (no token) is counted by address, at a lower rate.
export const RATE_LIMITS = Object.freeze({ perToken: 120, perAccount: 240, perAddress: 60, windowSeconds: 60 })

export function createRateLimiter({ collection, now = Date.now, limits = RATE_LIMITS }) {
  const windowMs = limits.windowSeconds * 1000
  async function count(id, expiresAt) {
    const doc = await collection.findOneAndUpdate(
      { _id: id },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    )
    return doc?.count ?? 1
  }
  return {
    limits,
    async take(principal) {
      const at = now()
      const window = Math.floor(at / windowMs)
      const resetAt = (window + 1) * windowMs
      const expiresAt = new Date(resetAt + windowMs)
      if (principal.kind === 'visitor') {
        const limit = limits.perAddress ?? RATE_LIMITS.perAddress
        const left = limit - (await count(`address:${principal.address}:${window}`, expiresAt))
        return { allowed: left >= 0, limit, remaining: Math.max(0, left), resetSeconds: Math.max(1, Math.ceil((resetAt - at) / 1000)) }
      }
      const [byToken, byAccount] = await Promise.all([
        count(`token:${principal.tokenId}:${window}`, expiresAt),
        count(`account:${principal.userId}:${window}`, expiresAt),
      ])
      const tokenLeft = limits.perToken - byToken
      const accountLeft = limits.perAccount - byAccount
      const tighter = tokenLeft <= accountLeft
        ? { limit: limits.perToken, left: tokenLeft }
        : { limit: limits.perAccount, left: accountLeft }
      return {
        allowed: tighter.left >= 0,
        limit: tighter.limit,
        remaining: Math.max(0, tighter.left),
        resetSeconds: Math.max(1, Math.ceil((resetAt - at) / 1000)),
      }
    },
  }
}
