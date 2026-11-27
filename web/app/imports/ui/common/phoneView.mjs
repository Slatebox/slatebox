// Phones view slates; they do not make or change them. A touch screen whose shorter side is under
// 600px (a phone, upright or on its side) gets the view-only canvas and the app banner. A narrow or
// short desktop window still edits (it has a fine pointer), and so does a tablet.
export const PHONE_SHORT_SIDE = 600

export function isPhoneView({ width, height, coarse }) {
  return Boolean(coarse) && Math.min(Number(width), Number(height)) < PHONE_SHORT_SIDE
}

export function readPhoneView(win) {
  if (!win) return false
  return isPhoneView({
    width: win.innerWidth,
    height: win.innerHeight,
    coarse: win.matchMedia?.('(pointer: coarse)')?.matches,
  })
}

// Calls cb whenever the answer may have changed: a resize, a turn of the phone, or a change of the
// primary pointer (a keyboard and trackpad attached to a tablet). Returns the unsubscribe.
export function subscribePhoneView(win, cb) {
  if (!win) return () => {}
  const query = win.matchMedia?.('(pointer: coarse)')
  win.addEventListener('resize', cb)
  win.addEventListener('orientationchange', cb)
  query?.addEventListener?.('change', cb)
  return () => {
    win.removeEventListener('resize', cb)
    win.removeEventListener('orientationchange', cb)
    query?.removeEventListener?.('change', cb)
  }
}

export const PHONE_BANNER_KEY = 'slatebox:phone-banner'

const STORES = [
  { key: 'appStoreUrl', label: 'Download on the App Store' },
  { key: 'playStoreUrl', label: 'Get it on Google Play' },
]

function storeHref(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

function dismissed(storage) {
  try {
    return storage?.getItem?.(PHONE_BANNER_KEY) === 'dismissed'
  } catch {
    return false
  }
}

// What the phone banner says, or null once it was dismissed. The store buttons come from
// settings.public.mobile; until the app is listed there are none and the banner says it is coming.
export function phoneBanner({ settings, storage } = {}) {
  if (dismissed(storage)) return null
  const mobile = settings?.public?.mobile ?? {}
  const stores = STORES.map(({ key, label }) => ({ label, href: storeHref(mobile[key]) })).filter((store) => store.href)
  const soon = stores.length === 0
  return {
    text: 'Slatebox works best in the app. Viewing only on phones.',
    editLine: 'Open on a computer to edit.',
    stores,
    soon,
    soonLine: soon ? 'The iPhone and Android app is coming soon.' : null,
  }
}

// Remembers the dismissal where storage allows. Blocked storage (a private window) still closes
// the banner for this visit: the caller hides it either way.
export function dismissPhoneBanner(storage) {
  try {
    storage?.setItem?.(PHONE_BANNER_KEY, 'dismissed')
  } catch {
    /* blocked storage: closed for this visit only */
  }
}

export const PHONE_GATE_COPY = {
  line: 'Creating slates needs a bigger screen. Open Slatebox on a computer or tablet to start one.',
  signedIn: { label: 'Open My slates', to: '/' },
  signedOut: { label: 'Browse the library', to: '/library' },
}

export const PHONE_CANVAS_WELCOME = 'You can view this slate here. Open it on a computer to edit.'
