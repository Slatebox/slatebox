// The faces a slate's notes are written in, loaded before the engine draws them. The engine wraps a
// note's words (and grows a plain note to fit them) with the face it has when the note is drawn: a
// face still loading measures as the fallback, so the same slate wrapped one way on the canvas and
// another in the player. The canvas (createSlate) and the player (livePresenter, also the site's
// player) both wait here, so both draw every note in its own face and wrap its words the same way.
//
// Only faces the page declares itself (its own @font-face: the app's and the site's fonts.css)
// are waited for; nothing is fetched from a font host. A face that does not arrive within
// `timeoutMs` is not waited for any longer.

const familyOf = (value) => String(value || '').split(',')[0].replace(/['"]/g, '').trim()

/** The font shorthands (style, weight, family) the slate's notes are drawn in, among `declared` families. */
export function slateFaces(slateJSON, declared) {
  let json = slateJSON
  if (typeof json === 'string') {
    try { json = JSON.parse(json) } catch { return [] }
  }
  const wanted = new Set()
  for (const node of json?.nodes || []) {
    const o = node?.options || {}
    const family = familyOf(o.fontFamily)
    if (!family || !declared.has(family.toLowerCase())) continue
    // The weight and style the engine draws with (Node.textWeight: only "bold" is bold).
    wanted.add(`${o.fontStyle === 'italic' ? 'italic ' : ''}${o.fontWeight === 'bold' ? 'bold ' : ''}16px "${family}"`)
  }
  return [...wanted]
}

/** Load the declared faces `slateJSON`'s notes use; resolves when they are in (or after `timeoutMs`). */
export async function loadSlateFaces(slateJSON, { doc = globalThis.document, timeoutMs = 3000 } = {}) {
  const fonts = doc?.fonts
  if (!fonts || typeof fonts.load !== 'function' || typeof fonts.forEach !== 'function') return
  const declared = new Set()
  try {
    fonts.forEach((face) => declared.add(familyOf(face?.family).toLowerCase()))
  } catch {
    return
  }
  const wanted = slateFaces(slateJSON, declared)
  if (!wanted.length) return
  let timer = null
  await Promise.race([
    Promise.all(wanted.map((font) => Promise.resolve(fonts.load(font)).catch(() => null))),
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
  ])
  clearTimeout(timer)
}
