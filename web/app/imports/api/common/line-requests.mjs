// A request about the slate's lines, said in plain words, read as it stands (no drafting):
//   “connect sing to asfd”, “draw a line from sing to asfd”    → a new line (connect_nodes)
//   “unpin the line ends”, “let the ends follow”, “pin the ends” → update_connections ends
//   “detach this line from asfd”, “free the end at asfd”         → that end left free beside asfd
//   “move this line to Gamma”, “attach the free end to Gamma”   → the far end onto Gamma
// Notes are named by their text, as written on them (any case). “This line” is the line selected
// on the canvas; without one, a note with a single line names that line. Each request becomes one
// canvas plan for slates.applyOperations, the same operations an agent's exec program sends.

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
const unquote = (text) => String(text ?? '').trim().replace(/^[“"'‘]|[”"'’]$/g, '').trim()
const politely = /^(?:(?:can|could|would|will) you(?: please)?\s+|please\s+|i(?:'|’)?d like (?:you to\s+)?|i want (?:you to\s+)?|let(?:'|’)?s\s+)/i
// “Link” is not here: a link is a note's web link (“attach the link to Pricing”).
const LINE = '(?:lines?|arrows?|connectors?|connections?|relationships?)'
const ONE_LINE = /^(?:line|arrow|connector|connection|relationship)$/i
const FREE_PREFIX = '__free_'

const say = (node) => '“' + String(node.options?.text ?? '').replace(/\s+/g, ' ').trim() + '”'
const isFree = (a) => Boolean(a.targetPoint) || String(a.childId || '').startsWith(FREE_PREFIX)

function lines(board) {
  return (board.nodes || []).flatMap((node) => (node.relationships?.associations || []).map((a) => ({ ...a, parentId: a.parentId || node.options?.id })))
}

function boxOf(node) {
  const o = node.options || {}
  return { x: Number(o.xPos ?? o.x ?? 0), y: Number(o.yPos ?? o.y ?? 0), w: Number(o.width ?? 120), h: Number(o.height ?? 80) }
}

class Refused extends Error {}

/** The note a name means: the one whose text is that name. */
function noteNamed(board, name) {
  const wanted = clean(unquote(name))
  if (!wanted) return null
  const found = (board.nodes || []).filter((node) => clean(node.options?.text) === wanted)
  if (found.length > 1) throw new Refused(`More than one note says “${unquote(name)}”. Select the line on the canvas, or rename one of them.`)
  return found[0] ?? null
}

function requireNote(board, name) {
  const node = noteNamed(board, name)
  if (!node) throw new Refused(`There is no note that says “${unquote(name)}”.`)
  return node
}

/** The line a request means: the selected one, the one between two named notes, or a note's only line. */
function lineFor(board, { selection, between, touching }) {
  const all = lines(board)
  if (between) {
    const [a, b] = between
    const found = all.filter((l) => (l.parentId === a.options.id && l.childId === b.options.id) || (l.parentId === b.options.id && l.childId === a.options.id))
    if (!found.length) throw new Refused(`There is no line between ${say(a)} and ${say(b)}.`)
    if (found.length > 1) throw new Refused(`There are ${found.length} lines between ${say(a)} and ${say(b)}. Select one on the canvas first.`)
    return found[0]
  }
  if (selection?.kind === 'line') {
    const chosen = all.find((l) => l.id === selection.id)
    if (chosen && (!touching || chosen.parentId === touching.options.id || chosen.childId === touching.options.id)) return chosen
  }
  if (touching) {
    const found = all.filter((l) => l.parentId === touching.options.id || l.childId === touching.options.id)
    if (!found.length) throw new Refused(`${say(touching)} has no lines.`)
    if (found.length > 1) throw new Refused(`${say(touching)} has ${found.length} lines. Select the one you mean on the canvas, or name both notes: “detach the line between A and B from B”.`)
    return found[0]
  }
  if (selection?.kind === 'line' && all.some((l) => l.id === selection.id)) return all.find((l) => l.id === selection.id)
  throw new Refused('Select the line on the canvas first, or name the notes it joins.')
}

/** Just outside a note, on the side facing the line's other end: where an end let go of it waits. */
function besideNote(board, line, node) {
  const b = boxOf(node)
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const otherId = line.parentId === node.options.id ? line.childId : line.parentId
  const other = isFree(line) && otherId === line.childId ? null : (board.nodes || []).find((n) => n.options?.id === otherId)
  const to = other ? (() => { const o = boxOf(other); return { x: o.x + o.w / 2, y: o.y + o.h / 2 } })() : line.targetPoint ?? { x: c.x + 1, y: c.y }
  const dx = to.x - c.x, dy = to.y - c.y
  const len = Math.hypot(dx, dy) || 1
  // From the middle to the edge along that direction, then 60 further out.
  const reach = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity) * len
  const out = Math.max(0, reach) + 60
  return { x: Math.round(c.x + (dx / len) * out), y: Math.round(c.y + (dy / len) * out) }
}

const plan = (message, operations) => ({ plan: { message, operations } })

function readLineRequest(board, message, selection) {
  let words = typeof message === 'string' ? message.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '') : ''
  if (!words || words.length > 300 || /[→\n]|->/.test(words)) return null
  words = words.replace(politely, '').replace(politely, '')
  let m

  // A new line between two notes.
  if ((m = new RegExp('^(?:connect|link|join)\\s+(.+?)\\s+(?:to|with|and)\\s+(.+)$', 'i').exec(words)) ||
      (m = new RegExp('^(?:draw|add|make|put)\\s+(?:an?|the|another)\\s+' + LINE + '\\s+from\\s+(.+?)\\s+to\\s+(.+)$', 'i').exec(words))) {
    // Names that are not notes on the slate are not this (they may be steps to draw, or a line's end).
    const from = noteNamed(board, m[1]), to = noteNamed(board, m[2])
    if (from && to) {
      if (from.options.id === to.options.id) throw new Refused('Connect two different notes.')
      return plan(`Connected ${say(from)} to ${say(to)}.`, [{ kind: 'connect_nodes', from: { ids: [from.options.id] }, to: { ids: [to.options.id] } }])
    }
  }

  // Pin the ends, or let them follow.
  // (“Lock” and “unlock” are for notes: “lock the line” is not read as pinning its ends.)
  const unpin = new RegExp('^(?:unpin|release)\\s+(the\\s+|this\\s+|that\\s+|all\\s+(?:the\\s+)?)?(?:' + LINE + '\\s+)?(ends?|' + LINE + ')(.*)$', 'i').exec(words) ||
    new RegExp('^(?:let|make)\\s+(the\\s+|this\\s+|all\\s+(?:the\\s+)?)?(?:' + LINE + '\\s+)?(ends?)(.*?)\\s+follow(?:\\s+(?:the|their)\\s+notes?)?$', 'i').exec(words)
  const pinIt = !unpin && new RegExp('^pin\\s+(?:down\\s+)?(the\\s+|this\\s+|that\\s+|all\\s+(?:the\\s+)?)?(?:' + LINE + '\\s+)?(ends?|' + LINE + ')(.*)$', 'i').exec(words)
  if (unpin || pinIt) {
    const [, article = '', noun, tail] = unpin || pinIt
    const rest = tail.trim()
    // “the line” (one) said of a slate with several and none selected: which one is not said.
    const one = ONE_LINE.test(noun) && !/^all/i.test(article)
    const mode = unpin ? 'follow' : 'pinned'
    let ids
    let what
    if ((m = /^(?:of|on)\s+(?:the\s+)?(?:line|arrow)?\s*(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i.exec(rest)) ||
        (m = /^(?:from|between)\s+(.+?)\s+(?:to|and)\s+(.+)$/i.exec(rest))) {
      const line = lineFor(board, { between: [requireNote(board, m[1]), requireNote(board, m[2])] })
      ids = [line.id]
      what = 'the line'
    } else if ((m = /^(?:of|on|from|at|around|touching)\s+(.+)$/i.exec(rest))) {
      const node = requireNote(board, m[1])
      ids = lines(board).filter((l) => l.parentId === node.options.id || l.childId === node.options.id).map((l) => l.id)
      if (!ids.length) throw new Refused(`${say(node)} has no lines.`)
      what = ids.length === 1 ? `the line at ${say(node)}` : `the ${ids.length} lines at ${say(node)}`
    } else if (!rest) {
      const all = lines(board)
      const chosen = selection?.kind === 'line' ? all.find((l) => l.id === selection.id) : null
      ids = chosen ? [chosen.id] : all.map((l) => l.id)
      if (!ids.length) throw new Refused('There are no lines on this slate.')
      if (one && ids.length > 1) throw new Refused(`There are ${ids.length} lines on this slate. Select the line on the canvas first, or say “all the lines”.`)
      what = chosen ? 'the selected line' : ids.length === 1 ? 'the line' : `all ${ids.length} lines`
    } else return null
    const said = mode === 'follow' ? `The ends of ${what} now follow their notes.` : `The ends of ${what} are now pinned where they are.`
    return plan(said, [{ kind: 'update_connections', connectionIds: ids, changes: { ends: mode } }])
  }

  // Let one end go, beside the note it was on.
  if ((m = new RegExp('^(?:detach|disconnect|unhook|unattach|free|release)\\s+(?:the\\s+|this\\s+|that\\s+)?' + LINE + '(?:\\s+(?:from|between)\\s+(.+?)\\s+(?:to|and)\\s+(.+?))?\\s+from\\s+(.+)$', 'i').exec(words)) ||
      (m = /^(?:free|release|detach)\s+(?:the\s+|this\s+)?(?:line'?s\s+)?end\s+(?:at|on)\s+()()(.+)$/i.exec(words))) {
    const node = requireNote(board, m[3])
    const between = m[1] ? [requireNote(board, m[1]), requireNote(board, m[2])] : null
    const line = lineFor(board, { selection, between, touching: between ? null : node })
    const at = besideNote(board, line, node)
    if (line.childId === node.options.id) {
      return plan(`Detached the line from ${say(node)}; its end is free beside it.`, [{ kind: 'update_connections', connectionIds: [line.id], changes: { toPoint: at } }])
    }
    if (line.parentId === node.options.id) {
      if (isFree(line)) throw new Refused(`That line's other end is already free. A line keeps one end on a note; delete it instead.`)
      return plan(`Detached the line from ${say(node)}; its end is free beside it.`, [{ kind: 'update_connections', connectionIds: [line.id], changes: { fromPoint: at } }])
    }
    throw new Refused(`That line is not on ${say(node)}.`)
  }

  // Move the far end (or a free end) onto a note.
  if ((m = new RegExp('^(?:reconnect|move|reattach|attach|connect)\\s+(?:the\\s+|this\\s+|that\\s+)?(?:free\\s+|loose\\s+)?(?:end\\s+of\\s+(?:the\\s+|this\\s+)?)?(?:' + LINE + '|end)(?:\\s+(?:from|between)\\s+(.+?)\\s+(?:to|and)\\s+(.+?))?\\s+(?:to|onto|on to)\\s+(.+)$', 'i').exec(words))) {
    // A place that is not a note (“move the line to the top”) is not this: moving lines is drafting's.
    const target = noteNamed(board, m[3])
    if (!target) return null
    const between = m[1] ? [requireNote(board, m[1]), requireNote(board, m[2])] : null
    let line
    if (between) line = lineFor(board, { between })
    else if (selection?.kind === 'line' && lines(board).some((l) => l.id === selection.id)) line = lineFor(board, { selection })
    else {
      const free = lines(board).filter(isFree)
      if (/free|loose/i.test(words) && free.length === 1) line = free[0]
      else throw new Refused('Select the line on the canvas first, or name the notes it joins: “move the line from A to B onto C”.')
    }
    if (line.parentId === target.options.id) throw new Refused(`That line starts at ${say(target)}; a line joins two different notes.`)
    if (line.childId === target.options.id) throw new Refused(`That line already ends at ${say(target)}.`)
    return plan(`Moved the end of the line onto ${say(target)}.`, [{ kind: 'update_connections', connectionIds: [line.id], changes: { toNote: target.options.id } }])
  }
  return null
}

/**
 * A plain request about lines: `{ plan }` (one canvas plan), `{ problem }` (a sentence saying
 * what to change in the request), or null when the message is not one.
 */
export function lineRequest(board, message, selection = null) {
  try {
    return readLineRequest(board || {}, message, selection)
  } catch (error) {
    if (error instanceof Refused) return { problem: error.message }
    throw error
  }
}
