// The live presenter: a styled deck played on a real SlateboxJS canvas. It mounts a read-only
// engine of its own, loads a copy of the slate with the style's skin on its notes (same notes,
// same centres) and the deck's stage notes (real notes with custom SVG path shapes and pictures),
// and flies the engine's camera between the steps: Prezi arcs that pull back and come in, roll,
// deep zooms, a homecoming finale. The copy is never saved: nothing here reaches the slate, its
// room or its undo. Reduced motion cuts between framings with a short crossfade instead.
import { frameBox, showsOn } from './presentationCompose.mjs'
import { resolveStyle } from './presentationStyles.mjs'

const STAGE_ONLY = new Set(['kind', 'steps', 'p', 'deco', 'detail', 'behind', 'why', 'art', 'w', 'h'])
const LOCKED = { allowDrag: false, allowMenu: false, allowContext: false, allowResize: false, showMenu: false }

/** The stage notes as engine notes, in landscape or portrait geometry. */
export function stageNodes(deck, { portrait = false } = {}) {
  return deck.stageNotes.map((note) => {
    const g = portrait && note.p ? note.p : note
    const options = { text: '', borderWidth: 0, ...LOCKED }
    Object.entries(note).forEach(([key, value]) => { if (!STAGE_ONLY.has(key)) options[key] = value })
    Object.assign(options, { id: note.id, x: g.x, y: g.y, width: g.w, height: g.h })
    if (portrait && note.p?.fontSize) options.fontSize = note.p.fontSize
    if (note.image) Object.assign(options, { imageOrigWidth: g.w, imageOrigHeight: g.h, imageFit: note.imageFit || 'cover' })
    return { options, relationships: { associations: [] } }
  })
}

/**
 * The slate to play: a copy of `slateJSON` with the style on its notes and lines, the deck's stage
 * notes around it (decoration and backdrops behind the slate, the rest on top), every note locked.
 */
export function presentedSlate(slateJSON, deck, { portrait = false } = {}) {
  const source = typeof slateJSON === 'string' ? JSON.parse(slateJSON) : JSON.parse(JSON.stringify(slateJSON || {}))
  const style = resolveStyle(deck.style)
  const nodes = (source.nodes || []).map((node) => {
    const options = { ...(node.options || {}) }
    const look = deck.skin[options.id]
    if (look) {
      if (look.vectorPath) { delete options.shape; delete options.shapeHint }
      if (look.shape) { delete options.vectorPath }
      if (!look.image) { delete options.image }
      delete options.backgroundImage
      Object.assign(options, look, { xPos: look.x, yPos: look.y, foregroundColor: look.fontColor ?? options.fontColor })
      if (look.shape) options.shapeHint = look.shape
    }
    Object.assign(options, LOCKED)
    const associations = (node.relationships?.associations || []).map((assoc) => ({ ...assoc, ...(deck.lines[`${assoc.parentId}->${assoc.childId}`] || {}) }))
    return { ...node, options, relationships: { ...(node.relationships || {}), associations } }
  })
  const stage = stageNodes(deck, { portrait })
  const behind = new Set(deck.stageNotes.filter((note) => note.behind || note.deco).map((note) => note.id))
  return {
    ...source,
    options: {
      ...(source.options || {}),
      containerStyle: { ...(source.options?.containerStyle || {}), backgroundColor: style.bg, backgroundImage: null, backgroundColorAsGradient: false },
      viewPort: { ...(source.options?.viewPort || {}), allowDrag: false, showGrid: false, useInertiaScrolling: false },
      autoResizeNodesBasedOnText: false,
      showLocks: false,
    },
    nodes: [...stage.filter((n) => behind.has(n.options.id)), ...nodes, ...stage.filter((n) => !behind.has(n.options.id))],
  }
}

/** What a note shows on step `index`: 1 lit, the style's dim, or 0 (a stage note off its step). */
export function emphasis(deck, index) {
  const step = deck.steps[index]
  const style = resolveStyle(deck.style)
  const lit = step?.lit === 'all' || !step ? null : new Set(step.lit)
  const dim = step?.dim ?? style.dim
  const out = new Map()
  Object.keys(deck.skin).forEach((id) => out.set(id, !lit || lit.has(id) ? 1 : dim))
  deck.stageNotes.forEach((note) => {
    if (!showsOn(note, index)) out.set(note.id, 0)
    else if (note.deco) out.set(note.id, step?.deep ? 0.35 : 1)
    else out.set(note.id, !lit || lit.has(note.id) ? 1 : dim)
  })
  return out
}

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Anton&family=Caveat:wght@400;700&family=Fraunces:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;700;900&family=Space+Grotesk:wght@400;500;700&family=IBM+Plex+Mono:wght@400;700&family=Abril+Fatface&family=PT+Sans:wght@400;700&display=swap'
const CSS = `
.sbp-host{position:absolute;inset:0;overflow:hidden;overflow:clip;touch-action:pan-y pinch-zoom}
.sbp-roll{position:absolute;left:50%;top:50%;transform-origin:50% 50%;will-change:transform}
.sbp-canvas{width:100%;height:100%}
.sbp-canvas svg{pointer-events:none}
.sbp-canvas .connector-handle,.sbp-canvas .connector-handle-glyph,.sbp-canvas [data-resize-proxy]{display:none!important}
.sbp-canvas g[data-node-id],.sbp-canvas [data-source-node-id]{transition:opacity .65s ease}
.sbp-cap{position:absolute;left:clamp(18px,4vw,56px);bottom:calc(var(--sbp-inset,0px) + clamp(64px,9vh,96px));max-width:min(780px,72vw);color:var(--sbp-ink);pointer-events:none;transition:opacity .25s ease;z-index:3}
.sbp-cap.sbp-panel{background:var(--sbp-panel);padding:14px 20px 16px;border-radius:14px}
.sbp-cap .k{font:700 clamp(12px,1.1vw,15px)/1.2 var(--sbp-kfont),system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--sbp-accent);margin-bottom:8px}
.sbp-cap .t{font:400 clamp(24px,2.7vw,44px)/1.12 var(--sbp-font),system-ui,sans-serif;text-transform:var(--sbp-case);font-style:var(--sbp-italic)}
.sbp-cap .t span{display:inline-block;animation:sbp-word .55s cubic-bezier(.2,.9,.2,1.2) both}
.sbp-big .sbp-cap .t{font-weight:700;font-size:clamp(32px,3.4vw,56px)}
@keyframes sbp-word{from{opacity:0;transform:translateY(.45em) rotate(4deg)}to{opacity:1;transform:none}}
.sbp-flying .sbp-cap{opacity:0}
.sbp-route{position:absolute;left:clamp(18px,4vw,56px);right:clamp(18px,4vw,56px);bottom:calc(var(--sbp-inset,0px) + clamp(30px,4.5vh,44px));height:18px;pointer-events:none;z-index:3}
.sbp-route svg{width:100%;height:100%;overflow:visible}
@media (max-width:600px){.sbp-cap{right:18px;max-width:none}.sbp-cap .t{font-size:26px}.sbp-big .sbp-cap .t{font-size:34px}}
.sbp-reduced .sbp-cap .t span{animation:none}
.sbp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}
.sbp-reduced .sbp-canvas g[data-node-id],.sbp-reduced .sbp-canvas [data-source-node-id]{transition:none}
`

function ensureStyles(doc) {
  if (!doc.getElementById('sbp-css')) {
    const style = doc.createElement('style')
    style.id = 'sbp-css'
    style.textContent = CSS
    doc.head.appendChild(style)
  }
  if (!doc.getElementById('sbp-fonts')) {
    const link = doc.createElement('link')
    link.id = 'sbp-fonts'
    link.rel = 'stylesheet'
    link.href = FONT_HREF
    doc.head.appendChild(link)
  }
}

const escapeHtml = (text) => String(text || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const easeIn = (t) => t * t
const easeOut = (t) => 1 - Math.pow(1 - t, 3)

/**
 * Mount the deck in `host` and play it. `Slatebox` is the engine's v1 facade (slateboxjs), so the
 * presenter uses the app's engine build. → controller { goTo(index, { instant }), index(), resize(),
 * destroy(), slate }. `onStep({ index, step, flying })` reports moves; `captions: false` leaves the
 * captions to the host.
 */
export async function mountLiveDeck({
  host, Slatebox, slateJSON, deck, portrait = null, reduced = null, captions = true, captionBand = null, onStep = null, name = '',
}) {
  const doc = host.ownerDocument
  ensureStyles(doc)
  const style = resolveStyle(deck.style)
  const prefersReduced = reduced ?? Boolean(doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const calm = prefersReduced || style.motion.arc === 'cut'
  const size = () => ({ w: Math.max(1, host.clientWidth), h: Math.max(1, host.clientHeight) })
  const isPortrait = portrait ?? (size().h > size().w)

  const root = doc.createElement('div')
  root.className = `sbp-host sbp-style-${style.id}${calm ? ' sbp-reduced' : ''}${style.chrome.big ? ' sbp-big' : ''}`
  root.style.background = style.bg
  root.style.setProperty('--sbp-ink', style.chrome.ink)
  root.style.setProperty('--sbp-accent', style.chrome.accent)
  root.style.setProperty('--sbp-panel', style.chrome.panel)
  root.style.setProperty('--sbp-font', `'${style.chrome.captionFont}'`)
  root.style.setProperty('--sbp-kfont', `'${style.chrome.kickerFont}'`)
  root.style.setProperty('--sbp-case', style.chrome.captionCase || 'none')
  root.style.setProperty('--sbp-italic', style.chrome.italic ? 'italic' : 'normal')
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
  const cap = doc.createElement('div')
  cap.className = `sbp-cap${style.chrome.panel !== 'transparent' ? ' sbp-panel' : ''}`
  cap.setAttribute('aria-hidden', 'true')
  const route = doc.createElement('div')
  route.className = 'sbp-route'
  // What a screen reader hears on each step (the animated words above are hidden from it): the
  // step's place, its kicker and caption, and the words of the notes it lights.
  const spoken = doc.createElement('div')
  spoken.className = 'sbp-sr'
  spoken.setAttribute('aria-live', 'polite')
  spoken.setAttribute('aria-atomic', 'true')
  spoken.setAttribute('data-presentation-spoken', '')
  root.append(spoken)
  if (captions) root.append(cap, route)
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
    containerStyle: { backgroundColor: style.bg },
    viewPort: { allowDrag: false, useInertiaScrolling: false, showGrid: false },
    name: name || 'Presentation',
    showbirdsEye: false, showMultiSelect: false, showUndoRedo: false, showZoom: false, showLocks: false, showAddNodes: false,
    allowCollaboration: false, autoResizeNodesBasedOnText: false,
  }, { onInitCollaboration: async () => null, onCanvasClicked: () => {} }).init()
  const slate = facade.v2 || facade
  await slate.loadJSON(presentedSlate(slateJSON, deck, { portrait: isPortrait }), false, true)
  try { slate.disablePanZoom?.() } catch { /* already off */ }
  try { await slate.loadAllFonts?.() } catch { /* fonts are a nicety */ }
  try { await doc.fonts?.ready } catch { /* ignore */ }

  const camera = slate.camera
  camera.configure({ viewport: size, rollHost: roll, hostSide: side })
  const nodeEl = (id) => slate.nodes?.one?.(id)?.svgGroup?.node || canvas.querySelector(`g[data-node-id="${id}"]`)

  let current = -1
  let flight = null
  // What the host's own controls cover along the bottom: the captions and the camera keep above it.
  let inset = 0
  const band = () => (captionBand ?? (isPortrait ? 230 : 190)) + inset

  function targetFor(index) {
    const step = deck.steps[index]
    const cam = isPortrait && step.camera.p ? { ...step.camera, ...step.camera.p } : step.camera
    const box = frameBox(deck, step, { portrait: isPortrait })
    const hasCaption = Boolean(captions && (step.narrative || step.kicker))
    return {
      bbox: { x: box.x, y: box.y, width: box.width, height: box.height },
      fill: cam.fill ?? 0.86,
      cover: Boolean(cam.cover),
      roll: calm ? 0 : cam.roll || 0,
      bottom: cam.cover ? inset : hasCaption ? band() : 70 + inset,
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
    const levels = emphasis(deck, index)
    const own = new Set(deck.stageNotes.filter((note) => Array.isArray(note.steps) && note.steps.includes(index) && note.steps.length === 1).map((note) => note.id))
    levels.forEach((level, id) => {
      const el = nodeEl(id)
      if (!el) return
      const value = hideOwn && own.has(id) ? 0 : level
      if (shown.get(id) !== String(value)) el.style.transitionDelay = '0ms'
      setOpacity(el, id, value)
    })
    const lit = deck.steps[index]?.lit
    const set = lit === 'all' ? null : new Set(lit)
    lines = lines || [...canvas.querySelectorAll('[data-source-node-id]')]
    lines.forEach((line, k) => {
      const on = !set || (set.has(line.getAttribute('data-source-node-id')) && set.has(line.getAttribute('data-target-node-id')))
      setOpacity(line, `line:${k}`, on ? 1 : deck.steps[index]?.dim ?? style.dim)
    })
    return own
  }

  // The step's own stage notes come in once the camera lands: one after another.
  function reveal(index, own) {
    const levels = emphasis(deck, index)
    const order = deck.stageNotes.filter((note) => own.has(note.id)).map((note) => note.id)
    order.forEach((id, k) => {
      const el = nodeEl(id)
      if (!el) return
      el.style.transitionDelay = calm ? '0ms' : `${k * (style.motion.reveal === 'pop' ? 70 : 120)}ms`
      setOpacity(el, id, levels.get(id))
    })
  }

  // The words of the notes a step lights (the slate's own notes and its stage words), for the
  // screen reader: the canvas itself is inert.
  const textOf = new Map(deck.stageNotes.filter((note) => note.text && !note.deco).map((note) => [note.id, note.text]))
  ;(typeof slateJSON === 'string' ? JSON.parse(slateJSON) : slateJSON || {}).nodes?.forEach((node) => {
    if (node?.options?.id != null && node.options.text) textOf.set(String(node.options.id), String(node.options.text))
  })
  function speak(index) {
    const step = deck.steps[index]
    if (!step) return
    const lit = step.lit === 'all' ? [] : step.lit
    const said = [...new Set(lit.map((id) => textOf.get(id)).filter(Boolean))].slice(0, 12)
    spoken.textContent = [`Step ${index + 1} of ${deck.steps.length}.`, step.kicker, step.narrative, said.length ? `On screen: ${said.join('; ')}.` : ''].filter(Boolean).join(' ')
  }

  function showCaption(index, flying) {
    if (!flying) speak(index)
    if (!captions) return
    const step = deck.steps[index]
    root.classList.toggle('sbp-flying', flying)
    const text = step?.narrative || ''
    const kicker = step?.kicker || ''
    cap.style.display = text || kicker ? '' : 'none'
    cap.innerHTML = `${kicker ? `<div class="k">${escapeHtml(kicker)}</div>` : ''}${text ? `<div class="t">${text.split(/\s+/).map((word, k) => `<span style="animation-delay:${calm ? 0 : 120 + k * 45}ms">${escapeHtml(word)}</span>`).join(' ')}</div>` : ''}`
    const n = deck.steps.length
    const pts = deck.steps.map((_, k) => [8 + k * (984 / Math.max(1, n - 1)), 9 + Math.sin(k * 1.3) * 5])
    route.innerHTML = `<svg viewBox="0 0 1000 18" preserveAspectRatio="none" aria-hidden="true"><path d="M${pts.map((p) => p.join(',')).join(' L')}" fill="none" stroke="${style.chrome.ink}" stroke-opacity=".25" stroke-width="2" vector-effect="non-scaling-stroke"/>${pts.map((p, k) => `<circle cx="${p[0]}" cy="${p[1]}" r="${k === index ? 6 : 3.5}" fill="${k <= index ? style.chrome.bar : style.chrome.ink}" fill-opacity="${k <= index ? 1 : 0.35}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`
  }

  async function goTo(index, { instant = false } = {}) {
    if (!deck.steps[index]) return
    const from = current
    current = index
    const step = deck.steps[index]
    const target = targetFor(index)
    const pace = style.motion.pace || 1
    onStep?.({ index, step, flying: true })
    if (instant || calm || from < 0) {
      paint(index)
      if (!instant && calm && from >= 0) root.animate?.([{ opacity: 0.15 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' })
      await camera.flyTo(target, { arc: 'cut', reduced: calm })
      showCaption(index, false)
      onStep?.({ index, step, flying: false })
      return
    }
    const own = paint(index, { hideOwn: true })
    showCaption(index, true)
    const controller = new AbortController()
    flight?.abort()
    flight = controller
    try {
      if (step.camera.via === 'overview' && deck.steps[1]?.layout === 'overview') {
        // Homecoming: out through the whole map, then down onto the opening bookend.
        const over = targetFor(1)
        await camera.flyTo({ ...over, roll: (over.roll + target.roll) / 2 }, { arc: 'direct', duration: 1100 * pace, ease: easeIn, signal: controller.signal })
        await camera.flyTo(target, { arc: 'direct', duration: 1300 * pace, ease: easeOut, signal: controller.signal })
      } else {
        const now = camera.current()
        const to = camera.resolve(target)
        const auto = now && to ? Math.min(2200, 900 + Math.hypot(to.cx - now.cx, to.cy - now.cy) * Math.min(now.scale, to.scale) / Math.max(1, Math.min(size().w, size().h)) * 280 + Math.abs(Math.log(to.scale / now.scale)) * 220) : 1200
        await camera.flyTo(target, { arc: style.motion.arc === 'direct' ? 'direct' : 'prezi', duration: (step.deep ? auto * 1.15 : auto) * pace, signal: controller.signal })
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      throw error
    }
    if (current !== index) return
    reveal(index, own)
    showCaption(index, false)
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

  return { goTo, index: () => current, resize, setInset, destroy, slate, portrait: isPortrait, reduced: calm }
}
