import {
  applyWorkshopEdits, businessKind, rulebook, validateWorkshop, workshopCandidate, workshopCardAsNote, workshopCardAsNoteRefusal, workshopCardLines, workshopCardNoteText,
  workshopHardLimit, workshopLineRefusal, workshopNoteCandidate, workshopNoteRefusal, workshopOverrideCandidate, workshopRefusal, workshopWithLine, workshopWithoutLine,
} from 'slateboxjs/workshops/model'
import { unsafeKeyPath } from '../common/document-keys.mjs'
// A launch plan's, pipeline's or budget's rules: the same modules the canvas plays them by.
import 'slateboxjs/workshops/rules'

// A change a person makes to a workshop on the canvas: a card moved to a lane, a lane, a card or
// the workshop itself renamed, an ordinary note dropped on a lane becoming a card there, or a
// card dropped on the canvas leaving the board as an ordinary note. The canvas sends the change, not the board it produced,
// so the server can make it on the workshop as it stands when the change arrives. Two people
// who move different cards at the same moment both keep their move, and a move is refused only
// when the workshop's own rules refuse it on that latest board. On a launch plan, a pipeline or a
// budget every change comes as the edits it makes (a drag, a handle, a key, a rename), and they are
// made by the edit reducer every surface uses (applyWorkshopEdits), on the board as it stands.

const key = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
// A note's id: a card's kind of id, or an older note's (any text without control characters).
const noteKey = value => typeof value === 'string' && /^(?!\$)[^\u0000-\u001f\u007f]{1,200}$/.test(value)
const words = value => typeof value === 'string' && value.length <= 200
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
// The ordinary note a card became, as the canvas saves notes: its own id, plain keys, a note's size.
const savedNote = (value, id) => plain(value) && plain(value.options) && value.options.id === id && !unsafeKeyPath(value) &&
  JSON.stringify(value).length <= 20000
// A line with a card at one end, as the canvas keeps it (the workshop's own rules check it when it is drawn).
const lineKey = value => typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.:~>-]{0,159}$/.test(value)
const savedLine = value => plain(value) && lineKey(value.id) && noteKey(value.parentId) && noteKey(value.childId) && !unsafeKeyPath(value) &&
  JSON.stringify(value).length <= 2000
// A plan's day: a calendar offset from its first day (a hiring plan runs up to two years).
const planDay = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000
const savedLines = value => Array.isArray(value) && value.length <= 96 && value.every(savedLine)

/** The changes of one request, in the order they were made. Throws on anything else. */
export function readWorkshopChanges(input) {
  if (!Array.isArray(input) || !input.length || input.length > 50) throw new Error('Expected 1 to 50 changes.')
  return input.map(change => {
    if (change?.edits !== undefined) {
      // A business board's change: its edits, with the card or lane it shows on.
      const { edits, cardId, laneId } = change
      if (Array.isArray(edits) && edits.length >= 1 && edits.length <= 50 && edits.every(plain) && !unsafeKeyPath(edits) &&
          JSON.stringify(edits).length <= 20000 && (cardId === undefined || key(cardId)) && (laneId === undefined || key(laneId)) &&
          (change.override === undefined || change.override === true)) {
        const rename = change.rename
        const named = rename && (words(rename.title) ? { title: rename.title } : key(rename.laneId) && words(rename.label) ? { laneId: rename.laneId, label: rename.label }
          : key(rename.cardId) && words(rename.label) ? { cardId: rename.cardId, label: rename.label } : null)
        // `override`: an edit made anyway (a deal past its stages, a task past its rule, a card under another), once the
        // person confirmed it. The edit itself carries override true; the server marks who and when (playWorkshopChanges).
        const anyway = change.override === true || edits.some(edit => edit.override === true)
        return { edits, ...(cardId && { cardId }), ...(laneId && { laneId }), ...(named && { rename: named }), ...(anyway && { override: true }),
          ...(anyway && agreed(change.reason) && { reason: change.reason }) }
      }
      throw new Error('Expected a list of edits.')
    }
    const rename = change?.rename
    if (rename !== undefined) {
      if (words(rename?.title)) return { rename: { title: rename.title } }
      if (key(rename?.laneId) && words(rename.label)) return { rename: { laneId: rename.laneId, label: rename.label } }
      if (key(rename?.cardId) && words(rename.label)) return { rename: { cardId: rename.cardId, label: rename.label } }
    } else if (change?.noteToCard !== undefined) {
      // `asNote`: what the note had that the card does not show. `before`: the card it goes back in front of (an undo).
      // `lines`: the note's lines, which stay joined to the card.
      // `under`: on a nested board, the card it was dropped on, to sit under.
      // `day`: on a plan, the calendar day it was let go on, where its task starts (the plan snaps it by its rules).
      const note = change.noteToCard
      const { look, asNote, before, lines, under, day } = note ?? {}
      if (key(change.cardId) && key(change.laneId) && noteKey(note?.noteId) && words(note.label) &&
          (look === undefined || plain(look)) && (asNote === undefined || plain(asNote)) && (before === undefined || key(before)) &&
          (lines === undefined || savedLines(lines)) && (under === undefined || key(under)) && (day === undefined || planDay(day))) {
        return { cardId: change.cardId, laneId: change.laneId, noteToCard: { noteId: note.noteId, label: note.label,
          ...(look === undefined ? {} : { look }), ...(asNote === undefined ? {} : { asNote }), ...(before === undefined ? {} : { before }),
          ...(lines === undefined ? {} : { lines }), ...(under === undefined ? {} : { under }), ...(day === undefined ? {} : { day }) } }
      }
    } else if (change?.line !== undefined) {
      // A line drawn, restyled or taken away with a card at one end.
      const { set, remove } = change.line ?? {}
      if (set !== undefined && remove === undefined && savedLine(set)) return { line: { set } }
      if (remove !== undefined && set === undefined && lineKey(remove)) return { line: { remove } }
    } else if (change?.cardToNote !== undefined) {
      // `note`: the ordinary note the card became, saved with the drawing in the same write as the board.
      const { noteId, note } = change.cardToNote ?? {}
      if (key(change.cardId) && noteKey(noteId) && (note === undefined || savedNote(note, noteId))) {
        return { cardId: change.cardId, cardToNote: { noteId, ...(note === undefined ? {} : { note }) } }
      }
    } else if (key(change?.cardId) && key(change?.laneId) && (change.override === undefined || change.override === true)) {
      // `override`: a move the rules refuse, made anyway once the person confirmed it ("Move anyway").
      // `reason`: the rule's sentence the person agreed to; a board that would break another is asked about again.
      return { cardId: change.cardId, laneId: change.laneId, ...(change.override && { override: true }), ...(change.override && agreed(change.reason) && { reason: change.reason }) }
    }
    throw new Error('Expected a move or a rename.')
  })
}

const gone = what => `That ${what} is no longer on the workshop.`

/** A rule's sentence a person agreed to ("Move anyway"): plain words, as long as a mark keeps (300). */
const agreed = value => typeof value === 'string' && value.length > 0 && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value)

/**
 * Make `changes` on `workshop`, in order, under the workshop's rules. Returns the workshop that
 * results and what the trades among the changes do to the slate's drawing (`drawing`: the ids of
 * notes to take out and the notes to put in; see drawingAfter), or the first refusal: the reason
 * as a sentence and the lane to show it on, with `at`, the index of the change refused. `taken`
 * says someone else made that same trade first: the note is a card already, or the card a note.
 * A move to the lane a card is already in changes nothing, so a request delivered twice does no
 * harm. `noteIds` are the ids of the notes in the slate's saved drawing; without them a card that
 * has already left the board is taken as this same request delivered again. `trades` is the
 * slate's trade record (creative.trades): a card that left the board as a note with the same id is
 * this request again only when the note is the one that trade saved. Two people taking the same
 * card off at once both make the note with the card's id, and the second must hear it was taken
 * (staging-2, 2026-11-20: told it was saved, it told the room of its own note, so every screen
 * drew the note where the second person dropped it while the server kept the first one's).
 */
export function playWorkshopChanges(workshop, changes, noteIds, trades, actor = null) {
  let board = validateWorkshop(workshop)
  const drawing = new Set(noteIds ?? [])
  const remove = new Set(), add = new Map()
  // The lines that join the drawing (a card's lines to notes, once it is a note), by id.
  const lines = new Map()
  const played = changes.map((change, at) => ({ change, at }))
  const refuse = (at, refused, taken = false) => ({ refused, at, ...(taken ? { taken: true } : {}) })
  // What a warn rule says of a card that landed anyway (dragology §4: the drop lands, with one line).
  const warnings = []
  const heard = (was, now) => {
    if (!was.behaviour || now === was) return
    const verdict = rulebook().check(was, now)
    if ('warnings' in verdict) for (const line of verdict.warnings) if (!warnings.includes(line)) warnings.push(line)
  }
  for (const { change, at } of played) {
    if (change.edits) {
      // A launch plan, a pipeline or a budget is played by its edits; so is a map's path changed on the canvas in
      // focus (its grips, a path removed): the path edits chat and exec make (boards S2b).
      const paths = board.lanes[0]?.station && change.edits.every(edit => edit?.kind === 'connect_stations' || edit?.kind === 'disconnect_stations')
      if (!businessKind(board) && !paths) return refuse(at, { reason: 'This workshop is played by moves and renames.', laneId: null })
      // An edit made anyway is marked with who (the server's name for them, never the page's) and when.
      const made = applyWorkshopEdits(board, change.edits, change.override ? { actor: { by: actor?.by || 'Someone', via: 'chat' }, ...(actor?.at && { now: actor.at }) } : {})
      if ('refused' in made) {
        const { reason, laneId, cardId, limits, overridable } = made.refused
        const lane = laneId ?? board.cards.find(item => item.id === (cardId ?? change.cardId))?.laneId ?? change.laneId ?? null
        return refuse(at, { reason, laneId: lane, ...(limits && { limits }), ...(overridable && { overridable: true }) })
      }
      // Made anyway past a rule the person did not see (a teammate's change came first, and the board it is made on now
      // breaks something else): asked again with the sentence as it is now, never saved under one they did not agree to.
      const unseen = change.override && typeof change.reason === 'string' && (made.report.overrides ?? []).find(item => item.sentence !== change.reason)
      if (unseen) return refuse(at, { reason: unseen.sentence, laneId: unseen.laneId, overridable: true })
      board = made.workshop
      continue
    }
    if (change.rename) {
      const { title, laneId, cardId, label } = change.rename
      const lane = laneId && board.lanes.find(item => item.id === laneId)
      const card = cardId && board.cards.find(item => item.id === cardId)
      if (laneId && !lane) return refuse(at, { reason: gone('lane'), laneId: null })
      if (cardId && !card) return refuse(at, { reason: gone('card'), laneId: null })
      if (businessKind(board)) {
        // A launch plan's, pipeline's or budget's names follow its own rules (a stage named for another
        // stage, a deal's name with an amount in it): a rename is the edit it makes.
        const edit = title !== undefined ? { kind: 'rename_workshop', title } : lane ? { kind: 'rename_lane', lane: { id: lane.id }, label }
          : { kind: 'rename_card', card: { id: card.id }, label }
        const made = applyWorkshopEdits(board, [edit])
        if ('refused' in made) {
          const { reason, limits } = made.refused
          return refuse(at, { reason, laneId: lane?.id ?? card?.laneId ?? null, ...(limits && { limits }) })
        }
        board = made.workshop
        continue
      }
      try {
        board = validateWorkshop(title !== undefined ? { ...board, title }
          : lane ? { ...board, lanes: board.lanes.map(item => item.id === laneId ? { ...item, label } : item) }
          : { ...board, cards: board.cards.map(item => item.id === cardId ? { ...item, label } : item) })
      } catch (error) {
        return refuse(at, { reason: error instanceof Error ? error.message : 'That name is not allowed.', laneId: lane?.id ?? card?.laneId ?? null })
      }
      continue
    }
    if (change.line) {
      const { set, remove: lineId } = change.line
      if (lineId !== undefined) { board = workshopWithoutLine(board, lineId); continue }
      const next = workshopWithLine(board, set)
      if (!next) {
        const card = board.cards.find(item => item.id === set.parentId || item.id === set.childId)
        return refuse(at, { reason: workshopLineRefusal(board, set) ?? 'That line can\'t be drawn.', laneId: card?.laneId ?? null })
      }
      board = next
      continue
    }
    if (change.noteToCard) {
      const { noteId, label, look, asNote, before, under, day, lines: noteLines } = change.noteToCard
      const text = label.replace(/\s+/g, ' ').trim()
      const there = board.cards.find(item => item.id === change.cardId)
      const leaves = () => { add.delete(noteId); remove.add(noteId) }
      // The note's words name the card with its numbers ("Audit log · 3 points"), as the card says them back.
      const same = there && (there.label === text || workshopCardNoteText(board, there).replace(/\s+/g, ' ').trim() === text)
      // Delivered twice: the card is already there, as the note made it.
      if (same && there.laneId === change.laneId) { leaves(); continue }
      // The same note, put on the board by someone else first: theirs is the card.
      if (same) return refuse(at, { reason: `Someone else put ${there.label} on the board first.`, laneId: there.laneId }, true)
      if (there) return refuse(at, { reason: 'That card is already on the board.', laneId: there.laneId })
      // The card is made under the card id the canvas chose; the note it came from is remembered when that differs.
      const offer = { id: change.cardId, label, ...(look ? { look } : {}), ...(asNote ? { asNote } : {}), ...(under ? { under } : {}), ...(day !== undefined ? { day } : {}),
        ...(noteLines ? { lines: noteLines.map(line => ({ ...line, ...(line.parentId === noteId ? { parentId: change.cardId } : {}),
          ...(line.childId === noteId ? { childId: change.cardId } : {}) })) } : {}) }
      const refusal = workshopNoteRefusal(board, change.laneId, offer)
      if (refusal) return refuse(at, { reason: refusal, laneId: board.lanes.some(item => item.id === change.laneId) ? change.laneId : null })
      let next = workshopNoteCandidate(board, change.laneId, offer, before)
      if (!next?.cards.some(item => item.id === change.cardId)) return refuse(at, { reason: 'That card is already on the board.', laneId: change.laneId })
      if (noteId !== change.cardId) next = validateWorkshop({ ...next, cards: next.cards.map(item => item.id === change.cardId ? { ...item, noteId } : item) })
      heard(board, next)
      board = next
      leaves()
      continue
    }
    if (change.cardToNote) {
      const { noteId, note } = change.cardToNote
      const there = board.cards.find(item => item.id === change.cardId)
      if (!there) {
        // The same request delivered again (its note is in the drawing), or a caller that does
        // not know the drawing: nothing more happens. Otherwise someone else took the card off
        // the lanes first, and theirs is the note.
        if (!noteIds || add.has(noteId) || (drawing.has(noteId) && sameTradeAgain(tradeOf(trades, noteId), note))) continue
        return refuse(at, { reason: `Someone else took ${note?.options?.text ? String(note.options.text).replace(/\s+/g, ' ').trim().slice(0, 80) : 'that card'} off the lanes first.`, laneId: null }, true)
      }
      const next = workshopCardAsNote(board, there.id, noteId)
      if (!next) return refuse(at, { reason: workshopCardAsNoteRefusal(board, there.id) ?? 'That card stays on the board.', laneId: there.laneId })
      // Its lines to notes are the drawing's again, under the note's id; its lines to cards stay on the board.
      for (const line of workshopCardLines(board, there.id, noteId).leave) lines.set(line.id, line)
      board = next
      if (note) add.set(noteId, note)
      continue
    }
    const card = board.cards.find(item => item.id === change.cardId)
    const lane = board.lanes.find(item => item.id === change.laneId)
    if (!card) return refuse(at, { reason: gone('card'), laneId: lane?.id ?? null })
    if (!lane) return refuse(at, { reason: gone('lane'), laneId: card.laneId })
    let next = workshopCandidate(board, card.id, lane.id)
    // A move the rules refuse, made anyway once the person confirmed it: marked here with who (the server's name for
    // them, never the page's) and when. A hard limit is refused all the same.
    if (!next && change.override) {
      next = workshopOverrideCandidate(board, card.id, lane.id, { by: actor?.by || 'Someone', at: actor?.at ?? new Date().toISOString() })
      if (!next) return refuse(at, { reason: workshopHardLimit(board, card.id, lane.id) ?? 'That move is not available.', laneId: lane.id })
      // Past a rule the person did not see (the board changed under them): asked again, as above.
      const sentence = next.cards.find(item => item.id === card.id)?.override?.sentence
      if (typeof change.reason === 'string' && sentence && sentence !== change.reason) return refuse(at, { reason: sentence, laneId: lane.id, overridable: true })
    }
    if (!next) return refuse(at, { reason: workshopRefusal(board, card.id, lane.id) ?? 'That move is not available.', laneId: lane.id, ...(workshopHardLimit(board, card.id, lane.id) === null && { overridable: true }) })
    heard(board, next)
    board = next
  }
  return { workshop: board, drawing: { remove: [...remove], add: [...add.values()], ...(lines.size ? { lines: [...lines.values()] } : {}) }, ...(warnings.length && { warnings }) }
}

/** Whether a card -> note of `note` is the stored trade delivered again (or cannot be told apart from it). */
function sameTradeAgain(trade, note) {
  if (!trade || trade.as !== 'note' || !trade.note || !note) return true
  return canonical(trade.note) === canonical(note)
}
const canonical = value => JSON.stringify(value, (key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item)

/**
 * The slate's saved notes once a request's trades are made on them: the notes that became cards
 * taken out, with every line to them (they are the board's now), and the notes cards became put
 * in (in place of any earlier copy), with the lines that join them to other notes or end free on
 * the canvas (`lines`), each saved on the note it starts from, once.
 */
export function drawingAfter(nodes, drawing) {
  const out = new Set([...drawing.remove, ...drawing.add.map(note => note.options.id)])
  const gone = new Set(drawing.remove)
  let after = [...(nodes ?? []).filter(node => !out.has(node?.options?.id)), ...drawing.add]
  const associations = node => Array.isArray(node?.relationships?.associations) ? node.relationships.associations : []
  if (gone.size) {
    after = after.map(node => associations(node).some(link => gone.has(link?.childId))
      ? { ...node, relationships: { ...node.relationships, associations: associations(node).filter(link => !gone.has(link?.childId)) } } : node)
  }
  const ids = new Set(after.map(node => node?.options?.id))
  for (const line of drawing.lines ?? []) {
    // A line whose far end is free on the canvas (targetPoint) needs only the note it starts from.
    if (!ids.has(line.parentId) || (!line.targetPoint && !ids.has(line.childId))) continue
    const at = after.findIndex(node => node?.options?.id === line.parentId)
    const parent = after[at]
    if (associations(parent).some(link => link?.id === line.id)) continue
    after[at] = { ...parent, relationships: { ...(parent.relationships ?? {}), associations: [...associations(parent), { ...line }] } }
  }
  return after
}

/**
 * The slate's record of note and card trades once a request's trades are made at revision `r`:
 * each note's newest trade, `as: 'card'` (it left the drawing) or `as: 'note'` (a card became it,
 * saved as `note`). Every screen draws a trade it has not drawn from this record, and the next to
 * load the slate tells the room of it if the page that made it went away first.
 */
export function tradesAfter(trades, drawing, r) {
  const out = { ...(trades ?? {}) }
  const notes = new Set(drawing.add.map(note => note.options.id))
  const named = id => (tradeKey(id) === id ? {} : { id })
  for (const id of drawing.remove) if (!notes.has(id)) out[tradeKey(id)] = { r, as: 'card', ...named(id) }
  for (const note of drawing.add) {
    const id = note.options.id
    // The note's lines to other notes go with the record: a screen that hears of the trade only from
    // here (the trading page went away first) draws them with the note.
    const lines = (drawing.lines ?? []).filter(line => line.parentId === id || line.childId === id)
    out[tradeKey(id)] = { r, as: 'note', note, ...(lines.length ? { lines } : {}), ...named(id) }
  }
  return out
}

/**
 * The key a note's trade is kept under in creative.trades: its id, or for an id the store cannot use
 * as a key (an older note's, with dots or spaces), a key made from it. The record then names the note (`id`).
 */
export function tradeKey(id) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : 'enc-' + Buffer.from(String(id), 'utf8').toString('base64url')
}

/** A note's newest trade in a record of trades. */
export function tradeOf(trades, id) {
  return trades?.[tradeKey(id)]
}
