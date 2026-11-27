// What Team settings › Sign-in & security › SCIM shows, from teamScim.get, as plain data. Pure, so
// ScimCard.jsx and scripts/scim.test.mjs run the same code. Every control it offers does something
// on this server: nothing is shown that the team cannot use.

export const ROLE_CHOICES = Object.freeze([
  { value: '', label: 'No role change' },
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
])

const when = (value, now) => {
  if (!value) return null
  const ms = now - new Date(value).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)} h ago`
  return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * The card's state. settings: teamScim.get's answer (or null while it loads).
 *   → { state: 'loading' | 'off' | 'needs-sso' | 'ready', canCreate, tokens, limitLine, domainsLine }
 */
export function scimCardState(settings, now = Date.now()) {
  if (!settings) return { state: 'loading' }
  const active = settings.tokens.filter((token) => !token.revokedAt)
  const tokens = active.map((token) => ({
    ...token,
    shown: `sbscim_${token.prefix}_…`,
    detail: `Made ${when(token.createdAt, now)} · ${token.lastUsedAt ? `last used ${when(token.lastUsedAt, now)}` : 'not used yet'}`,
  }))
  let state = 'ready'
  if (!settings.available) state = 'off'
  else if (settings.domains.length === 0) state = 'needs-sso'
  const max = settings.maxTokens || 2
  return {
    state,
    tokens,
    // A token can be revoked whatever the state: a team can always cut a provider off.
    canCreate: state === 'ready' && active.length < max,
    limitLine: active.length >= max ? `A team has at most ${max} tokens. Revoke one to make another.` : null,
    domainsLine: settings.domains.length
      ? `Adds people at ${settings.domains.join(', ')}.`
      : null,
  }
}
