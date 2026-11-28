// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What a design doc holds that can be drawn, read without a model: its heading outline (with each
// heading's link), its Mermaid blocks (fenced ```mermaid, or a paragraph run that starts like a
// diagram), and its components tables (a table whose header names a component or service column,
// with "depends on", "calls" or "uses" as connectors). Each block is keyed by the heading it sits
// under and its place there, so adding a block in one section never renames another's notes.
import { normalKey, plain } from '../_shared/text.mjs'

const HEADING = /^HEADING_([1-6])$/
const STARTS = /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b|^(flowchart|graph)\s*$|^mindmap\s*$|^gantt\s*$/

export const docLink = (docId, headingId = null) => `https://docs.google.com/document/d/${docId}/edit${headingId ? `#heading=${headingId}` : ''}`

export function readDoc(doc, { only = [] } = {}) {
  const wanted = new Set(only.map(normalKey))
  const headings = []
  const stack = []
  const lines = []
  let current = null
  for (const block of doc.blocks || []) {
    if (block.type === 'paragraph') {
      const level = block.style === 'TITLE' ? 0 : Number(block.style.match(HEADING)?.[1] || 0) || null
      const text = String(block.text || '').replace(/\u000b/g, '\n')
      if (level !== null && block.style !== 'NORMAL_TEXT' && text.trim()) {
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
        const key = 'h:' + (block.headingId || normalKey(text).replace(/ /g, '-').slice(0, 60))
        const heading = { key, text: plain(text, 120), level, link: docLink(doc.id, block.headingId), parentKey: stack[stack.length - 1]?.key || null }
        headings.push(heading)
        stack.push(heading)
        current = heading
        lines.push({ text: '', heading: current })
        continue
      }
      for (const line of text.split('\n')) lines.push({ text: line, heading: current })
    } else if (block.type === 'table') lines.push({ table: block.rows, heading: current })
  }
  const inScope = (heading) => {
    if (!wanted.size) return true
    for (let h = heading; h; h = headings.find((x) => x.key === h.parentKey)) if (wanted.has(normalKey(h.text))) return true
    return false
  }

  // Mermaid: fenced blocks, or a run of lines that starts like a diagram and ends at a blank line.
  const blocks = []
  const ordinal = new Map()
  const add = (heading, source) => {
    if (!inScope(heading)) return
    const where = heading?.key || 'top'
    const n = (ordinal.get(where) || 0) + 1
    ordinal.set(where, n)
    blocks.push({ key: `${where}#${n}`, heading, source })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].text
    if (typeof line !== 'string') continue
    if (/^\s*(```|~~~)\s*mermaid\b/i.test(line)) {
      const fence = line.trim().slice(0, 3)
      const body = []
      let j = i + 1
      for (; j < lines.length && !(typeof lines[j].text === 'string' && lines[j].text.trim().startsWith(fence)); j++) if (typeof lines[j].text === 'string') body.push(lines[j].text)
      add(lines[i].heading, body.join('\n'))
      i = j
    } else if (STARTS.test(line.trim())) {
      const body = [line]
      let j = i + 1
      for (; j < lines.length && typeof lines[j].text === 'string' && lines[j].text.trim(); j++) body.push(lines[j].text)
      add(lines[i].heading, body.join('\n'))
      i = j - 1
    }
  }

  // Components tables.
  const components = []
  for (const line of lines) {
    if (!line.table || !inScope(line.heading)) continue
    const [head, ...rows] = line.table
    const keys = (head || []).map(normalKey)
    const nameAt = keys.findIndex((k) => /\b(component|service|system|module)s?\b/.test(k))
    if (nameAt < 0) continue
    const descAt = keys.findIndex((k, i) => i !== nameAt && /\b(description|purpose|what|role|owns)\b/.test(k))
    const depAt = keys.findIndex((k) => /\b(depends on|dependencies|calls|uses|talks to|reads from|writes to)\b/.test(k))
    for (const row of rows) {
      const name = plain(row[nameAt], 80)
      if (!name) continue
      components.push({ name, description: descAt >= 0 ? plain(row[descAt], 140) : '', deps: depAt >= 0 ? String(row[depAt] || '').split(/[,;\n]/).map((d) => plain(d, 80)).filter(Boolean) : [], heading: line.heading })
    }
  }

  const text = lines.filter((l) => typeof l.text === 'string' && inScope(l.heading)).map((l) => l.text).join('\n')
  return { title: doc.title, headings: headings.filter((h) => inScope(h) || h.level === 0), blocks, components, text }
}
