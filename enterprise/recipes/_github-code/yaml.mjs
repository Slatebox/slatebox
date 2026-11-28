// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// YAML, the part infrastructure files use: block mappings and sequences by indentation, plain,
// quoted and block (| >) scalars, flow sequences and mappings ([a, b], {a: b}), comments and
// several documents in one file (---). Anchors are dropped and aliases read as plain words: the
// extractors only need names, references and env values. No dependency, never throws on input
// (a line it cannot read is skipped and counted in warnings).

const MAX_DEPTH = 40

function stripComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === quote && line[i - 1] !== '\\') quote = null
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s:[{,-]/.test(line[i - 1])) quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i)
  }
  return line
}

function splitFlow(inner) {
  const parts = []
  let depth = 0
  let quote = null
  let start = 0
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') depth -= 1
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i))
      start = i + 1
    }
  }
  parts.push(inner.slice(start))
  return parts.map((p) => p.trim()).filter((p) => p !== '')
}

/** One scalar or flow value as written after a key or a dash. */
export function scalar(raw) {
  let text = `${raw}`.trim()
  text = text.replace(/^&[\w-]+\s*/, '').replace(/^!!?[\w/]+\s+/, '')
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2)
    return text.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) return text.slice(1, -1).replace(/''/g, "'")
  if (text.startsWith('[') && text.endsWith(']')) return splitFlow(text.slice(1, -1)).map(scalar)
  if (text.startsWith('{') && text.endsWith('}')) {
    const out = {}
    for (const part of splitFlow(text.slice(1, -1))) {
      const at = keyColon(part)
      if (at < 0) out[part] = null
      else out[unquote(part.slice(0, at))] = scalar(part.slice(at + 1))
    }
    return out
  }
  if (/^(true|True|TRUE|yes|on)$/.test(text)) return true
  if (/^(false|False|FALSE|no|off)$/.test(text)) return false
  if (/^[-+]?\d+$/.test(text) && text.length < 16) return Number(text)
  if (/^[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?$/.test(text)) return Number(text)
  return text
}

const unquote = (key) => {
  const k = key.trim()
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) return k.slice(1, -1)
  return k
}

/** Where a "key: value" line's colon is (outside quotes and flow brackets), or -1. */
function keyColon(text) {
  let quote = null
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if ((ch === '"' || ch === "'") && i === 0) quote = ch
    else if (ch === '[' || ch === '{') depth += 1
    else if (ch === ']' || ch === '}') depth -= 1
    else if (ch === ':' && depth === 0 && (i === text.length - 1 || text[i + 1] === ' ' || text[i + 1] === '\t')) return i
  }
  return -1
}

function toLines(source) {
  return source
    .split('\n')
    .map((raw) => {
      const line = stripComment(raw.replace(/\t/g, '  ')).replace(/\s+$/, '')
      return { indent: line.length - line.trimStart().length, text: line.trim(), raw }
    })
}

/** Parse one document's lines. → value */
function parseLines(lines, warnings) {
  let at = 0
  const skipBlank = () => {
    while (at < lines.length && lines[at].text === '') at += 1
  }
  function blockScalar(indent, folded) {
    const out = []
    let inner = null
    while (at < lines.length) {
      const line = lines[at]
      const rawIndent = line.raw.length - line.raw.trimStart().length
      if (line.raw.trim() !== '' && rawIndent <= indent) break
      if (line.raw.trim() !== '' && inner === null) inner = rawIndent
      out.push(line.raw.slice(inner ?? 0))
      at += 1
    }
    while (out.length && out[out.length - 1].trim() === '') out.pop()
    return folded ? out.join(' ').replace(/\s+/g, ' ').trim() : out.join('\n')
  }
  function value(indent, depth) {
    skipBlank()
    if (at >= lines.length || depth > MAX_DEPTH) return null
    const first = lines[at]
    if (first.indent < indent) return null
    if (first.text === '-' || first.text.startsWith('- ')) return sequence(first.indent, depth)
    return mapping(first.indent, depth)
  }
  function inlineAfter(rest, ownIndent, depth) {
    if (rest === '|' || rest === '|-' || rest === '|+') return blockScalar(ownIndent, false)
    if (rest === '>' || rest === '>-' || rest === '>+') return blockScalar(ownIndent, true)
    if (rest === '' || /^&[\w-]+$/.test(rest)) {
      skipBlank()
      if (at < lines.length && (lines[at].indent > ownIndent || (lines[at].indent === ownIndent && lines[at].text.startsWith('-')))) return value(lines[at].indent, depth + 1)
      return null
    }
    return scalar(rest)
  }
  function mapping(indent, depth) {
    const out = {}
    while (at < lines.length) {
      skipBlank()
      if (at >= lines.length) break
      const line = lines[at]
      if (line.indent < indent) break
      if (line.indent > indent) {
        warnings.push(line.text.slice(0, 40))
        at += 1
        continue
      }
      if (line.text.startsWith('- ') || line.text === '-') break
      const colon = keyColon(line.text)
      at += 1
      if (colon < 0) {
        warnings.push(line.text.slice(0, 40))
        continue
      }
      const key = unquote(line.text.slice(0, colon))
      const rest = line.text.slice(colon + 1).trim()
      if (key === '<<') {
        const merged = inlineAfter(rest, indent, depth)
        if (merged && typeof merged === 'object' && !Array.isArray(merged)) Object.assign(out, merged)
        continue
      }
      out[key] = inlineAfter(rest, indent, depth)
    }
    return out
  }
  function sequence(indent, depth) {
    const out = []
    while (at < lines.length) {
      skipBlank()
      if (at >= lines.length) break
      const line = lines[at]
      if (line.indent !== indent || !(line.text === '-' || line.text.startsWith('- '))) break
      const rest = line.text === '-' ? '' : line.text.slice(2).trim()
      if (rest === '') {
        at += 1
        out.push(value(indent + 1, depth + 1))
        continue
      }
      // "- key: value": a mapping whose first line sits after the dash.
      if (keyColon(rest) > 0 && !rest.startsWith('[') && !rest.startsWith('{') && !rest.startsWith('"') && !rest.startsWith("'")) {
        const inner = line.indent + (line.text.length - rest.length)
        lines[at] = { indent: inner, text: rest, raw: ' '.repeat(inner) + rest }
        out.push(mapping(inner, depth + 1))
        continue
      }
      at += 1
      out.push(scalar(rest))
    }
    return out
  }
  return value(0, 0)
}

/** Every document in a YAML file. → { docs: [value], warnings } */
export function parseYamlAll(source) {
  const warnings = []
  const docs = []
  let current = []
  for (const line of toLines(`${source ?? ''}`.replace(/\r\n?/g, '\n'))) {
    if (/^(---|\.\.\.)(\s|$)/.test(line.raw)) {
      if (current.some((l) => l.text !== '')) docs.push(parseLines(current, warnings))
      current = []
      const after = line.raw.replace(/^---\s*/, '').trim()
      if (after && !line.raw.startsWith('...')) current.push({ indent: 0, text: after, raw: after })
      continue
    }
    current.push(line)
  }
  if (current.some((l) => l.text !== '')) docs.push(parseLines(current, warnings))
  return { docs, warnings }
}

/** The first document. */
export const parseYaml = (source) => parseYamlAll(source).docs[0] ?? null
