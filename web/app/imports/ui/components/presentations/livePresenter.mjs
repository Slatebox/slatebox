// The live presenter: a deck played on a real SlateboxJS canvas, as a camera and a sequence over
// the slate as it is saved. The slate IS the presentation: its background, its notes and a worn
// style's art (title cards, captions, numbers, quotes, decoration) are real notes on it, and this
// player draws none of its own. It mounts a read-only engine, loads the slate unchanged (only made
// unclickable), and flies the engine's camera between the deck's steps (version 5: a box per step):
// Prezi arcs that pull back and come in, roll, deep zooms, a homecoming finale; it dims and reveals
// the slate's own notes. Nothing here reaches the slate, its room or its undo. Reduced motion cuts
// between framings with a short crossfade instead. Beside the canvas it shows only player chrome:
// the credit a searched picture's licence asks for, and words for a screen reader.
import { STYLES } from './presentationStyles.mjs'

const LOCKED = { allowDrag: false, allowMenu: false, allowContext: false, allowResize: false, showMenu: false }
const CALM_MOTION = { arc: 'prezi', pace: 1, reveal: 'fade', rollMax: 0 }

/** The motion a deck flies with: the worn style's (its camera, never its look), else a calm one. */
export function motionOf(deck) {
  const style = STYLES[deck?.style?.id]
  return { motion: style?.motion || CALM_MOTION, dim: style?.dim ?? 0.28 }
}

/**
 * The slate to play: the saved slate as it is (its own background, notes, art and lines), with
 * every note made unclickable and the view fixed. No field that draws anything is changed.
 */
export function presentedSlate(slateJSON) {
  const source = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : JSON.parse(JSON.stringify(slateJSON || {}))
  return {
    ...source,
    options: {
      ...(source.options || {}),
      viewPort: { ...(source.options?.viewPort || {}), allowDrag: false, showGrid: false, useInertiaScrolling: false },
      autoResizeNodesBasedOnText: false,
      showLocks: false,
    },
    nodes: (source.nodes || []).map((node) => ({ ...node, options: { ...(node.options || {}), ...LOCKED } })),
  }
}

/**
 * What each of the slate's notes shows on step `index`: 1 lit, the deck's dim, 0 for a worn
 * style's note of another step (revealed on its own step), decoration always (fainter on a deep
 * zoom). `ids` are the slate's note ids. → Map id → opacity.
 */
export function emphasis(deck, index, ids) {
  const step = deck.steps[index]
  const { dim: styleDim } = motionOf(deck)
  const dim = step?.dim ?? styleDim
  const lit = !step || step.lit === 'all' ? null : new Set(step.lit)
  const hidden = new Set(step?.hide || [])
  const decor = new Set(deck.decor || [])
  const out = new Map()
  ids.forEach((id) => {
    if (hidden.has(id)) out.set(id, 0)
    else if (decor.has(id)) out.set(id, step?.deep ? 0.35 : 1)
    else out.set(id, !lit || lit.has(id) ? 1 : dim)
  })
  return out
}

const CSS = `
.sbp-host{position:absolute;inset:0;overflow:hidden;overflow:clip;touch-action:pan-y pinch-zoom}
.sbp-roll{position:absolute;left:50%;top:50%;transform-origin:50% 50%;will-change:transform}
.sbp-canvas{width:100%;height:100%}
.sbp-canvas svg{pointer-events:none}
.sbp-canvas .connector-handle,.sbp-canvas .connector-handle-glyph,.sbp-canvas [data-resize-proxy]{display:none!important}
.sbp-canvas g[data-node-id],.sbp-canvas [data-source-node-id]{transition:opacity .65s ease}
.sbp-credit{position:absolute;right:clamp(12px,2vw,24px);bottom:calc(var(--sbp-inset,0px) + 8px);max-width:60vw;font:400 11px/1.3 system-ui,sans-serif;color:var(--sbp-ink,#fff);opacity:.62;pointer-events:none;z-index:3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sbp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.sbp-reduced .sbp-canvas g[data-node-id],.sbp-reduced .sbp-canvas [data-source-node-id]{transition:none}
`

function ensureStyles(doc) {
  if (doc.getElementById('sbp-css')) return
  const style = doc.createElement('style')
  style.id = 'sbp-css'
  style.textContent = CSS
  doc.head.appendChild(style)
}

const darkBackground = (color) => {
  const hex = String(color || '').trim().replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return false
  const n = parseInt(hex, 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128
}
const easeIn = (t) => t * t
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

/**
 * Mount the deck in `host` and play it. `Slatebox` is the engine's v1 facade (slateboxjs), so the
 * presenter uses the app's engine build. `deck` is a version 5 deck (presentationBake). →
 * controller { goTo(index, { instant }), index(), resize(), setInset(px), destroy(), slate }.
 * `onStep({ index, step, flying })` reports moves.
 */
export async function mountLiveDeck({ host, Slatebox, slateJSON, deck, reduced = null, onStep = null, name = '' }) {
  const doc = host.ownerDocument
  ensureStyles(doc)
  const { motion } = motionOf(deck)
  const prefersReduced = reduced ?? Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const calm = prefersReduced || motion.arc === 'cut'
  const size = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) })
  const presented = presentedSlate(slateJSON)
  // Around the rolled canvas the screen shows the slate's own background, read from the slate.
  const surface = presented.options?.containerStyle?.backgroundColor || '#ffffff'

  const root = doc.createElement('div')
  root.className = `sbp-host${calm ? ' sbp-reduced' : ''}`
  root.style.background = surface
  root.style.setProperty('--sbp-ink', darkBackground(surface) ? '#ffffff' : '#1b1b1b')
  const roll = doc.createElement('div')
  roll.className = 'sbp-roll'
  // The presented canvas is looked at, never used: nothing in it takes focus (a focused note
  // would scroll the page under the camera), and the keys stay with the presenter.
  roll.inert = true
  roll.setAttribute('inert', '')
  const canvas = doc.createElement('div')
  canvas.className = 'sbp-canvas'
  canvas.id = `sbp-canvas-${Math.random().toString(36).slice(2, 10)}`
  roll.appendChild(canvas)
  root.appendChild(roll)
  // What a screen reader hears on each step: the step's place, its words and the notes it lights.
  const spoken = doc.createElement('div')
  spoken.className = 'sbp-sr'
  spoken.setAttribute('aria-live', 'polite')
  spoken.setAttribute('aria-atomic', 'true')
  spoken.setAttribute('data-presentation-spoken', '')
  // The sources of the searched pictures on this step (their licence asks for attribution).
  const credit = doc.createElement('div')
  credit.className = 'sbp-credit'
  credit.setAttribute('data-presentation-credit', '')
  root.append(spoken, credit)
  host.appendChild(root)

  let side = 0
  const layoutHost = () => {
    const { w, h } = size()
    side = Math.ceil(Math.hypot(w, h)) + 4
    Object.assign(roll.style, { width: `${side}px`, height: `${side}px`, marginLeft: `${-side / 2}px`, marginTop: `${-side / 2}px` })
  }
  layoutHost()

  const facade = await new Slatebox.slate({
    container: canvas.id,
    containerStyle: presented.options?.containerStyle || {},
    viewPort: { allowDrag: false, useInertiaScrolling: false, showGrid: false },
    name: name || 'Presentation',
    showbirdsEye: false, showMultiSelect: false, showUndoRedo: false, showZoom: false, showLocks: false, showAddNodes: false,
    allowCollaboration: false, autoResizeNodesBasedOnText: false,
  }, { onInitCollaboration: async () => null, onCanvasClicked: () => {} }).init()
  const slate = facade.v2 || facade
  // The engine behind the stage, for checks that read the notes as drawn (never enumerable).
  Object.defineProperty(root, 'sbpSlate', { value: slate, configurable: true })
  await slate.loadJSON(presented, false, true)
  try { slate.disablePanZoom?.() } catch { /* already off */ }
  // The faces the notes are drawn in, as the canvas loads them (the slate's own fonts).
  try { await slate.loadAllFonts?.() } catch { /* fonts are a nicety */ }
  try { await doc.fonts?.ready } catch { /* ignore */ }
  slate.nodes?.allNodes?.forEach((node) => { try { node.centerText?.() } catch { /* a note without words */ } })

  const camera = slate.camera
  camera.configure({ viewport: size, rollHost: roll, hostSide: side })
  const nodeEl = (id) => slate.nodes?.one?.(id)?.svgGroup?.node || canvas.querySelector(`g[data-node-id="${id}"]`)
  const ids = presented.nodes.map((node) => String(node.options?.id)).filter((id) => id && id !== 'undefined')

  let current = -1
  let flight = null
  // What the host's own controls cover along the bottom: the camera keeps above it.
  let inset = 0

  function targetFor(index) {
    const step = deck.steps[index]
    const cam = step.camera || {}
    const box = step.box || { x: 0, y: 0, width: 1, height: 1 }
    return {
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      fill: cam.fill ?? 0.86,
      cover: Boolean(cam.cover),
      roll: calm ? 0 : cam.roll || 0,
      bottom: cam.cover ? inset : 70 + inset,
      top: cam.cover ? 0 : 64,
      maxScale: step.deep ? 60 : 8,
    }
  }

  // Each note's and line's opacity as last written: a step writes only what changes, so a flight
  // repaints a few notes, not every one on the slate.
  const shown = new Map()
  let lines = null
  const setOpacity = (el, key, value) => {
    const text = String(value)
    if (shown.get(key) === text) return
    shown.set(key, text)
    el.style.opacity = text
  }
  function paint(index, { hideOwn = false } = {}) {
    const levels = emphasis(deck, index, ids)
    const own = new Set(deck.steps[index]?.own || [])
    levels.forEach((level, id) => {
      const el = nodeEl(id)
      if (!el) return
      const value = hideOwn && own.has(id) ? 0 : level
      if (shown.get(id) !== String(value)) el.style.transitionDelay = '0ms'
      setOpacity(el, id, value)
    })
    const step = deck.steps[index]
    const set = !step || step.lit === 'all' ? null : new Set(step.lit)
    const { dim } = motionOf(deck)
    lines = lines || [...canvas.querySelectorAll('[data-source-node-id]')]
    lines.forEach((line, k) => {
      const on = !set || (set.has(line.getAttribute('data-source-node-id')) && set.has(line.getAttribute('data-target-node-id')))
      setOpacity(line, `line:${k}`, on ? 1 : step?.dim ?? dim)
    })
    return own
  }

  // The step's own notes (a worn style's cards and captions) come in once the camera lands.
  function reveal(index, own) {
    const levels = emphasis(deck, index, ids)
    ;[...own].forEach((id, k) => {
      const el = nodeEl(id)
      if (!el) return
      el.style.transitionDelay = calm ? '0ms' : `${k * (motion.reveal === 'pop' ? 70 : 120)}ms`
      setOpacity(el, id, levels.get(id))
    })
  }

  const textOf = new Map(presented.nodes.filter((node) => node.options?.text && !(deck.decor || []).includes(String(node.options.id))).map((node) => [String(node.options.id), String(node.options.text)]))
  function speak(index) {
    const step = deck.steps[index]
    if (!step) return
    const lit = step.lit === 'all' ? [] : step.lit
    const said = [...new Set(lit.map((id) => textOf.get(id)).filter(Boolean))].slice(0, 12)
    spoken.textContent = [`Step ${index + 1} of ${deck.steps.length}.`, said.length ? `On screen: ${said.join('; ')}.` : ''].filter(Boolean).join(' ')
  }
  function showCredit(index) {
    const names = deck.steps[index]?.credits || []
    credit.textContent = names.length ? `Pictures: ${names.join(', ')}` : ''
  }

  async function goTo(index, { instant = false } = {}) {
    if (!deck.steps[index]) return
    const from = current
    current = index
    const step = deck.steps[index]
    const target = targetFor(index)
    const pace = motion.pace || 1
    onStep?.({ index, step, flying: true })
    showCredit(index)
    if (instant || calm || from < 0) {
      paint(index)
      if (!instant && calm && from >= 0) root.animate?.([{ opacity: 0.15 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
      await camera.flyTo(target, { arc: 'cut', reduced: calm })
      speak(index)
      onStep?.({ index, step, flying: false })
      return
    }
    const own = paint(index, { hideOwn: true })
    const controller = new AbortController()
    flight?.abort()
    flight = controller
    try {
      if (step.camera?.via === 'overview' && deck.steps[1]?.layout === 'overview') {
        // Homecoming: out through the whole map, then down onto the opening bookend.
        const over = targetFor(1)
        await camera.flyTo({ ...over, roll: (over.roll + target.roll) / 2 }, { arc: 'direct', duration: 1100 * pace, ease: easeIn, signal: controller.signal })
        await camera.flyTo(target, { arc: 'direct', duration: 1300 * pace, ease: easeOut, signal: controller.signal })
      } else {
        const now = camera.current()
        const to = camera.resolve(target)
        const auto = now && to ? Math.min(2200, 900 + Math.hypot(to.cx - now.cx, to.cy - now.cy) * Math.min(now.scale, to.scale) / Math.max(1, Math.min(size().w, size().h)) * 280 + Math.abs(Math.log(to.scale / now.scale)) * 220) : 1200
        await camera.flyTo(target, { arc: motion.arc === 'direct' ? 'direct' : 'prezi', duration: (step.deep ? auto * 1.15 : auto) * pace, signal: controller.signal })
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      throw error
    }
    if (current !== index) return
    reveal(index, own)
    speak(index)
    onStep?.({ index, step, flying: false })
  }

  function resize() {
    layoutHost()
    camera.configure({ hostSide: side })
    if (current >= 0) camera.flyTo(targetFor(current), { arc: 'cut' })
  }

  function destroy() {
    flight?.abort()
    try { camera.stop() } catch { /* gone */ }
    try { facade.destroy?.() ?? slate.destroy?.() } catch { /* gone */ }
    root.remove()
  }

  function setInset(px) {
    const next = Math.max(0, Math.round(Number(px) || 0))
    if (next === inset) return
    inset = next
    root.style.setProperty('--sbp-inset', `${inset}px`)
    if (current >= 0) camera.flyTo(targetFor(current), { arc: 'cut' })
  }

  return { goTo, index: () => current, resize, setInset, destroy, slate, reduced: calm }
}
