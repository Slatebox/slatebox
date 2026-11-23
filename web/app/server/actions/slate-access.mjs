// Loads the slate an action names and checks the caller may read it, or write it.
// The rule is the one authorizeTokenForSlate applies; it is not repeated per action.
// What the caller may do there (role, canEdit, isOwner ...) is left on ctx.access for the read.
import { problem } from './errors.mjs'
import { tokenLike } from './principal.mjs'

export const loadSlate = (write) => async (principal, input, ctx) => {
  const { slate, authorized, access } = await ctx.deps.authorizeTokenForSlate(
    tokenLike(principal),
    input.shareId,
    write
  )
  if (authorized) {
    ctx.access = access
    return slate
  }
  // A visitor reads public slates only, and learns nothing about any other.
  if (principal.kind === 'visitor')
    throw problem(401, 'unauthorized', 'A valid Slatebox API token is required.')
  throw slate
    ? problem(403, 'forbidden', 'Slate not found or unavailable.')
    : problem(404, 'not_found', 'Slate not found or unavailable.')
}
