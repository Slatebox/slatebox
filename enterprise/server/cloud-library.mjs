// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Community cards a licensed self-hosted install receives from Slatebox Cloud: the custom MCP
// servers people suggested there and Slatebox's administrators approved (library kind integration).
// Runs only where enterprise code is unlocked by an on-prem license (meteor.js starts it when
// via === 'license'); a locked install never loads this file and keeps the cards it ships with.
//   - One fixed origin (https://app.slatebox.com), reached through the same guarded fetch as every
//     MCP server (https, public addresses only, capped in bytes and time, no redirects), GET only.
//   - The public export (GET /api/v1/library/export?kind=integration), paged, at most CLOUD_LIBRARY_LIMITS.pages pages.
//   - Every card is checked again here as if it were typed in (communityCard): a card that fails is
//     dropped, never stored.
//   - The last good copy is kept (connectorCloudCatalog) and served while Cloud cannot be reached:
//     an install offline keeps working with what it had, or with the built-in cards alone.
//   - settings.enterprise.cloudLibrary: false turns it off (the operator's switch).
// No credentials are sent: the export is public.
import { communityCard } from './gallery-admin.mjs'

export const CLOUD_ORIGIN = 'https://app.slatebox.com'
export const CLOUD_LIBRARY_LIMITS = Object.freeze({ pages: 20, cards: 400, maxBytes: 2 * 1024 * 1024, timeoutMs: 15000, everyMs: 6 * 3600 * 1000 })
export const CLOUD_EXPORT_PATH = '/api/v1/library/export'

/** Whether this install pulls Community cards from Slatebox Cloud: a licensed install, unless its operator says no. */
export const cloudLibraryOn = ({ via, settings }) => via === 'license' && settings?.enterprise?.cloudLibrary !== false

/**
 * fetch: the guarded fetch (createMcpFetch with methods ['GET'], no redirects, small answers);
 * store: { get() → { cards, fetchedAt, lastError, lastTriedAt } | null, put(doc) } (the last good copy).
 */
export function createCloudCatalog({ fetch, store, origin = CLOUD_ORIGIN, devOrigins = [], now = Date.now, log = () => {} }) {
  async function pull() {
    const cards = []
    let cursor = null
    for (let page = 0; page < CLOUD_LIBRARY_LIMITS.pages; page++) {
      const url = new URL(CLOUD_EXPORT_PATH, origin)
      url.searchParams.set('kind', 'integration')
      if (cursor) url.searchParams.set('cursor', cursor)
      const response = await fetch(url.href, { method: 'GET', headers: { accept: 'application/json' } })
      if (response.status !== 200) throw new Error(`Slatebox Cloud answered ${response.status}.`)
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error('Slatebox Cloud sent an answer that could not be read.')
      }
      const items = Array.isArray(body?.items) ? body.items : []
      for (const item of items) {
        const card = communityCard(item, { from: 'cloud', devOrigins })
        if (card && !cards.some((have) => have.url === card.url || have.id === card.id)) cards.push(card)
      }
      const next = typeof body?.next === 'string' && /^[0-9]{1,9}$/.test(body.next) ? body.next : null
      if (!next || next === cursor) break
      cursor = next
    }
    return cards.slice(0, CLOUD_LIBRARY_LIMITS.cards)
  }

  /** Fetch now: the new copy replaces the last only when the whole pull worked. */
  async function sync() {
    const at = new Date(now())
    try {
      const cards = await pull()
      await store.put({ cards, fetchedAt: at, lastTriedAt: at, lastError: null })
      log({ kind: 'cloud_library', cards: cards.length })
      return { ok: true, cards: cards.length }
    } catch (error) {
      const before = (await store.get().catch(() => null)) || {}
      await store.put({ cards: before.cards || [], fetchedAt: before.fetchedAt || null, lastTriedAt: at, lastError: String(error?.message || 'unreachable').slice(0, 200) }).catch(() => {})
      log({ kind: 'cloud_library_failed', reason: String(error?.message || '').slice(0, 200) })
      return { ok: false, error: String(error?.message || 'unreachable') }
    }
  }

  /** The cards to serve: the last good copy, or none. */
  async function cards() {
    const doc = await store.get().catch(() => null)
    return Array.isArray(doc?.cards) ? doc.cards : []
  }

  async function status() {
    const doc = await store.get().catch(() => null)
    return { cards: Array.isArray(doc?.cards) ? doc.cards.length : 0, fetchedAt: doc?.fetchedAt || null, lastTriedAt: doc?.lastTriedAt || null, lastError: doc?.lastError || null }
  }

  return { sync, cards, status }
}
