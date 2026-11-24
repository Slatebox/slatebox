// Mounts every action that declares a Meteor method. The method name is the action id, so
// the UI calls the same handler, with the same checks, as the HTTP route does.
// Meteor is passed in (methods, Error, user lookup) so this module loads without it.
import { toActionError } from './errors.mjs'
import { principalFromUser } from './principal.mjs'

export function mountDdp(registry, { defineMethods, makeError, loadUser, scopes }) {
  const methods = {}
  for (const action of registry.list()) {
    if (!action.mounts.ddp) continue
    // A second argument { idempotencyKey } (actions that take one): a method Meteor sends again after
    // a reconnect, or a Try again, is the same request, answered once (the registry's record).
    methods[action.id] = async function callAction(input, options) {
      const user = this.userId ? await loadUser(this.userId) : null
      const idempotencyKey = action.idempotency !== 'none' && typeof options?.idempotencyKey === 'string' ? options.idempotencyKey : undefined
      try {
        const result = await registry.run(principalFromUser(user, scopes), action.id, input ?? {}, { idempotencyKey })
        return result.body
      } catch (error) {
        const failure = toActionError(error, action.failure)
        throw makeError(failure.code, failure.message, {
          status: failure.status,
          ...(failure.details !== undefined && { details: failure.details }),
          ...(failure.retryAfter !== undefined && { retryAfter: failure.retryAfter }),
        })
      }
    }
  }
  defineMethods(methods)
  return Object.keys(methods)
}
