// The "Made with Slatebox" mark on what people share (owner, 2026-11-27): a small link in a bottom
// corner of every shared or public surface, never on the canvas someone edits. Pure: no Meteor.
//
// Where it shows (MADE_WITH_SURFACES, the `from` of its link):
// - share: a slate opened by someone outside the slate's team (a public or shared link);
// - embed: a slate drawn inside another site (always, whoever looks);
// - present: a published presentation (/present/:shareId);
// - follow: following someone else's live presentation;
// - library: a published library item (/library/:slug), a public page: shown to whoever opens it.
//
// Slatebox Cloud always shows it. A self-hosted server shows it until its administrator switches it
// off (Admin › Overview); its link still goes to slatebox.com.

export const MADE_WITH_TEXT = 'Made with Slatebox · free and open source'
export const MADE_WITH_LABEL = 'Made with Slatebox, free and open source. Opens slatebox.com in a new tab.'
export const MADE_WITH_ORIGIN = 'https://slatebox.com/'
export const MADE_WITH_SURFACES = Object.freeze(['share', 'embed', 'present', 'follow', 'library'])
// The systemSettings row a self-hosted server keeps the administrator's choice in.
export const MADE_WITH_ROW = 'madeWithMark'

// What the admin card says (self-host only: no price, plan or payment words).
export const MADE_WITH_ADMIN = Object.freeze({
  title: 'Made with Slatebox mark',
  detail: 'A small "Made with Slatebox" link in a corner of shared slates, embeds, presentations and library items. It is never on a slate someone edits.',
  on: 'Shown on shared slates',
  off: 'Hidden on shared slates',
})

/** The mark's link, with where it was seen: https://slatebox.com/?ref=made-with&from=<surface>. */
export function madeWithHref(surface) {
  const from = MADE_WITH_SURFACES.includes(surface) ? surface : 'share'
  const url = new URL(MADE_WITH_ORIGIN)
  url.searchParams.set('ref', 'made-with')
  url.searchParams.set('from', from)
  return url.toString()
}

/**
 * Whether this server shows the mark at all. Cloud: always (there is no way to hide it for now).
 * A self-hosted server: unless its administrator hid it. → { enabled, canHide }
 */
export function madeWithPolicy({ cloud = false, hidden = false } = {}) {
  if (cloud) return { enabled: true, canHide: false }
  return { enabled: hidden !== true, canHide: true }
}

/**
 * Whether one surface shows the mark to the person looking at it.
 * - enabled: this server's policy (madeWithPolicy);
 * - embedded: drawn inside another site (shown whoever looks);
 * - isOwner: the person made it (the slate's owner, the item's author, the presenter);
 * - sameTeam: the person is in the team the slate belongs to (their own team's canvas);
 * - editing: the person can change it here (an edit link, a joined workshop): never while they work on it;
 * - loading: who is looking is not known yet (signed in, their account not here): wait rather than flash it.
 * A shared or public surface shows it to everyone else who only views it, guests and other teams alike.
 */
export function showMadeWith({ enabled = true, surface, embedded = false, isOwner = false, sameTeam = false, editing = false, loading = false } = {}) {
  if (!enabled || editing || loading || !MADE_WITH_SURFACES.includes(surface)) return false
  if (embedded || surface === 'embed') return true
  return !isOwner && !sameTeam
}

/** The surface a slate page is: an embed, or a slate opened from a share link. */
export const canvasSurface = ({ embedded = false } = {}) => (embedded ? 'embed' : 'share')

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

// A server-drawn page (a self-hosted server's /embed/<shareId>): the mark in a slim strip of its own under
// the picture, so it covers none of it. Plain HTML and inline style (the page's CSP allows only those).
export const MADE_WITH_STRIP_PX = 28
export const MADE_WITH_STRIP_STYLE = `.sb-made-with{position:fixed;left:0;right:0;bottom:0;height:${MADE_WITH_STRIP_PX}px;display:flex;align-items:center;padding:0 10px;` +
  'box-sizing:border-box;font:500 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fffef8;border-top:1px solid rgba(25,60,47,.14)}' +
  '.sb-made-with a{color:#193c2f;text-decoration:none}.sb-made-with a:hover,.sb-made-with a:focus-visible{text-decoration:underline}' +
  '@media (prefers-color-scheme:dark){.sb-made-with{background:#121212;border-top-color:rgba(255,255,255,.16)}.sb-made-with a{color:#f4f1e8}}'

/** The strip's HTML: a link to slatebox.com in a new tab (rel noopener), with the mark's words. */
export function madeWithStripHtml(surface) {
  return `<div class="sb-made-with"><a href="${escapeHtml(madeWithHref(surface))}" target="_blank" rel="noopener" ` +
    `aria-label="${escapeHtml(MADE_WITH_LABEL)}" data-made-with="${escapeHtml(surface)}">${escapeHtml(MADE_WITH_TEXT)}</a></div>`
}
