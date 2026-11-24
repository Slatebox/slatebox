// Which of a team's brand-kit items is the one in use, the same answer for the brand kit page and the
// server (published presentations, AI-made slates). A team that used the old branding page can have several logo
// documents of one kind (removing a logo there never worked), so "the first one Mongo returns" is not
// an answer: the logo in use is the newest one that is not removed and has a file.

const when = (doc) => {
  const t = doc?.updatedAt || doc?.createdAt || doc?.uploadedAt || 0
  const n = t instanceof Date ? t.getTime() : Number(t)
  return Number.isFinite(n) ? n : 0
}

const newestFirst = (a, b) => when(b) - when(a)

/** The team's logo of a kind ('squareLogo' or 'primaryLogo') in use: newest, not removed, with a url. */
export function currentLogo(settings, logoType) {
  return (settings || [])
    .filter((s) => s?.type === 'logo' && s.value?.logoType === logoType && !s.deleted && s.value?.url)
    .sort(newestFirst)[0] || null
}

/** Every logo document of a kind, newest first (the page edits the newest, so both sides agree). */
export function logoDocs(settings, logoType) {
  return (settings || []).filter((s) => s?.type === 'logo' && s.value?.logoType === logoType).sort(newestFirst)
}

/**
 * The brand kit has one style for every slate: the team's default preset. This is how the server
 * asks for it; presets stored for one kind of AI-made slate are left alone and never read.
 */
export const DEFAULT_PRESET_QUERY = Object.freeze({ type: 'preset', intentionId: 'default' })

/** The team's one slate style in use: the newest default preset not removed, or null. */
export function defaultPreset(settings) {
  return (settings || [])
    .filter((s) => s?.type === 'preset' && s.intentionId === 'default' && !s.deleted && s.value)
    .sort(newestFirst)[0] || null
}
