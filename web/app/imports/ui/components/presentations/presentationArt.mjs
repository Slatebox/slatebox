// Pictures made from a style's palette, with no network, key or credit: the fallback for every
// image a presentation asks for (search and generation are tried first; see presentationImages).
// Each is an SVG data URL a note uses as its image fill, so the deck always looks finished.
import { rng } from './presentationPaths.mjs'

/** A stable number for a string (a seed). */
export function hashText(text) {
  return Array.from(String(text || '')).reduce((value, char) => (value * 31 + char.codePointAt(0)) >>> 0, 7)
}

const f = (n) => Math.round(n * 10) / 10
const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

function planet(r, [a, b, c, d], bg, w, h) {
  const cx = w * (0.35 + r() * 0.3)
  const cy = h * (0.4 + r() * 0.2)
  const rad = Math.min(w, h) * (0.26 + r() * 0.08)
  let stars = ''
  for (let i = 0; i < 70; i += 1) stars += `<circle cx="${f(r() * w)}" cy="${f(r() * h)}" r="${f(0.6 + r() * 1.8)}" fill="#fff" opacity="${f(0.25 + r() * 0.7)}"/>`
  return `<defs><radialGradient id="p" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${b}"/><stop offset=".55" stop-color="${a}"/><stop offset="1" stop-color="${bg}"/></radialGradient>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${d}" stop-opacity=".55"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#s)"/>${stars}
<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rad * 1.9)}" ry="${f(rad * 0.42)}" fill="none" stroke="${c}" stroke-width="${f(rad * 0.08)}" opacity=".85" transform="rotate(-14 ${f(cx)} ${f(cy)})"/>
<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rad)}" fill="url(#p)"/>
<path d="M${f(cx - rad * 1.9)},${f(cy)} A${f(rad * 1.9)},${f(rad * 0.42)} 0 0 0 ${f(cx + rad * 1.9)},${f(cy)}" fill="none" stroke="${c}" stroke-width="${f(rad * 0.08)}" transform="rotate(-14 ${f(cx)} ${f(cy)})"/>
<circle cx="${f(cx + rad * 1.7)}" cy="${f(cy - rad * 1.1)}" r="${f(rad * 0.16)}" fill="${d}"/>`
}

function sunburst(r, [a, b, c], bg, w, h) {
  const cx = w * (0.2 + r() * 0.6)
  const cy = h * (0.75 + r() * 0.2)
  const rays = 18
  let out = `<rect width="${w}" height="${h}" fill="${bg}"/>`
  for (let i = 0; i < rays; i += 1) {
    const a0 = (i / rays) * Math.PI * 2
    const a1 = ((i + 0.5) / rays) * Math.PI * 2
    const R = Math.hypot(w, h)
    out += `<path d="M${f(cx)},${f(cy)} L${f(cx + Math.cos(a0) * R)},${f(cy + Math.sin(a0) * R)} L${f(cx + Math.cos(a1) * R)},${f(cy + Math.sin(a1) * R)} Z" fill="${i % 2 ? a : b}" opacity=".9"/>`
  }
  return `${out}<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.min(w, h) * 0.22)}" fill="${c}"/><circle cx="${f(cx)}" cy="${f(cy)}" r="${f(Math.min(w, h) * 0.13)}" fill="${bg}"/>`
}

function waves(r, palette, bg, w, h) {
  let out = `<rect width="${w}" height="${h}" fill="${bg}"/>`
  const bands = 5
  for (let i = 0; i < bands; i += 1) {
    const y0 = h * (0.25 + i * 0.16)
    const amp = h * (0.05 + r() * 0.06)
    const k = 1.5 + r() * 2
    let d = `M0,${f(y0)}`
    for (let x = 0; x <= w; x += w / 24) d += ` L${f(x)},${f(y0 + Math.sin((x / w) * Math.PI * k + i) * amp)}`
    out += `<path d="${d} L${w},${h} L0,${h} Z" fill="${palette[i % palette.length]}" opacity="${f(0.75 + i * 0.05)}"/>`
  }
  return out
}

function terrain(r, palette, bg, w, h) {
  let out = `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette[3]}"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#sky)"/>`
  out += `<circle cx="${f(w * (0.6 + r() * 0.3))}" cy="${f(h * 0.28)}" r="${f(h * 0.1)}" fill="${palette[1]}"/>`
  for (let i = 0; i < 4; i += 1) {
    const base = h * (0.45 + i * 0.14)
    let d = `M0,${h} L0,${f(base)}`
    for (let x = 0; x <= w; x += w / 8) d += ` L${f(x)},${f(base - r() * h * 0.18)}`
    out += `<path d="${d} L${w},${h} Z" fill="${palette[(i + 2) % palette.length]}" opacity="${f(0.6 + i * 0.12)}"/>`
  }
  const path = `M${f(w * 0.05)},${f(h * 0.95)} C${f(w * 0.4)},${f(h * 0.7)} ${f(w * 0.3)},${f(h * 0.55)} ${f(w * 0.75)},${f(h * 0.5)}`
  return `${out}<path d="${path}" fill="none" stroke="#fff" stroke-width="${f(h * 0.015)}" stroke-dasharray="${f(h * 0.03)} ${f(h * 0.025)}" stroke-linecap="round"/>`
}

function grid(r, palette, bg, w, h) {
  const step = Math.round(Math.min(w, h) / 12)
  let out = `<rect width="${w}" height="${h}" fill="${bg}"/>`
  for (let x = 0; x <= w; x += step) out += `<path d="M${x},0 V${h}" stroke="#fff" stroke-opacity="${x % (step * 4) ? 0.12 : 0.3}"/>`
  for (let y = 0; y <= h; y += step) out += `<path d="M0,${y} H${w}" stroke="#fff" stroke-opacity="${y % (step * 4) ? 0.12 : 0.3}"/>`
  const cx = w * (0.3 + r() * 0.4)
  const cy = h * (0.35 + r() * 0.3)
  out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(step * 2.6)}" fill="none" stroke="${palette[1]}" stroke-width="3"/>`
  out += `<rect x="${f(cx - step * 5)}" y="${f(cy + step * 1.2)}" width="${step * 4}" height="${step * 2}" fill="none" stroke="#fff" stroke-width="3"/>`
  out += `<path d="M${f(cx - step * 1)},${f(cy + step * 2.2)} H${f(cx + step * 4)} V${f(cy - step * 2)}" fill="none" stroke="${palette[1]}" stroke-width="3" stroke-dasharray="10 8"/>`
  return out
}

function confetti(r, palette, bg, w, h) {
  let out = `<rect width="${w}" height="${h}" fill="${bg}"/>`
  for (let i = 0; i < 26; i += 1) {
    const x = r() * w
    const y = r() * h
    const s = Math.min(w, h) * (0.04 + r() * 0.1)
    const c = palette[i % palette.length]
    const k = i % 3
    if (k === 0) out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(s / 2)}" fill="${c}" stroke="#222" stroke-width="3"/>`
    else if (k === 1) out += `<rect x="${f(x)}" y="${f(y)}" width="${f(s)}" height="${f(s * 0.7)}" rx="6" fill="${c}" stroke="#222" stroke-width="3" transform="rotate(${f(r() * 40 - 20)} ${f(x)} ${f(y)})"/>`
    else out += `<path d="M${f(x)},${f(y)} q${f(s / 2)},${f(-s / 2)} ${f(s)},0 t${f(s)},0" fill="none" stroke="#222" stroke-width="4" stroke-linecap="round"/>`
  }
  return out
}

function halftone(r, [a, b], bg, w, h) {
  let out = `<rect width="${w}" height="${h}" fill="${bg}"/>`
  const step = Math.round(Math.min(w, h) / 22)
  const cx = w * (0.3 + r() * 0.4)
  const cy = h * (0.3 + r() * 0.4)
  const R = Math.hypot(w, h) * 0.55
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const k = 1 - Math.min(1, Math.hypot(x - cx, y - cy) / R)
      if (k > 0.05) out += `<circle cx="${f(x)}" cy="${f(y)}" r="${f((step / 2) * k)}" fill="${a}"/>`
    }
  }
  return `${out}<rect x="${f(w * 0.08)}" y="${f(h * 0.7)}" width="${f(w * 0.3)}" height="${f(h * 0.06)}" fill="${b}"/>`
}

function gradientField(r, palette, bg, w, h) {
  const a = palette[Math.floor(r() * palette.length)]
  const b = palette[Math.floor(r() * palette.length)]
  return `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="${bg}"/><rect width="${w}" height="${h}" fill="url(#g)" opacity=".85"/>
<circle cx="${f(w * 0.78)}" cy="${f(h * 0.3)}" r="${f(h * 0.32)}" fill="#fff" opacity=".12"/><circle cx="${f(w * 0.2)}" cy="${f(h * 0.85)}" r="${f(h * 0.4)}" fill="#000" opacity=".12"/>`
}

function spotlight(r, [a, b], bg, w, h) {
  const cx = w * (0.55 + r() * 0.25)
  let rings = ''
  for (let i = 1; i <= 6; i += 1) rings += `<ellipse cx="${f(cx)}" cy="${f(h * 0.86)}" rx="${f(w * 0.09 * i)}" ry="${f(h * 0.022 * i)}" fill="none" stroke="${a}" stroke-opacity="${f(0.5 - i * 0.06)}" stroke-width="2"/>`
  return `<defs><radialGradient id="beam" cx="${f(cx / w * 100)}%" cy="0%" r="95%"><stop offset="0" stop-color="${a}" stop-opacity=".75"/><stop offset=".45" stop-color="${a}" stop-opacity=".18"/><stop offset="1" stop-color="${bg}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="${bg}"/><path d="M${f(cx - w * 0.06)},0 L${f(cx + w * 0.06)},0 L${f(cx + w * 0.42)},${f(h * 0.88)} L${f(cx - w * 0.42)},${f(h * 0.88)} Z" fill="url(#beam)"/>${rings}
<ellipse cx="${f(cx)}" cy="${f(h * 0.86)}" rx="${f(w * 0.3)}" ry="${f(h * 0.05)}" fill="${a}" opacity=".35"/><circle cx="${f(w * 0.12)}" cy="${f(h * 0.16)}" r="${f(h * 0.012)}" fill="${b}"/>`
}

const KINDS = { spotlight, planet, sunburst, waves, terrain, grid, confetti, halftone, gradient: gradientField }
export const ART_KINDS = Object.keys(KINDS)

/**
 * A picture for `seedText` (the image's query or the note it shows) in a style's palette: `kind`
 * is the style's art (planet, sunburst, waves, terrain, grid, confetti, halftone, gradient).
 * → an SVG data URL, 1200 by 800 unless sized.
 */
export function artImage({ kind = 'gradient', palette = ['#ff4d8d', '#ffb627', '#3ddc97', '#4cc9f0'], bg = '#111', seedText = '', width = 1200, height = 800 } = {}) {
  const draw = KINDS[kind] || gradientField
  const base = palette.length >= 4 ? palette : [...palette, ...palette, ...palette, ...palette].slice(0, 4)
  // Each picture leads with a different colour of the palette, so a deck's pictures differ.
  const shift = hashText(seedText) % base.length
  const colors = [...base.slice(shift), ...base.slice(0, shift)]
  const body = draw(rng(hashText(`${kind}:${seedText}`)), colors.map((c) => String(c).split('-')[0]), bg, width, height)
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`)
}

/** Whether an image is the procedural art (a data URL this module made). */
export const isArt = (url) => typeof url === 'string' && url.startsWith('data:image/svg+xml')
