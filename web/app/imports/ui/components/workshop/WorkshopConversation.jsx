import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { moverName } from '../../../api/common/mover-name.mjs'
import { undoWordsHere } from '../../../api/common/undo-redo-keys.mjs'
import { Meteor } from 'meteor/meteor'
import { Box, Button, IconButton, Typography } from '@mui/material'
import Close from '@mui/icons-material/Close'
import { workshopPresentationLanes } from 'slateboxjs/workshops/model'
import ConversationPanel, { ConversationComposer } from '../ConversationPanel'
import { proposeLaneReply } from '../../../api/common/lane-conversation.mjs'
import { proposeDirectMapEdit } from '../../../api/common/map-direct-edits.mjs'
import { workshopStarters } from '../../../api/common/workshop-starters.mjs'
import { FIRST_RUN_GREETING, firstRunStarters } from '../../../api/common/first-slate-starters.mjs'
import { asksWhatElse, boardSuggestions, editingLabel, focusContext, focusPlaceholder } from '../../../api/common/board-focus.mjs'
import PayNotice, { isCreditRefusal } from '../PayNotice'
import { nativeRequestKind } from '../../../api/common/native-canvas-conversation.mjs'
import AddStrip, { AddShort } from '../library/AddStrip'
import ChatTurn, { ChatThinking } from '../ChatTurn'
import { loadLibrary } from '../library/libraryBus'
import { pickBoard, whichBoard } from '../../../api/common/board-pick.mjs'
import { MAX_BOARDS } from '../../../api/common/slate-boards.mjs'
import BoardRules from './BoardRules'
import { drawingHeading, previewKeepSentence } from '../../../api/common/conversation-preview.mjs'

const LibraryView = lazy(loadLibrary)
const LibraryCards = lazy(() => loadLibrary().then(m => ({ default: m.LibraryCards })))
const BoardMoves = lazy(() => loadLibrary().then(m => ({ default: m.BoardMoves })))
const libraryModule = () => import('../../../api/common/library.mjs')
// On a phone the composer gives the conversation room once it has turns: the prompt line goes.
/** Whether the newest turn carries buttons of its own to answer (the refusal's ways on, looks to choose from, which board). */
const ownButtons = (turn, payRefusal) => Boolean(turn?.role === 'assistant' && ((turn.pay && payRefusal) || turn.choices?.length || turn.boards?.length))
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 600px)').matches
// "Add a retro" typed on a slate that holds 8 boards (the most for now): the same question the Add buttons ask.
const newSlateTurnOf = (lib, id, said) => ({ ...lib.newSlateTurn(lib.catalogEntry(id)), opens: said })
// A library entry on a slate that holds 8 boards opens on a new slate, with its add message as the
// new slate's opening message. Below that it is added beside the boards here (boards S4a).
const onNewSlate = say => { window.location.assign('/new#' + new URLSearchParams({ brief: say }).toString()) }

// A slate that was a drawing before it gained its workshop has one conversation: the turns kept
// while it was only a drawing come first.
function loadHistory(key, drawingKey, keep) {
  try {
    const saved = JSON.parse(localStorage.getItem(key))
    if (Array.isArray(saved)) return keep(saved.filter(turn => turn && ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string'))
    const drawn = JSON.parse(localStorage.getItem(drawingKey))
    if (Array.isArray(drawn)) return keep(drawn.filter(turn => typeof turn?.message === 'string' && typeof turn?.reply === 'string')
      .flatMap(turn => [{ role: 'user', content: turn.message }, { role: 'assistant', content: turn.reply }]))
  } catch { /* Local storage is optional. */ }
  return []
}

/**
 * The slate's conversation when the slate carries a workshop: the same panel, message box and
 * starters as on any slate. A message is a sentence about the lanes and cards that are there
 * (“Move Third $200 to Customer calls”). It becomes a proposal, read here or by Canvas AI on the
 * server; the canvas shows it, and it is saved only when the person keeps it, on the revision it
 * was proposed for. Anything else (notes for the slate, steps to draw, a question) goes to the
 * slate's own conversation, the one a slate without a workshop has, with the selection as context:
 * the starters for a selection are shortcuts, never the limit of what may be typed.
 *
 * A slate holds up to 8 boards (boards S4a). `boards` are all of them, `board` the one the page speaks
 * for (in focus, with a preview, with something selected, or the first). Each message goes to one board:
 * the one in focus, the one with the selection, one the message names, or the only one; otherwise the chat
 * asks "Which board, Retro or Sprint?" with a chip per board (board-pick.mjs). A library entry is added
 * beside the boards, previewed first, then kept (the page draws it live).
 */
// `firstRun`: the slate's options.firstRun (the first run made it): its planned starters until the first message.
// `creationBrief`: the words a slate was made from ("You asked for: …").
export default function WorkshopConversation({ board: shown, boards: all, onChangeBoard, onKept, shareId, onClose, onPreview, readNodes, library = null, firstRun = null, creationBrief = null }) {
  const boards = all?.length ? all : [shown]
  // The board a person picked for a message ("Which board?"), until another is focused or selected.
  const [picked, setPicked] = useState(null)
  const board = boards.find(item => item.preview) ?? boards.find(item => item.focus) ?? boards.find(item => item.selection)
    ?? boards.find(item => item.boardId === picked) ?? shown
  const { model, revision, preview, setPreview, selection, save, toCanvas } = board
  const full = boards.length >= MAX_BOARDS
  const map = Boolean(model.lanes[0].station)
  const storageKey = (map ? 'slatebox-map-studio:' : 'slatebox-workshop-studio:') + Meteor.userId() + ':' + shareId
  const keep = turns => turns.slice(map ? -8 : -10).map(({ role, content, catalog, opens, adds, boards: asked, again, choices, pay }) => ({ role, content: content.slice(0, map ? 800 : 1000),
    // The meter's refusal: the turn that carries Pro and a balance (only while that refusal is the page's).
    ...(pay === true && { pay: true }),
    // A look to choose from ("Stronger borders", "Bolder headers", "Both"), each a sentence the chat reads as it is.
    ...(Array.isArray(choices) && { choices: choices.filter(item => typeof item?.label === 'string' && typeof item?.say === 'string').slice(0, 3)
      .map(item => ({ label: item.label.slice(0, 40), say: item.say.slice(0, 200) })) }),
    ...(Array.isArray(catalog) && { catalog: catalog.filter(id => typeof id === 'string').slice(0, 10) }), ...(typeof opens === 'string' && { opens: opens.slice(0, 200) }),
    ...(typeof adds === 'string' && { adds: adds.slice(0, 200) }),
    ...(Array.isArray(asked) && typeof again === 'string' && { boards: asked.filter(item => typeof item?.id === 'string').slice(0, 8)
      .map(item => ({ id: item.id, title: String(item.title ?? '').slice(0, 120) })), again: again.slice(0, 1000) }) }))
  // What Canvas AI is sent: the words of each turn only.
  const spoken = turns => turns.map(({ role, content }) => ({ role, content }))
  const [history, setHistory] = useState(() => loadHistory(storageKey, 'slatebox:native-chat:' + Meteor.userId() + ':' + shareId, keep))
  const [request, setRequest] = useState('')
  const [access, setAccess] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // A drawing proposal from the slate's own conversation: notes or steps to add beside the workshop.
  const [drawing, setDrawing] = useState(null)
  // Drafting this request is past this month's included amount (or needs Slatebox Pro); the notice offers the way on.
  // A refusal the pay sheet answers (Get Pro, top up…), with the message it refused, to send again after.
  const [payRefusal, setPayRefusal] = useState(null)
  // The library view in place of the conversation, and "What can this do?" for this board.
  const [view, setView] = useState(null)
  const [moves, setMoves] = useState(null)
  // The board's sentences about its rules and its business fields (board-chat, with the rulebook) load
  // when a message is first sent on a board that takes them, never for a decision path. If they can't
  // load, the message goes on as before and the chat says rule sentences are not available.
  const grammar = useRef(null)
  const loadGrammar = () => {
    if (map) return Promise.resolve(false)
    grammar.current ??= Promise.all([import('slateboxjs/workshops/behaviour'), import('../../../api/common/board-chat.mjs')]).then(() => true, err => {
      console.warn('The board\'s sentences could not be loaded.', err)
      grammar.current = null
      return false
    })
    return grammar.current
  }
  const actor = { by: moverName(Meteor.user()) }
  const running = useRef(false)
  const asked = useRef(0)
  const mounted = useRef(false)
  const input = useRef(null)
  const locked = board.saving
  const stale = Boolean(preview && preview.revision !== revision)
  // A drawing proposal is made against the slate's notes as they were when it was asked for. Once
  // they have moved on (a card traded onto the canvas, a note moved, renamed or deleted, here or by
  // a teammate) Keep would be refused, so it is not offered, and the preview leaves the canvas.
  const [drawingStale, setDrawingStale] = useState(false)
  useEffect(() => {
    setDrawingStale(false)
    if (!drawing || !readNodes || drawing.before === undefined) return undefined
    const check = () => { try { if (readNodes() !== drawing.before) setDrawingStale(true) } catch { /* The slate is still loading. */ } }
    check()
    const timer = setInterval(check, 600)
    return () => clearInterval(timer)
  }, [drawing])
  // A drawing proposal is drawn on the canvas while it waits for Keep or Discard.
  useEffect(() => { onPreview?.(drawing?.canvas && !drawingStale ? { canvas: drawing.canvas } : null) }, [drawing, drawingStale])
  useEffect(() => () => onPreview?.(null), [])

  useEffect(() => {
    mounted.current = true
    Meteor.callAsync('workshops.account').then(result => {
      if (mounted.current) setAccess(Boolean(result.canGenerate))
    }).catch(() => {
      if (!mounted.current) return
      setAccess(false)
      setError('Canvas AI could not be reached. You can still describe a change and preview it.')
    })
    return () => { mounted.current = false }
  }, [map])
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(history)) } catch { /* Private browsing can block storage. */ }
  }, [history, storageKey])

  const selected = selection && (selection.kind === 'lane' ? model.lanes : model.cards).find(item => item.id === selection.id)
  // The board in focus (the gear's "Change this board"): "this" is the board, or a lane or card selected on it.
  const focus = board.focus ?? null
  const context = (!map && focusContext(model, focus, selection)) || (selected ? { kind: selection.kind, id: selected.id } : null)
  // A first-run slate opens with its three planned starters until the conversation's first message;
  // the board's sentences (launch plans, budgets) load first, so each is checked as it would be read.
  const seeded = Boolean(firstRun?.starters?.length && !history.length && boards.length === 1)
  const [grammarReady, setGrammarReady] = useState(false)
  useEffect(() => { if (seeded) loadGrammar().then(ok => { if (mounted.current) setGrammarReady(ok) }) }, [seeded])
  const starters = focus ? boardSuggestions(model, actor) : seeded && !context && (grammarReady || map) ? firstRunStarters(model, firstRun.starters) : workshopStarters(model, context)
  const append = (...turns) => setHistory(prev => keep([...prev, ...turns]))
  const suggest = ({ text, select }) => {
    setRequest(text)
    setError('')
    requestAnimationFrame(() => { input.current?.focus(); if (select) input.current?.setSelectionRange(select[0], select[1]) })
  }

  // "What can this do?" (or, with the board in focus, "What else can this board do?"): the board's own phrases.
  async function whatCanItDo(question = 'What can this do?') {
    setView(null)
    await loadGrammar()
    const lib = await libraryModule()
    append({ role: 'user', content: question }, { role: 'assistant', content: 'Here is what this board can do. Tap a phrase to use it.' })
    setMoves(lib.boardMoves(model, actor))
  }
  // The slate's own conversation: what a slate without a workshop does with a message.
  async function drawOnSlate(message) {
    const turns = []
    for (let i = 0; i + 1 < history.length; i++) {
      if (history[i].role === 'user' && history[i + 1].role === 'assistant') turns.push({ message: history[i].content, reply: history[i + 1].content.slice(0, 4000) })
    }
    // Notes and steps for the slate are drawn through exec (canvasConversation.*); an interactive
    // route keeps its own methods (nativeCanvas.*).
    const via = nativeRequestKind(message) === 'draw' ? 'canvasConversation' : 'nativeCanvas'
    let before
    try { before = readNodes?.() } catch { /* Checked again on Keep by the server. */ }
    const draft = await Meteor.callAsync(via + '.preview', shareId, message, turns.slice(-6),
      selected ? { kind: context.kind, label: selected.label.slice(0, 120) } : context?.kind === 'board' ? { kind: 'board', label: model.title.slice(0, 120) } : null)
    // A question answered in words: nothing to keep.
    if (draft.reply) return { reply: draft.reply }
    return { drawing: { ...draft, message, via, before } }
  }

  // `target`: the board the message goes to (pickBoard), which may not be the one shown.
  async function propose(message, target = board) {
    if (target !== board) return proposeOn(message, target)
    if (map) {
      // "What else can this board do?" is answered from the library; a map's own sentences (connect two steps,
      // remove a path, move the token) are read here first, with no AI call (boards S2b); the AI turn takes the rest.
      if (asksWhatElse(message)) {
        const lib = await libraryModule()
        return { reply: 'Here is what this board can do. Tap a phrase to use it.', moves: lib.boardMoves(model, actor) }
      }
      try { return { ...proposeDirectMapEdit(model, message, context ?? undefined), revision } } catch (err) {
        if (err.code !== 'not-understood') throw err
        if (access) return Meteor.callAsync('workshops.mapChat', { shareId, revision, message, history: spoken(history), ...(context && { selection: context }), ...boardOf(board) })
        return drawOnSlate(message)
      }
    }
    // This board's own sentences first (its lanes, cards and rules), then the library: "What can this
    // do?", "Add a retro" (it opens on a new slate) and "what can I add?", all answered here, with no AI call.
    const understood = await loadGrammar()
    if (asksWhatElse(message)) {
      const lib = await libraryModule()
      return { reply: 'Here is what this board can do. Tap a phrase to use it.', moves: lib.boardMoves(model, actor) }
    }
    try {
      return { ...proposeLaneReply(model, message, context, actor), revision }
    } catch (err) {
      // Notes for the slate itself: drawn beside the workshop.
      if (err.code === 'drawing') return drawOnSlate(message)
      if (err.code !== 'not-understood') throw err
      const lib = await libraryModule().catch(() => null)
      const local = lib?.libraryTurn(message)
      // "What can I add?" on a first-run slate: the board that goes with this one first (its third starter).
      const companion = local?.all && firstRun?.starters?.length ? lib.catalogAddRequest(firstRun.starters.at(-1).text)?.id : null
      if (local) return { reply: full ? 'This slate holds 8 boards, the most for now: each of these opens on a new slate.' : 'Each of these goes beside the boards on this slate.',
        catalog: companion ? [companion, ...local.entries.filter(id => id !== companion)] : local.entries }
      if (!understood && !map && /\b(?:rule|limit|hold|holds|warn|bin|archive)\b/i.test(message)) {
        throw Error('The board’s rule sentences could not be loaded. Check the connection and try again.')
      }
      // The board in focus can't do it (no rule or edit of its own reads it): another component that
      // does is recommended, from the catalogue only, never forced. Then the AI turn, which may name one too.
      const better = focus && lib?.catalogSuggest(message, model)
      if (better) { const turn = lib.recommendTurn(model, better); return { reply: turn.content, catalog: turn.catalog, adds: turn.adds } }
      if (!access) return drawOnSlate(message)
      const answer = await Meteor.callAsync('workshops.laneChat', { shareId, revision, selection: context, message, history: spoken(history), ...boardOf(board) })
      const named = answer?.recommend && lib?.catalogEntry(answer.recommend.component)
      if (named && !answer.workshop) return { reply: answer.reply, catalog: [named.id], adds: named.addSay[0] }
      return answer
    }
  }
  // A message for a board other than the one shown (named in it, or picked): its own sentences, then the AI turn on it.
  async function proposeOn(message, target) {
    const other = target.model
    const otherMap = Boolean(other.lanes[0].station)
    const at = target.focus ? focusContext(other, target.focus, target.selection) : target.selection ? { kind: target.selection.kind, id: target.selection.id } : null
    if (otherMap) {
      try { return { ...proposeDirectMapEdit(other, message, at ?? undefined), revision: target.revision } } catch (err) {
        if (err.code !== 'not-understood') throw err
        if (access) return Meteor.callAsync('workshops.mapChat', { shareId, revision: target.revision, message, history: spoken(history), ...(at && { selection: at }), ...boardOf(target) })
        return drawOnSlate(message)
      }
    }
    await loadGrammar()
    try { return { ...proposeLaneReply(other, message, at, actor), revision: target.revision } } catch (err) {
      if (err.code === 'drawing') return drawOnSlate(message)
      if (err.code !== 'not-understood') throw err
      if (!access) return drawOnSlate(message)
      return Meteor.callAsync('workshops.laneChat', { shareId, revision: target.revision, selection: at, message, history: spoken(history), ...boardOf(target) })
    }
  }
  // The AI turn names a further board (b2…); the first board's turn is as it always was.
  const boardOf = target => target?.boardId && target.boardId !== 'main' ? { boardId: target.boardId } : {}

  // `chosenId`: the board a person picked for this message from "Which board?".
  async function submit(again = null, chosenId = null) {
    const said = (typeof again === 'string' ? again : request).trim()
    if (!said || locked || running.current || boards.some(item => item.preview) || drawing || access === null) return
    // "Add a retro": a library entry, added beside the boards (no board to choose).
    const lib = await libraryModule().catch(() => null)
    const add = lib?.catalogAddRequest(said)
    if (add && full) { setRequest(''); const turn = newSlateTurnOf(lib, add.id, said); append({ role: 'user', content: said }, { role: 'assistant', content: turn.content, opens: turn.opens }); return }
    // Which board the message is about (focus, selection, named, the only one), or the chat asks.
    const chosen = chosenId ? boards.find(item => item.boardId === chosenId) : null
    // Notes, a drawing or a question for the slate itself goes to the slate: only a board change asks "Which board?".
    const picking = add ? { board, message: said } : pickBoard(boards, said, chosen, nativeRequestKind(said))
    if (picking.ask) {
      setRequest('')
      append({ role: 'user', content: said }, { role: 'assistant', content: whichBoard(picking.ask), boards: picking.ask.map(item => ({ id: item.boardId, title: item.model.title })), again: said })
      return
    }
    const target = picking.board ?? board
    const message = picking.message
    // A launch plan, pipeline or budget in their words is built by its readers (beside the board, or in place
    // of an untouched first-run board), never sent to the board's own sentences or an agent.
    const onSlate = Boolean(add || picking.slate || nativeRequestKind(said) === 'board')
    if (chosen) setPicked(chosen.boardId)
    if (!onSlate && target.focus && asksWhatElse(message)) { setRequest(''); whatCanItDo(message); return }
    running.current = true
    const turn = ++asked.current
    setBusy(true)
    setError('')
    setPayRefusal(null)
    try {
      const proposal = onSlate ? await drawOnSlate(said) : await propose(message, target)
      if (!mounted.current || turn !== asked.current) return
      setRequest('')
      if (proposal.drawing) { setDrawing(proposal.drawing); return }
      if (proposal.moves || proposal.catalog || proposal.opens || proposal.adds) {
        append({ role: 'user', content: said }, { role: 'assistant', content: proposal.reply, ...(proposal.catalog && { catalog: proposal.catalog }), ...(proposal.opens && { opens: proposal.opens }),
          ...(proposal.adds && { adds: proposal.adds }) })
        if (proposal.moves) setMoves(proposal.moves)
        return
      }
      const answered = !proposal.workshop || proposal.reply !== message
      append({ role: 'user', content: said }, ...(answered ? [{ role: 'assistant', content: proposal.reply }] : []))
      // A card proposed as an ordinary note (`toCanvas`) is taken off the lanes by the canvas itself on Keep.
      // The preview is the target board's: focus stays on it until Keep or Discard.
      if (proposal.workshop) target.setPreview({ workshop: proposal.workshop, revision: proposal.revision ?? target.revision, summary: proposal.reply,
        ...(proposal.toCanvas ? { toCanvas: proposal.toCanvas } : {}), ...(proposal.diff ? { diff: proposal.diff } : {}),
        // A move the rules refuse, made only if the person says so: "Move anyway" or "Cancel", with the rule (move-anyway.mjs).
        ...(proposal.override ? { override: proposal.override } : {}) })
    } catch (err) {
      if (!mounted.current || turn !== asked.current) return
      // A look that could mean more than one ("make it pop"): two or three to choose from, as a turn, never a refusal.
      if (err.code === 'appearance-choices') {
        setRequest('')
        append({ role: 'user', content: said }, { role: 'assistant', content: err.message, choices: err.choices })
        return
      }
      // Drafting this is not available to this person now (signed out, no Pro or own AI, the included amount used up, or
      // no AI on this install): said as a turn of the conversation, with the way on.
      if (['sign-in', 'guest', 'drafting-off'].includes(err.error) || isCreditRefusal(err.error)) {
        setRequest('')
        const pays = isCreditRefusal(err.error) || err.details?.pay
        // The refusing turn is marked: only it carries the ways on, never a later turn ("Which board?", "what can it do?").
        append({ role: 'user', content: message }, { role: 'assistant', content: err.reason, ...(pays && { pay: true }) })
        setPayRefusal(pays ? { error: err.error, reason: err.reason, details: err.details, message } : null)
      } else setError(err.reason || err.message || 'Could not prepare this change. Try again.')
    } finally { if (turn === asked.current) { running.current = false; if (mounted.current) setBusy(false) } }
  }

  // Leaving a proposal that is still being prepared: its answer, when it comes, is dropped.
  function cancel() {
    asked.current++
    running.current = false
    setBusy(false)
  }

  async function keepChanges() {
    if (running.current || !preview || locked || stale) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      // A card becoming an ordinary note: the canvas does it as a drop off the lanes would, so the
      // note and the board are saved together and Ctrl+Z puts the card back.
      if (preview.toCanvas) {
        const refusal = toCanvas(preview.toCanvas)
        if (refusal) { setError(refusal); return }
        append({ role: 'assistant', content: 'It is a note on the canvas now.' })
        setPreview(null)
        return
      }
      const saved = await save(preview.workshop, preview.revision)
      if (!mounted.current) return
      if (!saved) { setError(map ? 'Could not save. Check the latest map and try again.' : 'Could not save. Check the latest workshop and try again.'); return }
      append({ role: 'assistant', content: preview.override ? 'Moved ' + preview.override.card + ' to ' + preview.override.lane + ' anyway. The card shows who moved it and when; ' + undoWordsHere() + ' puts it back.'
        : map ? 'Saved to the map.' : 'Saved to the board.' })
      setPreview(null)
    } finally { running.current = false; if (mounted.current) setBusy(false) }
  }

  // Keeping notes or steps for the slate saves them with its drawing; the page then opens it again with them.
  async function keepDrawing() {
    if (running.current || !drawing || drawingStale) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const kept = await Meteor.callAsync((drawing.via || 'nativeCanvas') + '.keep', shareId, drawing.id)
      // A library board or a board brief, added beside the boards here, or the first-run board rebuilt from
      // their words in place: the page takes it live, with no reload (the board's record brings the new model;
      // `note` is its "How this board works" note, written again for the new board).
      if (drawing.component || drawing.beside || kept?.replaced) {
        append({ role: 'user', content: drawing.message }, { role: 'assistant', content: kept?.replaced ? 'Rebuilt the board from your words' + (drawing.said ? ' · ' + drawing.said.replace(/^Added an? [^·]+· /, '') : '')
          : drawing.beside ? drawing.said : 'Added ' + drawing.title + ' beside the board' + (drawing.rules?.length ? ' · ' + drawing.rules.join(' ') : '') })
        onKept?.({ board: true, boardId: kept?.boardId, origin: kept?.origin, nativeConversationRevision: kept?.nativeConversationRevision, ...(kept?.name && { name: kept.name }), ...(kept?.note && { note: kept.note }) })
        setDrawing(null)
        running.current = false
        setBusy(false)
        return
      }
      const count = drawing.labels.length
      append({ role: 'user', content: drawing.message }, { role: 'assistant', content: (drawing.mode === 'play' ? 'Added a playable route' : count === 1 ? 'Added a note' : 'Added ' + count + ' notes') + ' · ' + drawing.labels.join(', ') })
      // The turn is in local storage before the page reloads.
      setTimeout(() => window.location.reload(), 50)
    } catch (err) {
      if (mounted.current) setError(err.reason || err.message || 'Could not add this to the slate. Try again.')
      running.current = false
      if (mounted.current) setBusy(false)
    }
  }

  function discardDrawing() {
    append({ role: 'user', content: drawing.message }, { role: 'assistant', content: 'Discarded the preview.' })
    setDrawing(null)
    setError('')
  }

  function discard() {
    const moving = preview?.override
    setPreview(null)
    setError('')
    append({ role: 'assistant', content: moving ? moving.card + ' stays where it was.' : 'Discarded the preview.' })
  }

  const scenes = workshopPresentationLanes(model)
  const proposedScenes = preview && workshopPresentationLanes(preview.workshop)
  const orderChanged = Boolean(proposedScenes && scenes.some((scene, index) => scene.id !== proposedScenes[index]?.id))
  const changeBoard = board.focusBoard
    ? <Button size="small" data-board-change="" sx={{ textTransform: 'none' }} onClick={() => onChangeBoard ? onChangeBoard(board.boardId ?? 'main') : board.focusBoard()}>Change this board</Button>
    : null
  const starterButtons = starters.map(item => <Button size="small" key={item.text} sx={{ textAlign: 'left', textTransform: 'none' }}
    onClick={() => focus && asksWhatElse(item.text) ? whatCanItDo(item.text) : suggest(item)}>{item.text}</Button>)

  const hold = busy && !preview && !drawing ? { reason: 'Preparing the preview…', actions: <Button size="small" onClick={cancel}>Cancel</Button> }
    : drawing ? {
      reason: busy ? 'Adding the preview to the slate…' : drawingStale ? 'Your drawing changed after this preview. Discard it and ask again.'
        : 'Keep or discard the preview to write again.',
      actions: <>
        <Button variant="contained" size="small" disabled={busy || drawingStale} onClick={keepDrawing}>Keep changes</Button>
        <Button size="small" disabled={busy} onClick={discardDrawing}>Discard preview</Button>
      </>,
    }
    : preview ? {
      reason: stale ? (map ? 'A teammate changed this map. Discard this preview and ask again.' : 'A teammate changed the workshop. Discard this preview and ask again.')
        : busy || locked ? 'Saving the preview…' : preview.override ? 'Choose Move anyway or Cancel, then write again.' : 'Keep or discard the preview to write again.',
      actions: preview.override ? <>
        <Button variant="contained" size="small" data-move-anyway="" disabled={locked || busy || stale} onClick={keepChanges}>Move anyway</Button>
        <Button size="small" disabled={busy} onClick={discard}>Cancel</Button>
      </> : <>
        <Button variant="contained" size="small" disabled={locked || busy || stale} onClick={keepChanges}>Keep changes</Button>
        <Button size="small" disabled={busy} onClick={discard}>Discard preview</Button>
      </>,
    } : null
  // An entry added here goes beside the boards on this slate: previewed, then kept. On a slate that holds
  // 8 boards (the most for now) it opens on a new slate, and the chat asks first.
  async function addEntry(entry) {
    const lib = await libraryModule()
    const { newSlateTurn } = lib
    const found = typeof entry === 'string' ? lib.catalogEntry(entry) : entry
    setView(null)
    if (!found) return
    if (full) { append(newSlateTurn(found)); return }
    submit(found.addSay[0])
  }
  // Leaving for a new slate never throws away a proposal waiting here.
  function openNewSlate(say) {
    if (preview || drawing) { setError('Keep or discard the preview first: it is not saved yet.'); return }
    onNewSlate(say)
  }
  // A warn rule let a card land: one line in the chat, as well as under the board.
  const heard = useRef(null)
  useEffect(() => {
    if (!board.notice || heard.current === board.notice.at) return
    heard.current = board.notice.at
    append({ role: 'assistant', content: board.notice.text })
  }, [board.notice?.at])
  const browse = (start = {}) => setView({ start })
  const say = text => { setView(null); suggest({ text }) }
  useEffect(() => {
    if (!library) return
    if (library.add) addEntry(library.add)
    else browse(library.start ?? {})
  }, [library?.nonce])
  const composer = <ConversationComposer inputRef={input} value={request} onChange={setRequest} onSubmit={submit} hold={hold}
    canSubmit={Boolean(request.trim()) && !busy && !locked && access !== null} maxLength={1000} error={error}
    placeholder={focus ? focusPlaceholder(model, actor) : starters[0]?.text ?? (map ? 'First step → Next step' : 'Add a card called New idea')}
    helperText={access === null ? 'Checking editing access. You can type while you wait.' : undefined}
    prompt={history.length && isPhone() ? null : "What should happen on this slate?"}
    extra={(focus || !hold) && <>
      {/* The board in focus stays named while a preview of it waits (focus is held until Keep or Discard). */}
      {focus ? <Box aria-label="Board in focus" data-board-focus="" sx={{ display: 'flex', alignItems: 'center', gap: .5, mb: hold ? 0 : 1 }}>
        <Typography role="status" variant="body2" sx={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{editingLabel(model, selection)}</Typography>
        <IconButton size="small" aria-label="Stop editing this board" title={board.focusLocked ? 'Keep or discard the preview first' : 'Stop editing this board'}
          disabled={Boolean(board.focusLocked)} onClick={() => board.leaveFocus?.()}><Close fontSize="inherit" /></IconButton>
      </Box> : !hold && selected && <Box aria-label="Selected object" sx={{ display: 'flex', alignItems: 'center', gap: .5, mb: 1 }}>
        <Typography role="status" variant="body2" sx={{ overflowWrap: 'anywhere' }}>Selected {context.kind} · {selected.label}</Typography>
        <IconButton size="small" aria-label="Clear selection" onClick={board.clearSelection}><Close fontSize="inherit" /></IconButton>
      </Box>}
      {!hold && !view && <AddStrip hasBoard onAdd={addEntry} onBrowse={() => browse()} compact={history.length > 0 || Boolean(moves)} />}
    </>}
    // On a phone the newest turn's own buttons (Pro and a balance, looks to choose from, which board) need the room: the
    // starters wait until it is answered.
    starters={!hold && ownButtons(history.at(-1), payRefusal) && isPhone() ? null : <Box role="group" aria-label="Starter messages" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5, my: 1 }}>
      {/* Where a phone (no hover, no gear) finds "Change this board": first, unless a lane or card is
          selected, whose own phrases ("Make this 3 days") come first. */}
      {!focus && !context && changeBoard}
      {!moves && starterButtons}
      {!focus && context && changeBoard}
      {!focus && <Button size="small" sx={{ textTransform: 'none' }} onClick={() => whatCanItDo()}>What can this do?</Button>}<AddShort onBrowse={() => browse()} /></Box>} />
  if (view) return <ConversationPanel anchor="top" onClose={onClose} composer={composer}>
    <Suspense fallback={<Typography variant="body2" sx={{ my: 2 }}>Opening the library…</Typography>}>
      <LibraryView start={view.start} board={model} hasBoard full={full} onBack={() => setView(null)} onAdd={addEntry} onSay={say}
        onSend={text => { setView(null); setRequest(text) }} onWhatCanItDo={() => whatCanItDo()} />
    </Suspense>
  </ConversationPanel>

  return <ConversationPanel onClose={onClose} composer={composer}>
    <Box component="ol" role="log" aria-label="Conversation" sx={{ listStyle: 'none', p: 0, my: 1 }}>
      {/* A first-run slate's welcome, until the first message. */}
      {!history.length && creationBrief && <ChatTurn who="you">{'You asked for: ' + creationBrief}</ChatTurn>}
      {!history.length && firstRun && <ChatTurn who="slatebox">{FIRST_RUN_GREETING}</ChatTurn>}
      {history.map((turn, index) => {
        const last = index === history.length - 1
        return turn.role === 'user'
          ? <ChatTurn who="you" key={index}>{turn.content}</ChatTurn>
          : <ChatTurn who="slatebox" key={index} after={(turn.opens || turn.catalog || (last && (turn.adds || turn.boards || turn.choices))) && <>
            {/* A look to choose from: each chip says its sentence, read with no AI call. */}
            {turn.choices && last && <Box role="group" aria-label="Choose a look" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
              {turn.choices.map(item => <Button key={item.say} size="small" variant="outlined" data-look-choice={item.label} sx={{ textTransform: 'none' }}
                onClick={() => submit(item.say)}>{item.label}</Button>)}
            </Box>}
            {turn.opens && <Button size="small" variant="outlined" onClick={() => openNewSlate(turn.opens)}>Open on a new slate</Button>}
            {turn.adds && last && <Box sx={{ display: 'flex', gap: .5 }}>
              <Button size="small" variant="outlined" onClick={() => submit(turn.adds)}>Add it beside this board</Button>
              <Button size="small" onClick={() => append({ role: 'user', content: 'Not now' }, { role: 'assistant', content: 'Alright. The board stays as it is.' })}>Not now</Button>
            </Box>}
            {/* "Which board?": one chip per board; the message goes to the board picked. */}
            {turn.boards && last && <Box role="group" aria-label="Which board" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
              {turn.boards.map(item => <Button key={item.id} size="small" variant="outlined" data-pick-board={item.id} sx={{ textTransform: 'none' }}
                onClick={() => submit(turn.again, item.id)}>{item.title}</Button>)}
            </Box>}
            {turn.catalog && <Suspense fallback={null}><CatalogCards ids={turn.catalog} onAdd={addEntry} full={full} onOpen={entry => browse({ entry: entry.id })} /></Suspense>}
          </>}>{last && turn.pay && payRefusal && !hold
            // The refusal's ways on inside its own message: Pro or a balance, in the same pay sheet; the request runs again once paid.
            ? <PayNotice refusal={payRefusal} from="draft" retry={() => submit(payRefusal.message)} inline />
            : turn.content}</ChatTurn>
      })}
      {busy && !preview && !drawing && <ChatThinking />}
    </Box>
    {moves && <Suspense fallback={null}><BoardMoves moves={moves} onSay={text => suggest({ text })} /></Suspense>}
    {drawing ? <Box aria-label="Review proposed drawing" aria-live="polite" sx={{ my: 1 }}>
      <ChatTurn who="you" as="div">{drawing.message}</ChatTurn>
      <ChatTurn who="slatebox" as="div"><Box sx={{ typography: 'body2', '& ul': { my: .5, pl: 2.5 } }}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: .5 }}>{drawing.provider === 'ai' ? 'Agent preview' : 'Preview'} · {drawingHeading(drawing)}</Typography>
      <Typography variant="body2">{drawingStale ? 'Your drawing changed after this preview, so it is no longer shown. Discard it and ask again on the drawing as it is now.'
        : 'Shown on the canvas with dashed outlines. Nothing is added until you keep it.'}</Typography>
      {drawing.component || drawing.beside || drawing.replace ? drawing.canvas?.workshop && <BoardRules workshop={drawing.canvas.workshop} />
        : <ul>{drawing.labels.map((label, i) => <li key={i}>{label}</li>)}</ul>}
      {/* What Keep does, in the board's own words: "play the route" is a map's only. */}
      {!drawingStale && (drawing.component || drawing.mode === 'play') && previewKeepSentence(drawing) && <Typography variant="body2">{previewKeepSentence(drawing)}</Typography>}
      </Box></ChatTurn>
    </Box> : preview && <Box aria-label={map ? 'Review proposed map' : 'Review proposed workshop'} aria-live="polite" sx={{ my: 2 }}>
      <Typography sx={{ fontWeight: 600 }}>{stale ? map ? 'A teammate changed this map.' : 'A teammate changed the workshop.' : preview.override ? 'Move anyway?' : orderChanged ? 'Proposed presentation order' : 'Proposed change · shown on the canvas'}</Typography>
      {/* The rule the move breaks, in the board's words: what "Move anyway" overrides. */}
      {!stale && preview.override && <Typography variant="body2" data-move-anyway-rule="" sx={{ overflowWrap: 'anywhere' }}>{preview.override.sentence}</Typography>}
      {stale ? <Typography variant="body2">Discard this preview and ask again on the latest {map ? 'map' : 'workshop'}.</Typography> : <>
        {!map && preview.summary !== history.at(-1)?.content && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{preview.summary}</Typography>}
        {preview.diff && <Box component="section" aria-label="Rules" sx={{ my: 1, fontFamily: 'monospace', fontSize: 13 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>Rules (rev {preview.diff.from} → {preview.diff.to})</Typography>
          {preview.diff.lines.map(line => <Typography key={line} variant="body2" sx={{ fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}>{line}</Typography>)}
          <Typography variant="body2">{preview.diff.over.length ? 'Now: nothing moves. ' + preview.diff.over.join(' ') : 'Now: nothing moves.'}</Typography>
        </Box>}
        {orderChanged && <ol aria-label="Proposed presentation order">{proposedScenes.map(scene => <li key={scene.id}>{scene.label}</li>)}</ol>}
      </>}
    </Box>}
  </ConversationPanel>
}

/** A catalogue turn on a slate that has a board: the cards (each added beside the boards; on a slate of 8, on a new slate). */
function CatalogCards({ ids, onAdd, onOpen, full }) {
  const [entries, setEntries] = useState(null)
  useEffect(() => { let gone = false; libraryModule().then(lib => { if (!gone) setEntries(ids.map(lib.catalogEntry).filter(Boolean)) }); return () => { gone = true } }, [ids.join()])
  return entries ? <LibraryCards entries={entries} onOpen={onOpen} onAdd={onAdd} full={full} /> : null
}
