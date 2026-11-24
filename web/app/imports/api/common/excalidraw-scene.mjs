// An Excalidraw drawing as native Slatebox notes and lines. Used by "Import from Excalidraw" (a
// .excalidraw file or an excalidraw.com share link, read in the browser) and by any outside agent
// that answers with Excalidraw elements. Pure: no Meteor, no DOM (the share-link decryption takes
// the browser's WebCrypto and DecompressionStream as arguments).
//
// What becomes what:
//   rectangle / ellipse / diamond      a note of that shape, with its label as text
//   text bound to a shape              that shape's words (containerId, or the element's label)
//   free text mostly inside a shape    merged into that shape's words (drawn on top, not bound)
//   free text on its own               a note of its own
//   arrow bound at both ends           a line between the two notes
//   arrow with no binding              a line when each end sits on (or next to) a shape
//   line, free-draw, image, frame      left out, and counted, so the person is told
// Notes with the same words in one drawing are one note.

const SHAPE_OF = Object.freeze({ rectangle: 'roundedrectangle', ellipse: 'ellipse', diamond: 'diamond' })
export const SCENE_LIMITS = Object.freeze({ elements: 2000, notes: 200, lines: 400, noteChars: 400, bytes: 4 * 1024 * 1024 })
export const IMPORT_SHAPES = Object.freeze(['rectangle', 'roundedrectangle', 'ellipse', 'diamond'])

// One line of plain text: control and invisible characters become spaces.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/gu
const plain = (text, max) => String(text ?? '').normalize('NFKC').replace(CONTROL, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, max)
const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

/** The elements of a drawing: an array, a scene ({ elements }), or its JSON. Null when it is none of those. */
export function sceneElements(value) {
  let scene = value
  if (typeof value === 'string') {
    if (value.length > SCENE_LIMITS.bytes) return null
    try {
      scene = JSON.parse(value)
    } catch {
      return null
    }
  }
  const elements = Array.isArray(scene) ? scene : Array.isArray(scene?.elements) ? scene.elements : null
  if (!elements) return null
  return elements.slice(0, SCENE_LIMITS.elements).filter((el) => el && typeof el === 'object' && typeof el.type === 'string' && !el.isDeleted)
}

const boxOf = (el) => ({ x: num(el.x), y: num(el.y), w: Math.abs(num(el.width)), h: Math.abs(num(el.height)) })
const area = (b) => Math.max(0, b.w) * Math.max(0, b.h)
function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
// How far a point is from a box (0 inside it).
const distance = (p, b) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)))

/**
 * The drawing as one free layout: { notes: [{ key, text, shape, at }], lines: [{ from, to }],
 * skipped: { lines, drawings, images, other } }. Positions are the drawing's own, from its top left.
 */
export function sceneToLayout(elements, { maxNotes = SCENE_LIMITS.notes, maxLines = SCENE_LIMITS.lines, near = 40 } = {}) {
  const list = Array.isArray(elements) ? elements.filter((el) => el && typeof el.type === 'string' && !el.isDeleted) : []
  const skipped = { lines: 0, drawings: 0, images: 0, other: 0 }
  const shapes = []
  const byId = new Map()
  for (const el of list) {
    if (typeof el.id === 'string') byId.set(el.id, el)
    if (SHAPE_OF[el.type]) shapes.push({ el, box: boxOf(el), words: [] })
  }
  const shapeOf = new Map(shapes.map((s) => [s.el.id, s]))
  // Words on a shape: its label (the MCP format), then text bound to it.
  for (const s of shapes) if (s.el.label?.text) s.words.push(s.el.label.text)
  const freeText = []
  for (const el of list) {
    if (el.type !== 'text') continue
    const text = plain(el.text ?? el.originalText, SCENE_LIMITS.noteChars)
    if (!text) continue
    const owner = el.containerId && shapeOf.get(el.containerId)
    if (owner) {
      owner.words.push(text)
      continue
    }
    freeText.push({ el, text, box: boxOf(el) })
  }
  // Free text drawn mostly inside a shape is that shape's words (the smallest such shape wins).
  const merged = new Map() // text element id -> shape
  const standalone = []
  for (const t of freeText) {
    const size = area(t.box) || 1
    const inside = shapes.filter((s) => overlap(t.box, s.box) / size >= 0.5).sort((a, b) => area(a.box) - area(b.box))[0]
    if (inside) {
      inside.words.push(t.text)
      merged.set(t.el.id, inside)
    } else standalone.push(t)
  }
  for (const el of list) {
    if (el.type === 'line') skipped.lines++
    else if (el.type === 'freedraw') skipped.drawings++
    else if (el.type === 'image') skipped.images++
    else if (!SHAPE_OF[el.type] && !['text', 'arrow', 'line', 'freedraw', 'image'].includes(el.type)) skipped.other++
  }
  // Notes, deduplicated by their words: an empty shape stays a note of its own.
  const notes = []
  const keyOf = new Map() // element id -> note key
  const byWords = new Map()
  const addNote = (id, text, shape, box) => {
    const words = text.toLowerCase()
    if (text && byWords.has(words)) {
      keyOf.set(id, byWords.get(words))
      return
    }
    if (notes.length >= maxNotes) return
    const key = 'x' + (notes.length + 1)
    notes.push({ key, text: text || ' ', shape, at: { x: box.x, y: box.y, width: Math.max(40, box.w || 200), height: Math.max(30, box.h || 90) } })
    keyOf.set(id, key)
    if (text) byWords.set(words, key)
  }
  for (const s of shapes) addNote(s.el.id, plain([...new Set(s.words)].join('\n'), SCENE_LIMITS.noteChars), SHAPE_OF[s.el.type], s.box)
  for (const t of standalone) addNote(t.el.id, t.text, 'roundedrectangle', t.box)
  for (const [textId, s] of merged) if (keyOf.has(s.el.id)) keyOf.set(textId, keyOf.get(s.el.id))
  // A bound end names its element (a text bound to a shape stands for the shape).
  const endKey = (id) => {
    if (typeof id !== 'string') return null
    if (keyOf.has(id)) return keyOf.get(id)
    const el = byId.get(id)
    return el?.containerId ? keyOf.get(el.containerId) ?? null : null
  }
  // An unbound end: the note whose box it sits on, or the nearest within `near`.
  const placed = notes.map((n) => ({ key: n.key, box: { x: n.at.x, y: n.at.y, w: n.at.width, h: n.at.height } }))
  const nearestKey = (p) => {
    let best = null
    for (const n of placed) {
      const d = distance(p, n.box)
      if (d <= near && (!best || d < best.d)) best = { key: n.key, d }
    }
    return best?.key ?? null
  }
  const lines = []
  const seen = new Set()
  for (const el of list) {
    if (el.type !== 'arrow') continue
    const points = Array.isArray(el.points) && el.points.length >= 2 ? el.points : [[0, 0], [num(el.width), num(el.height)]]
    const at = (p) => ({ x: num(el.x) + num(p?.[0]), y: num(el.y) + num(p?.[1]) })
    const from = endKey(el.start?.id ?? el.startBinding?.elementId) ?? nearestKey(at(points[0]))
    const to = endKey(el.end?.id ?? el.endBinding?.elementId) ?? nearestKey(at(points[points.length - 1]))
    if (!from || !to || from === to) {
      skipped.other++
      continue
    }
    const pair = from + '>' + to
    if (seen.has(pair) || lines.length >= maxLines) continue
    seen.add(pair)
    lines.push({ from, to })
  }
  if (notes.length) {
    const minX = Math.min(...notes.map((n) => n.at.x))
    const minY = Math.min(...notes.map((n) => n.at.y))
    for (const n of notes) n.at = { x: Math.round(n.at.x - minX), y: Math.round(n.at.y - minY), width: Math.round(n.at.width), height: Math.round(n.at.height) }
  }
  return { notes, lines, skipped }
}

/** What was left out, in plain words ('' when nothing was). */
export function skippedWords(skipped = {}) {
  const parts = []
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`
  if (skipped.lines) parts.push(n(skipped.lines, 'plain line', 'plain lines'))
  if (skipped.drawings) parts.push(n(skipped.drawings, 'free-hand drawing', 'free-hand drawings'))
  if (skipped.images) parts.push(n(skipped.images, 'picture', 'pictures'))
  if (skipped.other) parts.push(n(skipped.other, 'other element', 'other elements'))
  if (!parts.length) return ''
  return `Left out ${parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1)}: Slatebox brings in shapes, their words and the arrows between them.`
}

/**
 * A layout sent from a browser, checked the way the server needs it: known shapes, plain words,
 * sane sizes, lines between its own notes. Throws a plain sentence when it cannot be used.
 */
export function checkImportLayout(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes)) throw new Error('That drawing could not be read. Export it from Excalidraw again.')
  if (raw.notes.length > SCENE_LIMITS.notes) throw new Error(`That drawing has more than ${SCENE_LIMITS.notes} shapes. Import a smaller part of it.`)
  const notes = []
  const keys = new Set()
  for (const note of raw.notes) {
    const key = typeof note?.key === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(note.key) ? note.key : null
    if (!key || keys.has(key)) continue
    const at = note.at || {}
    const coords = [at.x, at.y, at.width, at.height].map(Number)
    if (!coords.every(Number.isFinite)) continue
    keys.add(key)
    notes.push({
      key,
      text: plain(note.text, SCENE_LIMITS.noteChars) || ' ',
      shape: IMPORT_SHAPES.includes(note.shape) ? note.shape : 'roundedrectangle',
      at: { x: Math.round(Math.max(-1e5, Math.min(1e5, coords[0]))), y: Math.round(Math.max(-1e5, Math.min(1e5, coords[1]))), width: Math.round(Math.max(20, Math.min(5000, coords[2]))), height: Math.round(Math.max(20, Math.min(5000, coords[3]))) },
    })
  }
  if (!notes.length) throw new Error('That drawing has no shapes or words Slatebox can bring in.')
  const lines = []
  const seen = new Set()
  for (const line of Array.isArray(raw.lines) ? raw.lines.slice(0, SCENE_LIMITS.lines) : []) {
    if (!keys.has(line?.from) || !keys.has(line?.to) || line.from === line.to || seen.has(line.from + '>' + line.to)) continue
    seen.add(line.from + '>' + line.to)
    lines.push({ from: line.from, to: line.to })
  }
  return { notes, lines }
}

/** A checked layout as slates.applyOperations operations, its top left at origin. newId() names each note. */
export function layoutOperations({ notes, lines }, { origin = { x: 0, y: 0 }, newId }) {
  const idOf = new Map()
  const operations = []
  for (const note of notes) {
    const id = newId()
    idOf.set(note.key, id)
    operations.push({ kind: 'add_nodes', count: 1, ids: [id], text: note.text, x: Math.round(origin.x + note.at.x), y: Math.round(origin.y + note.at.y), width: note.at.width, height: note.at.height, shape: note.shape })
  }
  for (const line of lines) operations.push({ kind: 'connect_nodes', from: { ids: [idOf.get(line.from)] }, to: { ids: [idOf.get(line.to)] } })
  return { operations, created: [...idOf.values()] }
}

// ---- excalidraw.com share links ------------------------------------------------------------
// A share link is https://excalidraw.com/#json=<id>,<key>. The drawing is stored encrypted under
// <id>; <key> stays in the link's fragment, so the browser decrypts it and the key never reaches a
// server (Slatebox's included).

/** The id and key of an excalidraw.com share link, or null. */
export function shareLinkParts(link) {
  const match = /^https:\/\/(?:www\.)?excalidraw\.com\/?#json=([A-Za-z0-9_-]{8,64}),([A-Za-z0-9_-]{16,64})$/.exec(String(link || '').trim())
  return match ? { id: match[1], key: match[2] } : null
}

// Excalidraw's buffers: a 4-byte version, then each chunk as a 4-byte length and its bytes.
function splitBuffers(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const chunks = []
  let at = 4
  while (at + 4 <= bytes.byteLength) {
    const size = view.getUint32(at)
    at += 4
    if (at + size > bytes.byteLength) throw new Error('bad buffer')
    chunks.push(bytes.subarray(at, at + size))
    at += size
  }
  return chunks
}

/**
 * A stream read to its end, stopped (and refused) once it passes `max` bytes: a download with no
 * length, or a small deflated drawing that inflates without end, never fills memory.
 * → Uint8Array; throws an Error with code 'too_large'.
 */
export async function readCapped(stream, max) {
  const reader = stream.getReader()
  const parts = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      throw Object.assign(new Error('That drawing is too large to import.'), { code: 'too_large' })
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

/** Inflates deflated bytes in the browser, at most `max` bytes out (DecompressionStream). */
export const inflateCapped = (bytes, max = SCENE_LIMITS.bytes * 4) => readCapped(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')), max)

/**
 * The drawing a share link stored, decrypted in the browser: { elements }. bytes: what
 * excalidraw.com stored under the link's id; crypto: window.crypto.subtle; inflate(bytes) →
 * Promise<Uint8Array> (DecompressionStream('deflate')).
 */
export async function decryptShare(bytes, key, { subtle, inflate }) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const cryptoKey = await subtle.importKey('jwk', { alg: 'A128GCM', ext: true, k: key, key_ops: ['encrypt', 'decrypt'], kty: 'oct' }, { name: 'AES-GCM', length: 128 }, false, ['decrypt'])
  const decode = (b) => new TextDecoder().decode(b)
  const decrypt = async (iv, cipher) => new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher))
  let json
  const version = data.byteLength >= 4 ? new DataView(data.buffer, data.byteOffset, 4).getUint32(0) : 0
  if (version === 1) {
    // [encoding metadata, iv, encrypted (deflated [contents metadata, contents])]
    const [meta, iv, cipher] = splitBuffers(data)
    const encoding = JSON.parse(decode(meta))
    let plainBytes = await decrypt(iv, cipher)
    if (encoding?.compression) plainBytes = await inflate(plainBytes)
    const inner = splitBuffers(plainBytes)
    json = decode(inner[inner.length - 1])
  } else {
    // The older form: a 12-byte iv, then the encrypted JSON.
    json = decode(await decrypt(data.subarray(0, 12), data.subarray(12)))
  }
  const elements = sceneElements(json)
  if (!elements) throw new Error('That link holds no drawing Slatebox can read.')
  return { elements }
}
