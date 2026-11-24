import { useCallback, useEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Tracker } from 'meteor/tracker'
import { useTracker } from 'meteor/react-meteor-data'
import { attachWorkshop, rulebookLoaded, validateWorkshop, workshopLanePlaces, workshopCandidate, workshopNodeIds, workshopOverrideCandidate, workshopRefusal, workshopReserve, workshopWithoutCardLines } from 'slateboxjs/workshops/model'
import { CreativeStates } from '../../../api/client/creativeSlateStates'
import createAnonymousUser from '../../../api/client/createAnonymousUser'
import { workshopStyle, lanesPerRow } from '../../../api/common/workshop-look.mjs'
import { shapeNotice as shapeSentence, withShapeNotice } from '../../../api/common/shape-notice.mjs'
import { boardsCounterRecordId } from '../../../api/common/slate-boards.mjs'
import { BOARD_STEP_SAID, boardStepLabel, drawingOwnsBoardChange, rebaseBoardStep, settleBoardSide } from '../../../api/common/board-undo.mjs'
import { ensureBoardChromeStyles } from './boardChromeStyles'
import { KIT_KINDS } from './boardRender'
import { moverName } from '../../../api/common/mover-name.mjs'

// The boards whose cards are numbers worked out from where they are: a move made anyway works them out again.
const NUMBER_BOARDS = new Set(['pipeline', 'budget', 'launch-plan', 'hiring-plan'])

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const validOrigin = origin => Number.isFinite(origin?.x) && Number.isFinite(origin?.y) ? { x: origin.x, y: origin.y } : undefined
const lostRace = 'Someone else changed this workshop first. Your change was not saved.'
// The slate's first board; every further board has an id of its own (b2, b3…) and its own live record.
const MAIN = 'main'
// One save at a time when the page gives no queue of its own.
const alone = task => task()
// A launch plan, a hiring plan, a sales pipeline or a budget: drawn and played by its kit, which brings its rules.
const BOARD_KINDS = KIT_KINDS

// The edits a rule control makes (library spec §4.3; slateboxjs/workshops/controls RULE_CONTROL_EDITS): a change of
// these alone is a change of the rules, saved in a request of its own (the server never takes one mixed with a move).
const RULE_EDITS = ['add_rule', 'set_rule', 'remove_rule', 'set_lane_capacity', 'add_lane']
const isRuleChange = change => Array.isArray(change?.edits) && change.edits.length > 0 && change.edits.every(edit => RULE_EDITS.includes(edit?.kind))
// When a board shows its rule controls: always on a builder slate, while selected or in focus for someone who can edit it.
const CONTROL_MODES = ['off', 'selected', 'always']
// The controls' chunk (slateboxjs/workshops/controls), loaded once, the first time a board that can be edited may show them.
let controlsChunk = null
const loadControls = () => (controlsChunk ??= import('slateboxjs/workshops/controls').catch(err => { controlsChunk = null; throw err }))

// The lane a change that was turned down should show its reason on.
function changedLane(change, workshop) {
  if (change?.laneId) return change.laneId
  if (change?.rename?.laneId) return change.rename.laneId
  const cardId = change?.cardId ?? change?.rename?.cardId
  return workshop.cards.find(card => card.id === cardId)?.laneId ?? null
}

/**
 * Runs the workshop saved in a slate's creative.model on that slate's own canvas.
 *
 * `engine` is the page's live Slate. The workshop's lanes and cards become notes on it
 * (attachWorkshop), beside whatever the slate already holds. A move or a rename made on the
 * canvas is sent as that change (creativeSlates.play) and the server makes it on the workshop
 * as it stands, so two people moving different cards at once both keep their move. A change
 * the workshop's rules no longer allow is undone on the canvas and the lane says why. A
 * collaborator's save arrives through the creativeSlates.state publication and the same notes
 * move to their new places. A whole model from the page (a kept proposal, an undo) is saved on
 * the revision it was made on.
 * Every change this person saves on the board is a step of their undo history on the canvas
 * (engine.recordHostStep), between the drawing's own steps: Undo and Redo make it again on the
 * board as it stands, leaving what someone else has changed since (board-undo.mjs).
 * `origin` is where the slate has recorded the workshop to be; `onPlaced` hears where it was put.
 * A launch plan, pipeline or budget waits for its kit (slateboxjs/boards, loaded only for such a
 * slate), which plugs the board's rules into the model before the board is drawn; its changes go
 * to the server as the edits they make, and the server makes them by the same rules.
 *
 * A slate holds up to 8 boards (boards S4a). The page runs one of these per board: `boardId` is the
 * board ('main', the slate's first, or b2, b3…), drawn in its own scope (its notes are b2:lane-…) from
 * its own live record. The page keeps one save queue for all of them (`serial`, so boards never race
 * each other) and one view: only the board that `frames` the page fits the view when it is drawn and
 * when the canvas changes size; any board fits it when it is put in focus. `avoid`: the room the other
 * boards keep, which a note put "beside the board" goes past.
 */
export default function useWorkshopOnCanvas({ engine, shareId, enabled, embedded, guestAdmitted, namesSlate, onTitle, origin, onPlaced,
  boardId = MAIN, serial = alone, avoid, frames = true, controls = 'selected' }) {
  const main = boardId === MAIN
  const { state, subscribed, connected } = useTracker(() => {
    if (!enabled || !shareId || !boardId) return { state: null, subscribed: false, connected: true }
    // The first board's subscription brings every board's record (one per board).
    const subscription = main ? Meteor.subscribe('creativeSlates.state', shareId) : null
    const record = CreativeStates.findOne(main ? shareId : shareId + ':' + boardId) ?? null
    // The slate's counter for all its boards is a record of its own (one board's change resends that board
    // and the counter): the first board follows it, a further board reads it with its own record.
    const counter = () => CreativeStates.findOne(boardsCounterRecordId(shareId), { fields: { through: 1 } })?.through
    const through = main ? counter() : Tracker.nonreactive(counter)
    return { state: record && Number.isSafeInteger(through) ? { ...record, through: Math.max(through, record.through ?? 0) } : record,
      subscribed: subscription ? subscription.ready() : true, connected: Meteor.status().connected }
  }, [enabled, shareId, boardId])
  // Where this board sits: the page's record of the first board's place, a further board's own.
  const placeAt = main ? origin : state?.origin
  const workshop = enabled && state?.model?.kind === 'workshop' ? state.model.workshop : null
  const editable = Boolean(workshop && state.canEdit && !embedded)
  const boardKind = BOARD_KINDS.includes(workshop?.kind) ? workshop.kind : null

  const [controller, setController] = useState(null)
  const [failure, setFailure] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // A warn rule's sentence for a card that landed anyway: said under the board and in the chat.
  const [notice, setNotice] = useState(null)
  // A shaped note that became a card, or a card that is its shape again: said once, to the person
  // who moved it, in a snackbar over the canvas (never in the chat). { key, text }.
  const [shapeNotice, setShapeNotice] = useState(null)
  // A drop (or a "Move to") the rules refuse that the person may make anyway: { ask, answer } while the page asks
  // "Move anyway?" with the rule's sentence (the engine's confirmOverride). One at a time: a new ask cancels the last.
  const [moveAnyway, setMoveAnyway] = useState(null)
  // `numbers`: whether the board works out numbers from where its cards are (a plan, a pipeline, a budget), for the dialog's words.
  const askMoveAnyway = useCallback(ask => new Promise(resolve => {
    const numbers = NUMBER_BOARDS.has(known.current?.model?.workshop?.kind)
    // Agreed, the words it was asked in ("to start day 21") name its undo step too.
    const answer = yes => { if (yes === true && ask?.to && ask.cardId) overrideWords.current.set(ask.cardId, ask.to); resolve(yes) }
    setMoveAnyway(previous => { previous?.answer(false); return { ask: { ...ask, numbers }, answer } })
  }), [])
  const overrideWords = useRef(new Map())
  // Whether the board draws its cards with rounded corners (the slate's own notes do).
  const roundCards = useRef(false)
  // What a change of this person's own would say of a shape, said once the server has saved it.
  const shapeSaid = useRef(new WeakMap())
  // What a rule control said it does ("Doing holds 2"), said once its change is saved.
  const ruleSaid = useRef(new WeakMap())
  const controlsMode = CONTROL_MODES.includes(controls) ? controls : 'off'
  const controlsRef = useRef(controlsMode)
  controlsRef.current = controlsMode
  const [preview, setPreview] = useState(null)
  const [selection, setSelection] = useState(null)
  // The board in focus for the chat (the gear's "Change this board"): this board's id or null. The view
  // is fitted to it once the chat has settled.
  const [focus, setFocus] = useState(null)
  const focusRef = useRef(null)
  focusRef.current = focus
  // The focus frame's "Done" on the canvas: the same as the chat's "Stop editing this board".
  const leaveRef = useRef(null)
  const fitBoardRef = useRef(null)
  const [joining, setJoining] = useState(false)
  const [, redraw] = useState(0)

  const server = useRef(null)
  server.current = workshop ? state : null
  // The last model and revision the server is known to hold.
  const known = useRef(null)
  const inFlight = useRef(false)
  // Changes made on the canvas that the server has not been sent yet, oldest first.
  const queue = useRef([])
  // What the canvas is told about each change once the server has answered: saved or not.
  const answers = useRef(new Map())
  const turnedDown = useRef(null)
  const pressed = useRef(false)
  const staged = useRef(false)
  const shown = useRef(null)
  const live = useRef(null)
  const playRef = useRef(null)
  const placing = useRef(null)
  const refit = useRef(null)
  placing.current = { origin: placeAt, onPlaced: main ? onPlaced : null }
  const serialRef = useRef(serial)
  serialRef.current = serial
  const avoidRef = useRef(avoid)
  avoidRef.current = avoid
  const framesRef = useRef(frames)
  framesRef.current = frames
  // A further board's calls name it; the first board's are as they always were.
  const onBoard = main ? [] : [boardId]
  const [candidate, setCandidate] = useState(null)
  // The kits (and with them the board's rules), fetched once a slate holds a business board. A
  // failed fetch (offline, a deploy that replaced the chunk) is tried again when the connection
  // comes back, or when the person asks (retryBoard).
  const [kits, setKits] = useState(null)
  const [boardTry, setBoardTry] = useState(0)
  const retryRef = useRef(null)
  // A nested board's kit is its own chunk (slateboxjs/boards/nest): fetched only for a slate that holds one.
  const kitsReady = Boolean(kits && (boardKind !== 'nest' || kits.nest))
  useEffect(() => {
    if (!boardKind || kitsReady) return undefined
    let gone = false
    Promise.all([import('slateboxjs/boards'), boardKind === 'nest' ? import('slateboxjs/boards/nest') : null]).then(([loaded, nest]) => {
      if (!gone) { setFailure(''); setKits({ kitFor: loaded.kitFor, boardLayoutFor: loaded.boardLayoutFor, nest: Boolean(nest) }) }
    }).catch(err => {
      console.warn('The board could not be loaded.', err)
      if (gone) return
      setFailure('This slate’s board could not be loaded.')
      const again = () => setBoardTry(n => n + 1)
      window.addEventListener('online', again, { once: true })
      retryRef.current = again
    })
    return () => { gone = true }
  }, [boardKind, kitsReady, boardTry])

  // The trades of a revision the server holds (creative.trades: the newest trade of each note),
  // for the engine to draw any it has not and tell the room of any it was not told of.
  const settleTrades = useCallback(state => {
    // A slate of many boards records its trades at its counter for all of them (`through`).
    if (state && Number.isSafeInteger(state.revision)) engineRef.current?.settleTrades?.(state.trades ?? {}, state.through ?? state.revision)
  }, [])
  const engineRef = useRef(null)
  engineRef.current = engine
  const reconcile = useCallback(() => {
    const board = live.current, latest = server.current
    if (!board || !latest || inFlight.current || pressed.current || staged.current) return
    if (queue.current.length) { playRef.current(); return }
    // The canvas shows the newest model the server is known to hold: what the publication
    // delivered, or what a save of this person's own came back with if that is newer. At the same
    // revision the server's copy wins: it stamps a rule's audit line and revision itself.
    if (latest.revision >= known.current.revision) known.current = { revision: latest.revision, model: latest.model }
    if (!same(board.value, known.current.model.workshop)) board.update(known.current.model.workshop)
    refit.current?.()
    const refusal = turnedDown.current
    if (refusal) {
      turnedDown.current = null
      if (refusal.laneId && board.value.lanes.some(lane => lane.id === refusal.laneId)) board.refuse(refusal.laneId, refusal.reason)
    }
    redraw(n => n + 1)
  }, [])

  // The changes made on the canvas go to the server as changes, in the order they were made.
  // The server makes them on the workshop as it stands and answers with the result; a change
  // its rules refuse there comes back with the reason and the workshop as it is.
  async function play() {
    const board = live.current
    if (!board || inFlight.current || !queue.current.length) return
    // A move made anyway, or a change of the rules, goes alone, so it is one step of the person's undo history by itself
    // (a batch is one step); the changes before it go together, and those after it follow in the next batch (reconcile
    // plays what is left).
    const alone = queue.current.findIndex(change => change.override || isRuleChange(change))
    const changes = queue.current.splice(0, alone === 0 ? 1 : alone > 0 ? alone : queue.current.length)
    inFlight.current = true
    setSaving(true)
    setError('')
    setNotice(null)
    // A note and a card trading places has a drawing half: the canvas puts it back when the
    // server does not take the change, so neither the note nor the card is lost. A trade someone
    // else made first is 'taken': this person's copy of the note goes and nothing comes back.
    const tell = (saved, refused) => {
      changes.forEach((change, at) => {
        answers.current.get(change)?.(at === refused?.at && refused?.taken ? 'taken' : saved)
        answers.current.delete(change)
      })
    }
    try {
      const result = await serialRef.current(() => Meteor.callAsync('creativeSlates.play', shareId, changes, ...onBoard))
      // The canvas hears the answer even when this board has been put away since: a trade
      // reaches collaborators only once it is saved, and the slate's drawing saves wait for it.
      if (live.current !== board) { settleTrades(result); tell(true); return }
      known.current = { revision: result.revision, model: result.model }
      // The server's record of the trade comes first: the canvas then tells the room of it.
      settleTrades(result)
      // The step recorded when the change was made (queueChange) is what the server did: the board before
      // and after these changes. A batch is one step, held by its last change; a note and a card trading
      // places, a card's line and a card's name are the canvas's own undo (drawingOwnsBoardChange).
      const transition = result.previous?.workshop && result.model?.workshop && !changes.some(drawingOwnsBoardChange)
        ? { before: result.previous.workshop, after: result.model.workshop } : null
      settleSteps(changes, transition)
      // A shaped note that became a card says so, and so does a card that is its shape again. An undo
      // or redo says nothing. When a rule of the board speaks for the same drop, the shape joins it.
      const shapes = changes.map(change => shapeSaid.current.get(change)).filter(Boolean)
      const ruled = changes.find(change => ruleSaid.current.has(change))
      if (ruled) setNotice({ text: ruleSaid.current.get(ruled), at: Date.now(), rule: true })
      else if (result.warnings?.length) setNotice({ text: withShapeNotice('Saved, with a warning: ' + result.warnings.join(' '), shapes), at: Date.now() })
      else if (shapes.length) setShapeNotice({ key: Date.now(), text: shapes.join(' ') })
      tell(true)
    } catch (err) {
      settleSteps(changes, null)
      if (live.current !== board) { tell(false); return }
      // Anything done since was done on a board the server did not take.
      for (const later of queue.current) { answers.current.get(later)?.(false); answers.current.delete(later) }
      settleSteps(queue.current, null)
      queue.current.length = 0
      tell(false, err.error === 'refused' ? err.details : null)
      const current = err.details
      if (current?.model?.kind === 'workshop' && Number.isSafeInteger(current.revision) && current.revision >= known.current.revision) {
        known.current = { revision: current.revision, model: current.model }
      }
      const refused = err.error === 'refused'
      const laneId = current?.laneId ?? changedLane(changes.at(-1), known.current.model.workshop)
      turnedDown.current = laneId ? { laneId, reason: refused ? err.reason : 'That was not saved.' } : null
      setError(refused ? err.reason + ' Your change was not saved.' : err.reason || 'Could not save this change.')
      // A move made anyway that the board, as it is now, would make past another rule (a teammate's change came
      // first): asked again with the sentence as it is now; confirmed, sent again with it.
      const again = refused && current?.overridable ? changes[Number.isSafeInteger(current.at) ? current.at : changes.length - 1] : null
      const moving = again?.override && again.cardId ? known.current.model.workshop?.cards?.find(item => item.id === again.cardId) : null
      if (moving) {
        const lane = known.current.model.workshop.lanes.find(item => item.id === again.laneId)
        askMoveAnyway({ cardId: moving.id, laneId: again.laneId ?? moving.laneId, card: moving.label, lane: lane?.label ?? '', reason: err.reason,
          ...(again.edits && { to: 'where you put it' }) }).then(yes => {
          if (!yes || live.current !== board) return
          queueChange({ ...again, reason: err.reason })
          playRef.current()
        })
      }
      // A name the workshop would not take leaves the toolbar; the saved one comes back.
      if (namedRef.current.namesSlate && changes.some(change => change.rename?.title !== undefined)) {
        namedRef.current.onTitle?.(known.current.model.workshop.title, refused ? err.reason : 'The name was not saved.')
      }
    } finally {
      inFlight.current = false
      if (live.current === board) { setSaving(false); reconcile() }
    }
  }
  playRef.current = play

  // A whole model from the page (a kept proposal, a card taken off) is saved on the revision it was made
  // on, and is a step of this person's undo history. An undo or redo of a step is saved the same way,
  // and is not a step itself (undoing).
  async function commit(next, { revision = known.current.revision, undoing = false } = {}) {
    const board = live.current
    if (!board) return { ok: false, gone: true }
    inFlight.current = true
    setSaving(true)
    setError('')
    const previous = known.current.model
    const model = { kind: 'workshop', version: 1, workshop: next }
    // A step of this person's history from the moment they make it: an Undo pressed while it is being
    // saved waits for the save and takes it back.
    const settle = undoing ? null : pendingStep('Board change')
    try {
      const committed = await serialRef.current(() => Meteor.callAsync('creativeSlates.save', shareId, revision, model, ...onBoard))
      // The step ends at the board as the server stored it (it stamps a move made anyway itself).
      settle?.(previous?.workshop ? storedAt(committed, next).then(after => ({ before: previous.workshop, after })) : null)
      if (live.current !== board) return { ok: true, revision: committed }
      known.current = { revision: committed, model }
      return { ok: true, revision: committed }
    } catch (err) {
      settle?.(null)
      if (live.current !== board) return { ok: false, gone: true }
      const said = err.error === 'stale' ? lostRace : err.reason || 'Could not save this change.'
      if (!undoing) setError(said)
      return { ok: false, stale: err.error === 'stale', reason: err.error === 'stale' ? null : err.reason || null }
    } finally {
      inFlight.current = false
      if (live.current === board) { setSaving(false); reconcile() }
    }
  }
  const send = async (next, options) => (await commit(next, options)).ok

  // Resolves once no change of this board waits to be saved or is on its way.
  async function idle() {
    for (let waited = 0; (inFlight.current || queue.current.length || pressed.current) && waited < 15000; waited += 50)
      await new Promise(resolve => setTimeout(resolve, 50))
  }

  // A change this person makes on the board, as a step of their undo history on the canvas, recorded as
  // they make it. What it did is known once the server has saved it (settle with { before, after }, or
  // null when it was not saved: the step then does nothing and is dropped).
  function pendingStep(label) {
    let settle
    const done = new Promise(resolve => { settle = resolve })
    const run = async (back) => {
      const step = await done
      if (!step || same(step.before, step.after)) return { ok: false, message: null }
      const result = back ? await replay(step.after, step.before) : await replay(step.before, step.after)
      // What the undo or redo saved is what the step's side is from now on, as the server stored it: the next
      // redo or undo of the step starts from there (a move made anyway made again carries the server's new mark).
      if (result.ok && result.revision) {
        const saved = await storedAt(result.revision, result.board)
        const sent = result.board
        if (back) step.before = settleBoardSide({ from: step.after, to: step.before, saved, sent })
        else step.after = settleBoardSide({ from: step.before, to: step.after, saved, sent })
      }
      return { ok: result.ok, message: result.message }
    }
    engineRef.current?.recordHostStep?.({ label, undo: () => run(true), redo: () => run(false) })
    return settle
  }
  // The steps waiting for changes the server has answered: the last one holds the batch.
  const steps = useRef(new Map())
  function settleSteps(changes, transition) {
    const own = changes.filter(change => steps.current.has(change))
    own.forEach((change, at) => {
      steps.current.get(change)(at === own.length - 1 ? transition : null)
      steps.current.delete(change)
    })
  }
  // A change made on the board goes to the server in its turn, and is a step of this person's history now.
  function queueChange(change) {
    const to = change.override && change.cardId ? overrideWords.current.get(change.cardId) : undefined
    if (to) overrideWords.current.delete(change.cardId)
    if (!drawingOwnsBoardChange(change)) steps.current.set(change, pendingStep(boardStepLabel([to ? { ...change, to } : change], known.current?.model.workshop)))
    queue.current.push(change)
  }

  // The board as the server stored it at `revision`, once its publication brings it here (`fallback`, the board
  // the page sent, when it does not come, or someone saved again first).
  async function storedAt(revision, fallback) {
    for (let waited = 0; waited < 4000; waited += 50) {
      const latest = server.current
      if (latest?.revision === revision && latest.model?.workshop) return latest.model.workshop
      if (latest?.revision > revision) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return fallback
  }

  // Make the step from `from` to `to` again on the board as it stands now: what someone else changed
  // since stays as they left it (rebaseBoardStep). Answers what the engine tells the person.
  async function replay(from, to) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await idle()
      if (!live.current || !known.current) return { ok: false, message: BOARD_STEP_SAID.gone }
      const current = known.current.model.workshop
      const { board, changed, conflicts } = rebaseBoardStep({ from, to, current })
      if (!changed) return { ok: false, message: conflicts ? BOARD_STEP_SAID.overwritten : null }
      let next
      try { next = validateWorkshop(board) } catch { return { ok: false, message: BOARD_STEP_SAID.overwritten } }
      const result = await commit(next, { revision: known.current.revision, undoing: true })
      if (result.ok) return { ok: true, message: conflicts ? BOARD_STEP_SAID.partly : null, revision: result.revision, board: next }
      if (result.gone) return { ok: false, message: BOARD_STEP_SAID.gone }
      // Someone saved the board meanwhile: try once more on the board they left.
      if (result.stale && attempt === 0) { await new Promise(resolve => setTimeout(resolve, 400)); continue }
      return { ok: false, message: result.reason ? result.reason + ' Nothing was changed.' : lostRace.replace('Your change', 'Your undo') }
    }
    return { ok: false, message: lostRace.replace('Your change', 'Your undo') }
  }

  // Attach once per slate, as soon as the model is here. The callbacks read the latest closures.
  // A board's rulebook (how it behaves, as data), fetched only when the board has one: a board with
  // rules can't be read without it. Any other board (a decision path, a board without rules) never
  // loads it; the chat loads it when a rule is first said. A failed fetch is tried again when the
  // connection comes back, or when the person asks (retryBoard), as a kit's is.
  // A kit board's legend is its rulebook's sentences too, so the board shows them on a cold load as its preview did.
  const hasRules = Boolean(workshop?.behaviour) || BOARD_KINDS.includes(workshop?.kind)
  const [rules, setRules] = useState(rulebookLoaded())
  const [rulesTry, setRulesTry] = useState(0)
  useEffect(() => {
    if (!hasRules || rules) return undefined
    let gone = false
    import('slateboxjs/workshops/behaviour').then(() => { if (!gone) { setFailure(''); setRules(true) } }).catch(err => {
      console.warn('The board\'s rules could not be loaded.', err)
      if (gone) return
      setFailure('This board’s rules could not be loaded, so it can’t be shown yet.')
      const again = () => setRulesTry(n => n + 1)
      window.addEventListener('online', again, { once: true })
      retryRef.current = again
    })
    return () => { gone = true }
  }, [hasRules, rules, rulesTry])
  const ready = Boolean(engine && workshop && (!boardKind || kitsReady) && (!hasRules || rules || rulebookLoaded()))
  useEffect(() => {
    if (!ready) return undefined
    const first = server.current
    known.current = { revision: first.revision, model: first.model }
    const element = engine.element
    const measure = () => element?.clientWidth || window.innerWidth
    const kit = BOARD_KINDS.includes(first.model.workshop.kind) ? kits.kitFor(first.model.workshop.kind) : null
    const layoutFor = width => kit ? kits.boardLayoutFor(width) : { lanesPerRow: lanesPerRow(width, first.model.workshop) }
    let board
    ensureBoardChromeStyles()
    // Cards are drawn as this slate's own notes are.
    const style = workshopStyle(engine.freeNodes?.() ?? [])
    roundCards.current = ((style.card?.cornerRadius ?? style.cornerRadius) ?? 0) > 0
    try {
      board = attachWorkshop(engine, first.model.workshop, {
        readOnly: true,
        // A further board names its notes in its scope (b2:card-…), so two boards made from one preset never share a name.
        ...(!main && { scope: boardId }),
        // The room the other boards keep: a note put beside this board goes past them.
        avoid: () => avoidRef.current?.() ?? [],
        origin: validOrigin(placing.current.origin),
        layout: layoutFor(measure()),
        ...(kit && { kit }),
        style,
        onFocusDone: () => leaveRef.current?.(),
        // A drop the rules refuse: "Move anyway?" with the rule's sentence; confirmed, the server marks who and when.
        confirmOverride: askMoveAnyway,
        overrideBy: () => moverName(Meteor.user()),
        // The rule controls (drawn once their chunk has loaded): a control's edits go through the same door a drag does,
        // as a change of the rules alone, saved at once with Undo.
        controls: controlsRef.current,
        onRuleEdit(edits, sentence) {
          if (!edits?.length || !edits.every(edit => RULE_EDITS.includes(edit?.kind))) return false
          const change = { edits }
          // The rule as it now stands, in one sentence ("Doing holds 2"), never the control's instructions after it.
          const said = String(sentence || '').split(/\.\s/)[0].replace(/\.$/, '').trim()
          ruleSaid.current.set(change, said ? said + '.' : 'The board’s rules changed.')
          queue.current.push(change)
          const answer = new Promise(resolve => answers.current.set(change, resolve))
          playRef.current()
          return answer.then(saved => saved === true)
        },
        onChange(_next, change) {
          // A card that became a note goes to the server with the note, so the board and the
          // drawing are saved in one write.
          const note = change.cardToNote && engine.nodes?.one?.(change.cardToNote.noteId)
          const sent = note ? { ...change, cardToNote: { ...change.cardToNote, note: JSON.parse(engine.exportJSON([note])).nodes[0] } } : change
          // A card is named as the board names it: one that left by the server's copy (it still holds it), one that
          // arrived by the board it made (its note's words carry its numbers: "Pick vendor · 2 days").
          const said = shapeSentence(sent, { kind: known.current?.model.workshop?.kind, round: roundCards.current,
            label: change.cardToNote ? known.current?.model.workshop?.cards.find(card => card.id === change.cardId)?.label
              : change.noteToCard ? _next?.cards?.find(card => card.id === change.cardId)?.label : undefined })
          if (said) shapeSaid.current.set(sent, said)
          queueChange(sent)
          const answer = new Promise(resolve => answers.current.set(sent, resolve))
          playRef.current()
          return answer
        },
        onPreview(candidate) {
          staged.current = Boolean(candidate) && !pressed.current
          setCandidate(candidate)
          if (!candidate) setTimeout(reconcile, 0)
        },
        onSelect(selected) {
          // A map's path picked outside focus (where it is fixed): the board's bar offers "Change this board".
          setSelection(!selected ? null : selected.cardId ? { kind: 'card', id: selected.cardId } : selected.laneId ? { kind: 'lane', id: selected.laneId }
            : selected.path ? { kind: 'path', id: selected.path.from + '>' + selected.path.to, from: selected.path.from, to: selected.path.to } : null)
        },
      })
    } catch (err) {
      // A model this build cannot draw. The slate's own notes are shown as they are and nothing is changed.
      console.warn('The workshop could not be drawn on this slate.', err)
      setFailure('This slate’s workshop could not be drawn.')
      return undefined
    }
    live.current = board
    // Where the workshop sits is part of the slate, so the notes a person puts beside it stay beside it.
    placing.current.onPlaced?.(board.origin)

    // A remote model is not drawn under a card someone is holding. A wheel on the canvas, or a
    // press on anything but a note (empty canvas, the zoom slider, the minimap), means the view
    // is now the person's own.
    let viewIsTheirs = false
    const down = event => { pressed.current = true; if (!event.target?.closest?.('[data-node-id]')) viewIsTheirs = true }
    const wheel = () => { viewIsTheirs = true }
    const up = () => { if (pressed.current) { pressed.current = false; setTimeout(reconcile, 0) } }
    element?.addEventListener('pointerdown', down, true)
    element?.addEventListener('wheel', wheel, { capture: true, passive: true })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)

    // Lanes wrap on a narrow canvas and the board is fitted to its width. On a wide canvas a
    // view the person has since panned or zoomed is left alone; a phone that turns is refitted.
    const framed = () => {
      const box = engine.canvas?.viewbox?.()
      return box ? [box.x, box.y, box.width, box.height].map(Math.round).join(',') : ''
    }
    let fitted = ''
    // The least room left around a fitted workshop on a wide canvas, in pixels.
    const margin = 24
    // The box of what the canvas shows: the workshop, or a proposal that may have more lanes.
    // On a phone the toolbar's own floating buttons sit over the top of the canvas; the board starts below them.
    // The board's title row and legend (and, in focus, its frame) are part of what is fitted (board.frame).
    const bounds = () => {
      const { width: w, height: h } = kit ? board.bounds : workshopLanePlaces(shown.current ?? board.value, { layout: board.layout })
      const clear = measure() < 600 ? 52 : 0
      const chrome = board.frame ?? board.bounds
      const left = Math.min(board.origin.x, chrome.x), top = Math.min(board.origin.y, chrome.y) - clear
      const right = Math.max(board.origin.x + w, chrome.x + chrome.width), bottom = Math.max(board.origin.y + h, chrome.y + chrome.height)
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
    // Whether the whole of a box is on screen now.
    const inView = box => {
      const seen = engine.canvas?.viewbox?.()
      return Boolean(seen) && box.x >= seen.x - 1 && box.y >= seen.y - 1 &&
        box.x + box.width <= seen.x + seen.width + 1 && box.y + box.height <= seen.y + seen.height + 1
    }
    // The workshop together with the notes the slate holds beside it.
    const everything = () => {
      const box = bounds()
      let left = box.x, top = box.y, right = box.x + box.width, bottom = box.y + box.height
      for (const { options: note } of engine.freeNodes()) {
        if (![note.x, note.y].every(Number.isFinite)) continue
        left = Math.min(left, note.x); top = Math.min(top, note.y)
        right = Math.max(right, note.x + (note.width ?? 0)); bottom = Math.max(bottom, note.y + (note.height ?? 0))
      }
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
    // The minimap is for finding the way around what is off screen. While the whole of the
    // slate is on screen it has nothing to add, and it would sit over a lane.
    const markWhole = () => { if (framesRef.current) element?.toggleAttribute('data-whole-in-view', inView(everything())) }
    let last = bounds()
    // `only`: the board alone (a board in focus), not the notes beside it.
    const fit = (only = Boolean(focusRef.current)) => {
      if (live.current !== board) return
      // A phone shows the board at its full width: in focus its frame (8 outside it) takes 8 of the margin, so the board
      // is shown at the size it always was and its grips stay a finger's size.
      if (measure() < 600) engine.fitToWidth(bounds(), only && focusRef.current ? 16 : 24, 1)
      else {
        // A wide canvas shows all of it, in the middle of what a person can see: the canvas is
        // the area beside an open conversation and below the toolbar, less the row at its foot
        // that the zoom control (and a cookie notice not yet answered) lies over. Never past 100%.
        const box = only ? bounds() : everything()
        const w = element.clientWidth, h = element.clientHeight
        // A board in focus has room round its frame: its neighbours show, dimmed, at the edges.
        const room = only ? Math.min(120, Math.max(margin, Math.floor(Math.min(w, h) / 10))) : margin
        // The canvas-shaped region that has the board in the middle of what is left above `foot`.
        const place = foot => {
          const scale = Math.min(1, (w - room * 2) / box.width, (h - room * 2 - foot) / box.height)
          return { scale, foot, region: { x: box.x + box.width / 2 - w / scale / 2, y: box.y + box.height / 2 - (h - foot) / 2 / scale, width: w / scale, height: h / scale } }
        }
        let view = place(28)
        // A cookie notice not yet answered lies over a corner of the canvas. Keep clear of it only
        // when the board would reach under it.
        const notice = document.querySelector('.sb-cookie')?.getBoundingClientRect()
        const here = element.getBoundingClientRect()
        const right = here.left + (box.x + box.width - view.region.x) * view.scale
        const bottom = here.top + (box.y + box.height - view.region.y) * view.scale
        if (notice && notice.left < right + 8 && notice.top < bottom + 8) view = place(Math.max(28, here.bottom - notice.top + 12))
        // fitToWidth shows a region across the canvas, centred.
        engine.fitToWidth(view.region, 0, 1)
      }
      viewIsTheirs = false
      fitted = framed()
      last = bounds()
      markWhole()
    }
    // The engine's own resize handling runs after animation-frame callbacks; fit once it has.
    // Only the board that frames the page fits the view on its own (one view for the page); any board does when put in focus.
    const fitSoon = () => framesRef.current ? board.whenDrawn().then(() => requestAnimationFrame(() => requestAnimationFrame(() => fit()))) : Promise.resolve()
    let width = measure()
    fitSoon()
    // A slate that loads with no notes of its own keeps trying to frame its content for a few
    // seconds, and frames the workshop's notes when they appear. Until that has run its course,
    // put the view back where the board was fitted, unless the person has taken it.
    const settleUntil = Date.now() + 3600
    const settle = setInterval(() => {
      // A proposal shown meanwhile is brought into view by the conversation's preview: the view is left to it. So is a
      // draft of another board (a library add right after a Keep), which frames itself.
      const drafting = Boolean(element?.querySelector?.('[data-workshop-draft]'))
      if (Date.now() > settleUntil || viewIsTheirs || shown.current || drafting || !framesRef.current) { clearInterval(settle); return }
      if (fitted && framed() !== fitted) fit()
    }, 120)
    // The board in focus is fitted once the canvas has stopped changing size (the chat panel opening
    // beside it, or over it on a phone), so it never ends up under the panel.
    let settling = 0
    fitBoardRef.current = () => {
      cancelAnimationFrame(settling)
      clearInterval(settle)
      let size = ''
      let steady = 0
      const started = Date.now()
      const wait = () => {
        if (live.current !== board) return
        const now = element ? element.clientWidth + 'x' + element.clientHeight : ''
        steady = now === size ? steady + 1 : 0
        size = now
        if (steady >= 8 || Date.now() - started > 1500) board.whenDrawn().then(() => fit(true))
        else settling = requestAnimationFrame(wait)
      }
      settling = requestAnimationFrame(wait)
    }
    const observer = typeof ResizeObserver === 'function' && element ? new ResizeObserver(() => {
      const next = measure()
      if (live.current !== board || next === width) return
      const phone = next < 600 || width < 600
      width = next
      // A business board takes its phone or laptop arrangement; lanes wrap per row.
      const wanted = kit ? kits.boardLayoutFor(next) : { lanesPerRow: lanesPerRow(next, board.value) }
      const rewrap = kit ? JSON.stringify(wanted) !== JSON.stringify(board.layout) : wanted.lanesPerRow !== board.layout.lanesPerRow
      if (rewrap) board.setLayout(wanted)
      // A draft of another board on show keeps the view it framed for itself.
      if ((rewrap || phone || !viewIsTheirs) && !element.querySelector('[data-workshop-draft]')) fitSoon()
    }) : null
    observer?.observe(element)
    // Any change of view (a pan, a zoom, a fit) changes what the canvas's viewBox says.
    let marking = 0
    const viewed = typeof MutationObserver === 'function' && engine.canvas?.node ? new MutationObserver(() => {
      cancelAnimationFrame(marking)
      marking = requestAnimationFrame(markWhole)
    }) : null
    viewed?.observe(engine.canvas.node, { attributes: true, attributeFilter: ['viewBox'] })
    // The view follows the workshop only when it has to: the board got wider or narrower (a lane
    // came or went), or it was all on screen and no longer is. A lane that grew by a card under
    // the person's eyes does not move the view, and a view the person set is theirs.
    refit.current = () => {
      const now = bounds()
      if (now.width === last.width && now.height === last.height) return
      const follow = now.width !== last.width || (inView(last) && !inView(now))
      last = now
      if (follow && !viewIsTheirs) fitSoon()
      else markWhole()
    }

    setFailure('')
    setController(board)
    return () => {
      cancelAnimationFrame(settling)
      fitBoardRef.current = null
      observer?.disconnect()
      viewed?.disconnect()
      cancelAnimationFrame(marking)
      element?.removeAttribute('data-whole-in-view')
      clearInterval(settle)
      element?.removeEventListener('pointerdown', down, true)
      element?.removeEventListener('wheel', wheel, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
      live.current = null
      refit.current = null
      pressed.current = false
      staged.current = false
      // Changes never sent were not saved. One on its way is answered when the server answers.
      for (const change of queue.current) { answers.current.get(change)?.(false); answers.current.delete(change) }
      settleSteps(queue.current, null)
      queue.current.length = 0
      turnedDown.current = null
      shown.current = null
      try { board.destroy() } catch { /* The slate is already gone. */ }
      setController(null)
      setPreview(null)
      setSelection(null)
      setCandidate(null)
      setShapeNotice(null)
      setFocus(null)
    }
  }, [engine, ready, reconcile, kits, boardId])

  // The board's notes say it is in focus (the engine's mark, the hook for a kit's focused-only parts), and the
  // canvas carries `focusing` meanwhile, which brings everything that is not this board down to 32%.
  useEffect(() => { controller?.setFocused?.(Boolean(focus)) }, [controller, focus])
  useEffect(() => {
    const element = engine?.element
    if (!controller || !focus || !element) return undefined
    element.classList.add('focusing')
    return () => element.classList.remove('focusing')
  }, [controller, focus, engine])

  // The publication delivered a model: the owner's own save coming back, or someone else's.
  useEffect(() => { if (controller) reconcile() }, [controller, state?.revision, state?.model, reconcile])
  // Notes and cards that traded places are drawn as the server recorded each trade, at once, even
  // while a change of this person's own is on its way or a card is held.
  useEffect(() => { if (engine && workshop) settleTrades(state) }, [engine, workshop, state?.revision, state?.trades, state?.through, settleTrades])

  useEffect(() => { controller?.setReadOnly(!editable) }, [controller, editable])
  // The rule controls: their chunk loads once a board that can be edited may show them (it registers itself with every
  // board), and the board is told when they show.
  const wantsControls = Boolean(controller && editable && controlsMode !== 'off')
  useEffect(() => {
    if (!wantsControls) return undefined
    let gone = false
    loadControls().then(() => { if (!gone) controller.setControls?.(controlsMode) }).catch(err => console.warn('The board’s controls could not be loaded.', err))
    return () => { gone = true }
  }, [wantsControls, controller, controlsMode])
  useEffect(() => { if (controller && !wantsControls) controller.setControls?.('off') }, [controller, wantsControls])

  // A save that did not go through is said once; it does not stay over the canvas.
  useEffect(() => {
    if (!error) return undefined
    const timer = setTimeout(() => setError(''), 8000)
    return () => clearTimeout(timer)
  }, [error])

  // The workshop as the server is known to hold it: what the publication delivered, or what this
  // person's own save came back with when that is newer. Every slate write goes through the save
  // core, which writes past Meteor's own collection, so the publication can deliver a kept
  // proposal a moment after the save answers; the conversation's next request is read against
  // the kept workshop, not the one before it.
  const ownSave = known.current
  const newest = workshop && ownSave && ownSave.revision > state.revision && ownSave.model?.kind === 'workshop'
    ? { revision: ownSave.revision, workshop: ownSave.model.workshop }
    : { revision: state?.revision, workshop }

  // A proposal from the conversation is shown on the canvas until it is kept or discarded, or
  // until the workshop it was made on has changed.
  const previewing = Boolean(editable && preview && preview.revision === newest.revision)
  const proposal = previewing ? preview.workshop : null
  // What the proposal changes, once drawn: the box (world units) around the cards and lanes it
  // outlines as provisional, or null when it outlines none.
  const [changed, setChanged] = useState(null)
  useEffect(() => {
    if (!controller || shown.current === proposal) return
    shown.current = proposal
    controller.preview(proposal)
    refit.current?.()
    if (!proposal) return
    // Measured after the board's own refit (two frames after it is drawn), so the preview's view comes last.
    const after = then => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(then)))
    controller.whenDrawn().then(() => after(() => {
      if (shown.current !== proposal) return
      const all = engine?.nodes?.allNodes ?? []
      const outlined = all.filter(node => node.svgGroup?.node?.hasAttribute?.('data-workshop-proposed'))
      const around = nodes => {
        const boxes = nodes.map(({ options: o }) => ({ x: o.x, y: o.y, width: o.width ?? 0, height: o.height ?? 0 }))
          .filter(box => [box.x, box.y].every(Number.isFinite))
        if (!boxes.length) return null
        const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y))
        return { x: left, y: top, width: Math.max(...boxes.map(b => b.x + b.width)) - left, height: Math.max(...boxes.map(b => b.y + b.height)) - top }
      }
      // The change with the names of the lanes its cards are in, then the change alone.
      const names = workshopNodeIds.of(main ? undefined : boardId)
      const lanes = new Set(outlined.map(node => proposal.cards.find(card => names.card(card.id) === node.id)?.laneId).filter(Boolean))
      const named = around([...outlined, ...all.filter(node => [...lanes].some(laneId => node.id === names.lane(laneId)))])
      const alone = around(outlined)
      setChanged({ proposal, box: alone ? [named, alone] : null })
    })).catch(() => { if (shown.current === proposal) setChanged({ proposal, box: null }) })
  }, [controller, proposal])

  const title = workshop?.title
  const namedRef = useRef(null)
  namedRef.current = { onTitle, namesSlate }
  useEffect(() => { if (title && namesSlate) namedRef.current.onTitle?.(title) }, [title, namesSlate])

  // The publication has nothing for this person: the slate is still loading, or their access
  // has been taken away. The page decides which (it asks the server) and leaves if it is gone.
  // Try a board that could not be loaded again.
  const retryBoard = () => { const again = retryRef.current; retryRef.current = null; again?.() }
  if (!workshop) return { boardId, active: Boolean(enabled), ready: false, failure, unavailable: Boolean(main && enabled && subscribed && !failure) }
  // A board given its first rules while it is open here (by a teammate, or by an agent) can't be
  // read until its rulebook has loaded: until then it is a board still loading, never one read
  // without its rules. The rulebook arrives in a moment and the board is drawn again with them.
  if (hasRules && !rules && !rulebookLoaded()) return { boardId, active: true, ready: false, failure, retryBoard: failure ? retryBoard : null, unavailable: false }

  // The room this board keeps (world units): where it sits and the widest it can become, as tall as it is
  // now. The page hands it to the other boards (avoid) and places nothing over it.
  let room = null
  if (controller && live.current) {
    try {
      const reserve = workshopReserve(controller.value, {}, boardKind ? kits?.kitFor?.(boardKind) : undefined)
      const drawn = live.current.bounds
      // The room grows upward by the board's title row and legend (its chrome), so no board's legend runs into another.
      const above = Math.max(0, live.current.origin.y - (live.current.frame?.y ?? live.current.origin.y))
      room = { x: live.current.origin.x, y: live.current.origin.y - above, width: Math.max(reserve.width, drawn?.width ?? 0), height: Math.max(reserve.height, drawn?.height ?? 0) + above }
    } catch { room = live.current.bounds ? { x: live.current.origin.x, y: live.current.origin.y, width: live.current.bounds.width, height: live.current.bounds.height } : null }
  }
  return {
    boardId,
    room,
    active: true,
    ready: Boolean(controller),
    failure,
    // Set while a board that could not be loaded can be tried again.
    retryBoard: failure && ((boardKind && !kitsReady) || (hasRules && !rules)) ? retryBoard : null,
    model: newest.workshop,
    // What the canvas shows now: a proposal, the board a held or staged card would make, or the workshop.
    visible: proposal ?? candidate ?? controller?.value ?? newest.workshop,
    revision: newest.revision,
    editable,
    embedded: Boolean(embedded),
    canJoin: Boolean(state.canJoin && guestAdmitted && !embedded),
    joining,
    saving,
    offline: !connected,
    error,
    notice,
    shapeNotice,
    clearShapeNotice: () => setShapeNotice(null),
    // "Move anyway?" while it is asked: { card, lane, reason }, and the answer (true: move it, false: cancel).
    moveAnyway: moveAnyway?.ask ?? null,
    answerMoveAnyway: yes => { if (!moveAnyway) return; moveAnyway.answer(Boolean(yes)); setMoveAnyway(null) },
    selection,
    // The board in focus for the chat ('main') or null; focusBoard puts it in focus and fits the view to
    // it once the chat has settled. While a proposal waits for Keep or Discard, focus stays on its
    // board: leaveFocus is refused (false) until the person decides.
    focus,
    focusLocked: Boolean(preview),
    focusBoard: () => {
      if (!controller) return false
      setFocus(boardId)
      fitBoardRef.current?.()
      return true
    },
    // Bring this board into view (a board just added beside the others: the person sees where it went),
    // without putting it in focus.
    showBoard: () => {
      if (!controller) return false
      fitBoardRef.current?.()
      return true
    },
    leaveFocus: leaveRef.current = () => {
      if (preview) return false
      setFocus(null)
      return true
    },
    preview,
    previewing,
    // Where the workshop is drawn (world units), for the caption that marks a proposal as a preview.
    frame: live.current?.frame ?? live.current?.bounds ?? null,
    // What the proposal shown changes (world units, with and without its lanes' names): null when it
    // outlines nothing, undefined until it is drawn.
    changed: proposal && changed?.proposal === proposal ? changed.box : undefined,
    setPreview,
    clearSelection: () => engine?.clearSelection?.(),
    // A card taken off the lanes as an ordinary note beside the board (the conversation's "make
    // this a note"). Null when done; otherwise the reason it stays a card.
    toCanvas: cardId => controller ? controller.toCanvas(cardId) : 'The workshop is still loading. Try again in a moment.',
    // A card moved from its bar (Move to): the same change a drag makes, on the same rules.
    move: (cardId, laneId) => {
      const board = live.current
      const current = board?.value
      if (!editable || !board || !current || preview) return false
      const next = workshopCandidate(current, cardId, laneId)
      if (!next) {
        const reason = workshopRefusal(current, cardId, laneId) || 'That move is not available.'
        board.refuse(laneId, reason)
        // A rule the person may break once they say so: asked, as a drop is; confirmed, played as an override.
        const card = current.cards.find(item => item.id === cardId), lane = current.lanes.find(item => item.id === laneId)
        const probe = card && lane && workshopOverrideCandidate(current, cardId, laneId, { by: 'You', at: new Date().toISOString() })
        if (probe) {
          // Asked with the sentence the mark keeps (every rule the move breaks), and sent with it: the server asks again
          // when the board it saves on would break something else.
          const agreed = probe.cards.find(item => item.id === cardId)?.override?.sentence || reason
          askMoveAnyway({ cardId, laneId, card: card.label, lane: lane.label, reason: agreed }).then(yes => {
            if (!yes || live.current !== board) return
            const forced = workshopOverrideCandidate(board.value, cardId, laneId, { by: moverName(Meteor.user()), at: new Date().toISOString() })
            if (!forced) return
            board.update(forced)
            queueChange({ cardId, laneId, override: true, reason: agreed })
            playRef.current()
          })
          return false
        }
        setError(reason)
        return false
      }
      board.update(next)
      queueChange({ cardId, laneId })
      playRef.current()
      return true
    },
    // The slate's author takes a card off the board: a new model, saved on its revision. Its lines go with it, as a note's do. On a
    // launch plan, pipeline or budget it is the board's own edit (what waited on a task stops
    // waiting), made by the server on the board as it stands, and Undo puts it back.
    removeCard: (cardId) => {
      const current = known.current?.model.workshop
      if (!editable || !current || !current.cards.some(card => card.id === cardId)) return Promise.resolve(false)
      if (boardKind) {
        queueChange({ edits: [{ kind: 'remove_card', card: { id: cardId } }], cardId })
        playRef.current()
        return Promise.resolve(true)
      }
      const kept = workshopWithoutCardLines(current, cardId)
      return inFlight.current || queue.current.length ? Promise.resolve(false)
        : send({ ...kept, cards: kept.cards.filter(card => card.id !== cardId) }, { revision: known.current.revision })
    },
    // A save from the page. False when it did not go through; the reason is in `error`.
    save: (next, revision) => inFlight.current || queue.current.length ? Promise.resolve(false) : send(next, { revision }),
    // A new name for the slate is a new title for its workshop: a change like any other, so it
    // waits its turn behind a save in flight and is never dropped. A name the workshop cannot
    // take is said, and the saved one goes back in the toolbar.
    rename: name => {
      const label = String(name ?? '').replace(/\s+/g, ' ').trim()
      const current = known.current?.model.workshop
      if (!editable || !current || !live.current) return
      if (label === current.title) return
      try { validateWorkshop({ ...current, title: label }) } catch {
        const problem = label ? 'A name can have up to 120 characters, without < or >. The name was not changed.' : 'A slate needs a name. The name was not changed.'
        setError(problem)
        namedRef.current.onTitle?.(current.title, problem)
        return
      }
      queueChange({ rename: { title: label } })
      playRef.current()
    },
    async join() {
      if (joining || embedded || !guestAdmitted || !state.canJoin || Meteor.userId() || Meteor.loggingIn()) return
      setJoining(true)
      setError('')
      try {
        // The subscription reruns as this guest and every write still checks the current grant.
        await createAnonymousUser({ creativeEditLink: shareId })
      } catch {
        setError('Could not join this slate. Reopen the link to check your access.')
      } finally { setJoining(false) }
    },
  }
}
