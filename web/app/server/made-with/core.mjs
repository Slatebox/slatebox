// The "Made with Slatebox" mark's one server setting, without Meteor (imports/api/common/made-with.mjs
// says where the mark shows). Slatebox Cloud always shows it; a self-hosted server's administrator
// may hide it. The choice is one systemSettings row ({ _id: 'madeWithMark', hidden, by, at }).
//
// createMadeWith({ cloud, rows, isServerAdmin, now, ttlMs }):
// - cloud: whether this server is Slatebox Cloud;
// - rows: { read() -> row | null, write(fields) } over the systemSettings row;
// - isServerAdmin(userId) -> boolean.
// status() is asked by every shared page, signed in or not, so the row is read at most once per ttlMs.
import { madeWithPolicy } from '../../imports/api/common/made-with.mjs'

export class MadeWithError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export function createMadeWith({ cloud = false, rows, isServerAdmin, now = Date.now, ttlMs = 30_000 }) {
  let cached = null
  async function hidden() {
    if (cloud) return false
    if (cached && now() - cached.at < ttlMs) return cached.hidden
    const row = await rows.read().catch(() => null)
    cached = { at: now(), hidden: row?.hidden === true }
    return cached.hidden
  }
  return {
    /** What a shared page needs: { enabled }. An administrator also learns { canHide }. */
    async status(userId = null) {
      const policy = madeWithPolicy({ cloud, hidden: await hidden() })
      if (userId && policy.canHide && (await isServerAdmin(userId))) return { enabled: policy.enabled, canHide: true }
      return { enabled: policy.enabled }
    },
    /** A self-hosted server's administrator shows or hides the mark. Cloud refuses. */
    async setHidden(userId, value) {
      if (cloud) throw new MadeWithError('cloud', 'Slatebox Cloud always shows the mark.')
      if (typeof value !== 'boolean') throw new MadeWithError('bad_request', 'Say whether to hide the mark.')
      if (!userId || !(await isServerAdmin(userId))) throw new MadeWithError('forbidden', 'Only this server\'s administrator can change this.')
      await rows.write({ hidden: value, by: userId, at: new Date(now()) })
      cached = { at: now(), hidden: value }
      return madeWithPolicy({ cloud, hidden: value })
    },
  }
}
