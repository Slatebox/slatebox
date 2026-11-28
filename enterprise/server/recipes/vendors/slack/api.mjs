// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// One Slack Web API call for a recipe run: the person's token, Slack's own hosts only (the fetch is
// slackOnlyFetch over the guarded fetch, enterprise/server/meteor.js), the run's abort signal, and
// Slack's answer read the way slack.mjs reads it (ok is what counts; a 429 carries Retry-After).
// Errors carry Slack's code only, never a token or a message body.

export class SlackRecipeError extends Error {
  constructor(code, { retryAfter = null, status = null } = {}) {
    super(`Slack answered ${code}`)
    this.name = 'SlackRecipeError'
    this.code = code
    this.slack = code
    if (retryAfter) this.retryAfter = retryAfter
    if (status) this.status = status
  }
}

// Slack's codes that mean the sign-in no longer works: the recipe waits for "connect again".
export const SIGN_IN_CODES = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive', 'missing_scope', 'no_permission'])

/** createSlackCall({ fetch, apiBase }) → call(token, method, params, { signal }) → Slack's JSON. */
export function createSlackCall({ fetch, apiBase = 'https://slack.com' }) {
  return async function call(token, method, params = {}, { signal } = {}) {
    const body = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
    let response
    try {
      response = await fetch(`${apiBase}/api/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(), ...(signal && { signal }) })
    } catch (error) {
      if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
      throw new SlackRecipeError('unreachable', { status: 502 })
    }
    if (response.status === 429) {
      const seconds = Math.min(3600, Math.max(1, Number.parseInt(response.headers?.get?.('retry-after') || '', 10) || 60))
      await response.body?.cancel?.().catch(() => {})
      throw new SlackRecipeError('ratelimited', { retryAfter: seconds, status: 429 })
    }
    if (response.status >= 500) throw new SlackRecipeError('unavailable', { status: response.status })
    const json = await response.json().catch(() => null)
    if (!json || typeof json !== 'object') throw new SlackRecipeError('bad_answer', { status: 502 })
    if (json.ok !== true) throw new SlackRecipeError(typeof json.error === 'string' ? json.error.slice(0, 60) : 'failed')
    return json
  }
}
