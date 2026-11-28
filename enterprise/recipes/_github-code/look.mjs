// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// How the GitHub recipes' notes look: a shape and colors per kind of thing (the engine's own
// shapes: a store is an ellipse, a queue a parallelogram, something outside a hexagon, a way in an
// arrow), tiers for the layered service map, owner colors, and the change colors of a PR's impact.

export const SHAPES = Object.freeze({ service: 'roundedrectangle', function: 'roundedrectangle', store: 'ellipse', queue: 'parallelogram', external: 'hexagon', ingress: 'rarrow', module: 'rectangle' })
export const TIERS = Object.freeze({ ingress: 0, service: 1, function: 1, queue: 2, store: 3, external: 4 })

const look = (backgroundColor, borderColor, foregroundColor = '#0f172a') => Object.freeze({ backgroundColor, borderColor, foregroundColor })
export const KIND_COLORS = Object.freeze({
  service: look('#dbeafe', '#2563eb'),
  function: look('#e0f2fe', '#0284c7'),
  store: look('#dcfce7', '#16a34a'),
  queue: look('#fef3c7', '#d97706'),
  external: look('#f1f5f9', '#64748b'),
  ingress: look('#ede9fe', '#7c3aed'),
})
export const OWNER_COLORS = Object.freeze([
  look('#dbeafe', '#2563eb'), look('#dcfce7', '#16a34a'), look('#fce7f3', '#db2777'), look('#fef3c7', '#d97706'),
  look('#ede9fe', '#7c3aed'), look('#cffafe', '#0891b2'), look('#ffedd5', '#ea580c'), look('#e2e8f0', '#475569'),
])
export const MODULE_COLOR = look('#f8fafc', '#334155')
export const IMPACT = Object.freeze({
  added: look('#dcfce7', '#16a34a'),
  touched: look('#fef3c7', '#d97706'),
  removed: look('#fee2e2', '#dc2626'),
  blast: look('#f1f5f9', '#94a3b8', '#475569'),
})
export const LINE = Object.freeze({
  cycle: { lineColor: '#dc2626', lineWidth: 4 },
  added: { lineColor: '#16a34a', lineWidth: 5 },
  removed: { lineColor: '#dc2626', lineWidth: 3, lineOpacity: 0.6 },
})
/** A line's width for how many imports it stands for: 2 for one, up to 8. */
export const weightWidth = (weight) => Math.min(8, Math.round((2 + Math.log2(Math.max(1, weight)) * 1.5) * 10) / 10)

/** The same owner always gets the same color (ordered by name). */
export function ownerColors(owners) {
  const sorted = [...new Set(owners.filter(Boolean))].sort()
  return new Map(sorted.map((o, k) => [o, OWNER_COLORS[k % OWNER_COLORS.length]]))
}

export const shortSha = (sha) => `${sha ?? ''}`.slice(0, 7)
export const blobUrl = (repo, sha, file, line) => `https://github.com/${repo}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`
export const commitUrl = (repo, sha) => `https://github.com/${repo}/commit/${sha}`
export const pullUrl = (repo, number) => `https://github.com/${repo}/pull/${number}`
