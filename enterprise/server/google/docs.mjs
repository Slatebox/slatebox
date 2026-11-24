// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slates to Google Docs and Slides, and Google files back to notes, as plain data (no network): the
// Docs batchUpdate built from a slate's outline, the Slides requests for presentation frames, and a
// Google Doc's structure (or a sheet's rows, or a text file) read into groups of notes. What comes
// from Google is a person's own file but still data: clamped to plain text, only https links kept.
import { plainText } from '../tools.mjs'
import { safeLink } from '../results.mjs'

export const DOC_LIMITS = Object.freeze({ notes: 400, noteChars: 1000, titleChars: 120, importNotes: 60, importGroups: 8, importChars: 400, slides: 30 })

const textOf = (node) => plainText(String(node?.options?.text ?? '').replace(/<[^>]*>/g, ' '), DOC_LIMITS.noteChars)
const linkOf = (node) => {
  const raw = node?.options?.link?.url || node?.options?.link || node?.options?.style?.link || null
  return typeof raw === 'string' ? safeLink(raw)?.url || null : null
}

/**
 * A slate's outline: its title, then each note that has notes under it (a mind map's branch, a flow's
 * step with its next steps) as a heading with the notes below it as bullets (nested by depth), then
 * the notes on their own. Lines are read parent → child; a note is listed once.
 */
export function slateOutline(slate) {
  const nodes = (slate?.nodes || []).filter((node) => node?.options?.id && textOf(node)).slice(0, DOC_LIMITS.notes)
  const byId = new Map(nodes.map((node) => [node.options.id, node]))
  const children = new Map()
  const hasParent = new Set()
  for (const node of nodes) {
    for (const line of node.relationships?.associations || []) {
      if (line.parentId !== node.options.id || !byId.has(line.childId) || line.childId === line.parentId) continue
      if (!children.has(line.parentId)) children.set(line.parentId, [])
      if (!children.get(line.parentId).includes(line.childId)) children.get(line.parentId).push(line.childId)
      hasParent.add(line.childId)
    }
  }
  const listed = new Set()
  const sections = []
  const walk = (id, depth, items) => {
    for (const child of children.get(id) || []) {
      if (listed.has(child)) continue
      listed.add(child)
      items.push({ text: textOf(byId.get(child)), link: linkOf(byId.get(child)), depth: Math.min(depth, 4) })
      walk(child, depth + 1, items)
    }
  }
  for (const node of nodes) {
    const id = node.options.id
    if (hasParent.has(id) || !children.has(id) || listed.has(id)) continue
    listed.add(id)
    const items = []
    walk(id, 0, items)
    sections.push({ heading: textOf(node), link: linkOf(node), items })
  }
  const loose = nodes.filter((node) => !listed.has(node.options.id)).map((node) => ({ text: textOf(node), link: linkOf(node), depth: 0 }))
  if (loose.length) sections.push({ heading: sections.length ? 'Other notes' : 'Notes', link: null, items: loose })
  return { title: plainText(slate?.options?.name || 'Untitled slate', DOC_LIMITS.titleChars) || 'Untitled slate', sections }
}

/**
 * The Docs batchUpdate requests that write an outline into an empty document (index 1), in order:
 * the title (Title style), each section's heading (Heading 1, linked when the note had a link), its
 * notes as bullets (nested with tabs, links kept), and the slate's picture at the end when given.
 * startIndex: where the body starts (1 in a new document).
 */
export function docRequests(outline, { imageUri = null, startIndex = 1 } = {}) {
  const requests = []
  let at = startIndex
  const paragraph = (text, style, { link = null, bullet = false, depth = 0 } = {}) => {
    const line = (bullet ? '\t'.repeat(depth) : '') + text + '\n'
    requests.push({ insertText: { location: { index: at }, text: line } })
    const range = { startIndex: at, endIndex: at + line.length }
    requests.push({ updateParagraphStyle: { range, paragraphStyle: { namedStyleType: style }, fields: 'namedStyleType' } })
    if (bullet) requests.push({ createParagraphBullets: { range, bulletPreset: 'BULLET_DISC_CIRCLE_SQUARE' } })
    // Bullets turn the leading tabs into nesting and remove them: the link starts after them.
    const tabs = bullet ? depth : 0
    if (link) requests.push({ updateTextStyle: { range: { startIndex: at, endIndex: at + line.length - 1 - tabs }, textStyle: { link: { url: link } }, fields: 'link' } })
    at += line.length - tabs
  }
  paragraph(outline.title, 'TITLE')
  for (const section of outline.sections) {
    paragraph(section.heading, 'HEADING_1', { link: section.link })
    for (const item of section.items) paragraph(item.text, 'NORMAL_TEXT', { link: item.link, bullet: true, depth: item.depth })
  }
  if (imageUri) requests.push({ insertInlineImage: { location: { index: at }, uri: imageUri, objectSize: { width: { magnitude: 468, unit: 'PT' } } } })
  return requests
}

/** Replacing a document's body ("Update this Doc"): delete everything after index 1, then write. */
export function replaceRequests(endIndex, outline, options) {
  const clear = endIndex > 2 ? [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] : []
  return [...clear, ...docRequests(outline, { ...options, startIndex: 1 })]
}

/** Slides for presentation frames: one slide each, its title and its picture (a public image address). */
export function slideRequests(frames) {
  const requests = []
  frames.slice(0, DOC_LIMITS.slides).forEach((frame, index) => {
    const slideId = `sb_slide_${index}`
    const titleId = `sb_title_${index}`
    requests.push({ createSlide: { objectId: slideId, insertionIndex: index, slideLayoutReference: { predefinedLayout: 'TITLE_ONLY' }, placeholderIdMappings: [{ layoutPlaceholder: { type: 'TITLE', index: 0 }, objectId: titleId }] } })
    requests.push({ insertText: { objectId: titleId, insertionIndex: 0, text: plainText(frame.title || `Slide ${index + 1}`, 200) || `Slide ${index + 1}` } })
    if (frame.imageUri) {
      requests.push({
        createImage: {
          url: frame.imageUri,
          elementProperties: { pageObjectId: slideId, size: { width: { magnitude: 620, unit: 'PT' }, height: { magnitude: 300, unit: 'PT' } }, transform: { scaleX: 1, scaleY: 1, translateX: 50, translateY: 90, unit: 'PT' } },
        },
      })
    }
  })
  return requests
}

const clampNote = (text) => plainText(text, DOC_LIMITS.importChars)

/**
 * A Google Doc (documents.get) as groups of notes: each heading starts a group (its label), each
 * paragraph or bullet under it is a note (a link in it kept when it is https). Text before the first
 * heading is a group named after the document.
 */
export function groupsFromDoc(doc) {
  const groups = []
  let current = null
  let notes = 0
  const start = (label) => {
    current = { label: clampNote(label) || 'From Google Docs', layout: 'column', notes: [], lines: [] }
    groups.push(current)
  }
  for (const block of doc?.body?.content || []) {
    const para = block?.paragraph
    if (!para) continue
    let link = null
    const text = (para.elements || []).map((el) => {
      const run = el?.textRun
      if (!run) return ''
      if (!link && run.textStyle?.link?.url) link = safeLink(run.textStyle.link.url)?.url || null
      return run.content || ''
    }).join('').trim()
    if (!text) continue
    const style = para.paragraphStyle?.namedStyleType || 'NORMAL_TEXT'
    if (/^(TITLE|HEADING_[1-3])$/.test(style)) {
      if (groups.length >= DOC_LIMITS.importGroups) break
      start(text)
      continue
    }
    if (!current) start(doc?.title || 'From Google Docs')
    if (notes >= DOC_LIMITS.importNotes) break
    current.notes.push({ key: 'n' + notes, text: clampNote(text), ...(link && { link }) })
    notes++
  }
  return groups.filter((group) => group.notes.length).slice(0, DOC_LIMITS.importGroups)
}

/** A sheet exported as CSV: the first row names the group, each row after it is a note. */
export function groupsFromCsv(csv, title = 'From Google Sheets') {
  const rows = String(csv || '').split(/\r?\n/).map((row) => row.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim()).filter(Boolean).join(' · ')).filter(Boolean)
  if (!rows.length) return []
  const notes = rows.slice(1, 1 + DOC_LIMITS.importNotes).map((text, i) => ({ key: 'r' + i, text: clampNote(text) }))
  return notes.length ? [{ label: clampNote(rows[0]) || clampNote(title), layout: 'grid', notes, lines: [] }] : [{ label: clampNote(title), layout: 'grid', notes: [{ key: 'r0', text: clampNote(rows[0]) }], lines: [] }]
}

/** Plain text or Markdown: "#" lines start groups, other lines (bullets too) are notes. */
export function groupsFromText(text, title = 'From Google Drive') {
  const groups = []
  let current = null
  let notes = 0
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = line.match(/^#{1,3}\s+(.*)$/)
    if (heading) {
      if (groups.length >= DOC_LIMITS.importGroups) break
      current = { label: clampNote(heading[1]), layout: 'column', notes: [], lines: [] }
      groups.push(current)
      continue
    }
    if (!current) {
      current = { label: clampNote(title), layout: 'column', notes: [], lines: [] }
      groups.push(current)
    }
    if (notes >= DOC_LIMITS.importNotes) break
    current.notes.push({ key: 't' + notes, text: clampNote(line.replace(/^(?:[-*•]|\d+[.)])\s+/, '')) })
    notes++
  }
  return groups.filter((group) => group.notes.length)
}
