// The single sign-on session check, as `slatebox status` shows it. The image's app refreshes each
// SSO account's session at Keycloak every 60 seconds, at most 500 accounts per pass, and records
// each pass (counts only); the in-image `slatebox sso sessions --json` reads that record.

const lastJson = text => {
  try { return JSON.parse(String(text || '').trim().split('\n').pop()) } catch { return null }
}

/**
 * The last session check through exec(args) (docker exec or kubectl exec of the in-image
 * `slatebox`): { ran, line, warning, due, checked, cap, ... }, or null when the image has no such
 * command (before 0.2.2) or SSO is off.
 */
export async function ssoSessionState(exec) {
  const result = await exec(['sso', 'sessions', '--json'])
  if (result.code !== 0) return null
  const state = lastJson(result.stdout)
  if (!state || typeof state.ran !== 'boolean' || typeof state.line !== 'string') return null
  return state
}
