// One error shape for every surface: HTTP answers {error:{code,message,details?,retryAfter?}}
// with the status; DDP raises Meteor.Error(code, message, {status, details, retryAfter}).
export class ActionError extends Error {
  constructor(status, code, message, { details, retryAfter } = {}) {
    super(message)
    this.name = 'ActionError'
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
    if (retryAfter !== undefined) this.retryAfter = retryAfter
  }
}

export const problem = (status, code, message, extra) =>
  new ActionError(status, code, message, extra)

// Errors thrown by the existing operation cores carry {status, code}. A 4xx with a code is
// the caller's to read; anything else is a failure of this server and is not described.
export function toActionError(error, failure) {
  if (error instanceof ActionError) return error
  if (
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status < 500 &&
    typeof error.code === 'string'
  ) {
    return new ActionError(error.status, error.code, error.message, {
      details: error.details,
      retryAfter: error.retryAfter,
    })
  }
  return new ActionError(
    500,
    failure?.code || 'internal_error',
    failure?.message || 'The request could not be completed.'
  )
}

export function errorBody(error) {
  const body = { code: error.code, message: error.message }
  if (error.details !== undefined) body.details = error.details
  if (error.retryAfter !== undefined) body.retryAfter = error.retryAfter
  return { error: body }
}
