// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Which names a team address (<name>.slatebox.team) may take. One DNS label: 3 to 32 characters,
// a–z, 0–9 and hyphens, starting with a letter, not ending with a hyphen, and never two hyphens in
// a row (that also refuses xn-- punycode, so no look-alike Unicode names). Reserved names are ours;
// blocked names impersonate brands or offend. Callers say "unavailable" for both, and for taken
// names, so the lists cannot be probed (claims.mjs).
import { BRAND_PARTS, BRAND_SUBSTRINGS, OFFENSIVE_EXACT, OFFENSIVE_SUBSTRINGS } from './blocked.mjs'

export const NAME_RULE = '3–32 characters: a–z, 0–9 and hyphens, starting with a letter, not ending with a hyphen'
const SHAPE = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/

export const RESERVED = Object.freeze(new Set([
  'www', 'app', 'api', 'admin', 'administrator', 'root', 'mail', 'email', 'smtp', 'imap', 'pop', 'mx', 'ns', 'ns1', 'ns2', 'dns',
  'docs', 'doc', 'help', 'support', 'status', 'auth', 'oauth', 'sso', 'login', 'logout', 'signin', 'signup', 'register',
  'account', 'accounts', 'billing', 'pay', 'payment', 'payments', 'cdn', 'static', 'assets', 'media', 'img', 'images',
  'files', 'download', 'downloads', 'upload', 'uploads',
  'slatebox', 'slate', 'slates', 'team', 'teams', 'test', 'testing', 'staging', 'stage', 'dev', 'prod', 'production',
  'beta', 'alpha', 'preview', 'demo', 'sandbox', 'internal', 'intranet', 'vpn', 'git', 'ci',
  'security', 'abuse', 'postmaster', 'hostmaster', 'webmaster', 'noreply', 'no-reply', 'info', 'contact', 'sales', 'legal',
  'privacy', 'terms', 'blog', 'news', 'community', 'forum', 'live', 'relay', 'ws', 'wss', 'socket', 'mcp', 'agent', 'agents',
  'localhost', 'local', 'example', 'invalid', 'wpad', 'autodiscover', 'autoconfig', 'isatap', 'e2e',
]))

// e2e-<anything> is the end-to-end test's own prefix: only accounts the settings name may claim it.
export const E2E_PREFIX = 'e2e-'

const FOLD = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't' }
export const fold = (name) => name.replace(/-/g, '').replace(/[013457]/g, (digit) => FOLD[digit])
// 1 reads as l and as i ("paypa1", "sh1t"): a name is checked under both.
const folds = (name) => [...new Set([fold(name), fold(name.replace(/1/g, 'i'))])]

/** The name as stored (lower case, trimmed), or null when the input is not a string. */
export const normalizeName = (input) => (typeof input === 'string' ? input.trim().toLowerCase() : null)

/** Whether the label has the right shape. */
export function validShape(name) {
  return typeof name === 'string' && SHAPE.test(name) && !name.includes('--')
}

/**
 * Why a well-shaped name may not be claimed, or null when it may.
 * @param {string} name   normalized
 * @param {{ pattern: string, kind: 'exact'|'substring' }[]} [extra]  the runtime blocklist
 * @param {{ e2e?: boolean }} [options]  e2e: the caller may use the e2e- prefix
 * @returns {null | 'reserved' | 'brand' | 'offensive' | 'blocked'}
 */
export function refusal(name, extra = [], { e2e = false } = {}) {
  if (RESERVED.has(name)) return 'reserved'
  if (name.startsWith(E2E_PREFIX) && !e2e) return 'reserved'
  for (const folded of folds(name)) {
    const parts = name.split('-').flatMap(folds)
    if (BRAND_SUBSTRINGS.some((word) => folded.includes(word))) return 'brand'
    if (BRAND_PARTS.some((word) => folded === word || parts.includes(word))) return 'brand'
    if (OFFENSIVE_SUBSTRINGS.some((word) => folded.includes(word))) return 'offensive'
    if (OFFENSIVE_EXACT.some((word) => folded === word || parts.includes(word))) return 'offensive'
    for (const entry of extra) {
      const pattern = fold(`${entry?.pattern || ''}`.toLowerCase())
      if (!pattern) continue
      if (entry.kind === 'substring' ? folded.includes(pattern) : folded === pattern) return 'blocked'
    }
  }
  return null
}

/**
 * Checks a name someone typed.
 * → { ok: true, name } | { ok: false, code: 'invalid_name', message } | { ok: false, code: 'unavailable', reason }
 */
export function checkName(input, extra = [], options = {}) {
  const name = normalizeName(input)
  if (!validShape(name)) return { ok: false, code: 'invalid_name', message: `A team address is ${NAME_RULE}.` }
  const reason = refusal(name, extra, options)
  if (reason) return { ok: false, code: 'unavailable', reason, name }
  return { ok: true, name }
}

/** Up to `count` names close to `name` that pass the rules (availability is the caller's check). */
export function suggestionsFor(name, { extra = [], count = 6 } = {}) {
  const base = normalizeName(name)?.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 24) || 'team'
  const candidates = [`${base}-team`, `${base}-hq`, `team-${base}`, `${base}-app`, `${base}-boards`, `our-${base}`, `${base}-works`, `${base}-crew`]
  return candidates.filter((candidate) => validShape(candidate) && !refusal(candidate, extra)).slice(0, count)
}
