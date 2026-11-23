import { createHash } from 'node:crypto'
import {
  applyWorkshopEdits,
  checkWorkshopReplacement,
  describeWorkshopEdits,
  validateWorkshop,
  workshopLineRefusal,
  workshopNewLine,
  workshopRefusal,
  workshopTakesLines,
  workshopWithLine,
  workshopScopedId,
} from 'slateboxjs/workshops/model'
// A launch plan's, pipeline's or budget's rules: the same modules the canvas plays them by.
import 'slateboxjs/workshops/rules'
import { prepareMapReply } from './methods/map-chat.mjs'
import { portableWorkshopSlate } from '../imports/api/common/portableWorkshopSlate.mjs'
import { sharedSaveConditions } from './methods/native-slate-save.mjs'
import { readWorkshop } from './workshop-read.mjs'
import { WORKSHOP_OPERATION_KINDS } from '../imports/api/common/slate-operation-runs.mjs'
import { MAIN_BOARD, boardIdPattern, boardPaths, chooseBoard, counterWrite, slateAsBoard } from '../imports/api/common/slate-boards.mjs'

export class WorkshopOperationError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const invalid = (message, details) =>
  new WorkshopOperationError(400, 'invalid_operation_plan', message, details)

// The workshop as it now stands goes with the refusal, so one round trip is enough to choose again.
function stale(slate) {
  let details
  try {
    if (slate)
      details = { revision: slate.creative.revision, workshop: summarizeWorkshop(slate) }
  } catch {
    /* A slate that can no longer be read as a workshop is reported without its board. */
  }
  return new WorkshopOperationError(
    409,
    'slate_changed',
    'The workshop changed. Read its current revision and choose again.',
    details
  )
}

/** The operation kinds this board accepts, for an answer to a request it cannot act on. */
function supportedOperations(board) {
  const kinds = ['workshop_edits', 'undo_workshop_edit', 'move_workshop_card', 'set_presentation_order']
  if (isMap(board)) return [...kinds, 'add_map_branch', 'update_map_outcome']
  // A board of plain lanes joins its cards to notes and to each other with lines.
  return workshopTakesLines(board) ? [...kinds, 'connect_workshop_card', 'disconnect_workshop_card'] : kinds
}

/** The edits (workshop_edits) this board takes: the engine's own table, read for this board. */
export const acceptedEdits = (board) =>
  describeWorkshopEdits(board).filter((edit) => edit.accepted).map((edit) => edit.kind)

// Edits that only add or change, which a person makes with no prompt. Anything else that takes
// something away (a card, a lane, a dependency, an outcome) is reported under removed* and held
// by the exec gate until the person agrees.
export const WORKSHOP_EDIT_LIMIT = 50

const isMap = (board) => !board.kind && Boolean(board.lanes[0]?.station)

function readBoard(slate) {
  if (
    slate.creative?.model?.version !== 1 ||
    !Number.isSafeInteger(slate.creative.revision)
  )
    throw invalid('This workshop version cannot be edited.')
  try {
    return validateWorkshop(slate.creative.model.workshop)
  } catch {
    throw invalid('The saved workshop cannot be read.')
  }
}

// The workshop read of a board this request holds (a candidate, or the board a refusal is
// about) at the revision it has or will have.
function workshopAt(board, slate, revision) {
  return readWorkshop(board, { ...slate, creative: { ...slate.creative, revision } }, { operations: supportedOperations(board), edits: acceptedEdits(board) })
}

// The workshop read (workshop-read.mjs) of a stored slate, refusing one that cannot be read.
// extras: the clock for the live presentation.
export function summarizeWorkshop(slate, extras = {}) {
  const board = readBoard(slate)
  return readWorkshop(board, slate, { ...extras, operations: supportedOperations(board), edits: acceptedEdits(board) })
}

const operationFields = new Map([
  ['workshop_edits', ['edits']],
  ['undo_workshop_edit', ['receiptId']],
  ['set_presentation_order', ['laneIds']],
  ['move_workshop_card', ['cardId', 'laneId']],
  ['add_map_branch', ['fromStationId', 'label', 'outcome']],
  ['update_map_outcome', ['stationId', 'outcome']],
  ['connect_workshop_card', ['cardId', 'toId']],
  ['disconnect_workshop_card', ['cardId', 'toId']],
])

export const isWorkshopOperation = (kind) => operationFields.has(kind)
// The listener's list is this one (slate-operation-runs.mjs): checked once, at start.
if (WORKSHOP_OPERATION_KINDS.length !== operationFields.size || WORKSHOP_OPERATION_KINDS.some((kind) => !operationFields.has(kind)))
  throw new Error('WORKSHOP_OPERATION_KINDS must list every workshop operation kind')

function parseOperation(plan, supported) {
  const op = plan?.operations?.[0]
  const fields = operationFields.get(op?.kind)
  if (
    typeof plan?.message !== 'string' ||
    !plan.message.trim() ||
    !Array.isArray(plan.operations) ||
    plan.operations.length !== 1 ||
    !fields
  )
    throw invalid('Provide one supported workshop operation.', { supported })
  if (
    !Number.isSafeInteger(op.expectedRevision) ||
    op.expectedRevision < 0 ||
    fields.some((field) =>
      field === 'edits'
        ? !Array.isArray(op.edits) ||
          op.edits.length < 1 ||
          op.edits.length > WORKSHOP_EDIT_LIMIT ||
          op.edits.some((edit) => !edit || typeof edit !== 'object' || Array.isArray(edit) || typeof edit.kind !== 'string')
        : field === 'receiptId'
        ? typeof op.receiptId !== 'string' || !/^workshop-[0-9a-f]{64}$/.test(op.receiptId)
        : field === 'laneIds'
        ? !Array.isArray(op.laneIds) ||
          op.laneIds.length < 2 ||
          op.laneIds.length > 5 ||
          op.laneIds.some((id) => typeof id !== 'string' || !id)
        : typeof op[field] !== 'string' || !op[field].trim()
    ) ||
    (fields.includes('label') && op.label.length > 80) ||
    (fields.includes('outcome') && op.outcome.length > 160) ||
    (op.boardId !== undefined && (typeof op.boardId !== 'string' || !boardIdPattern.test(op.boardId))) ||
    Object.keys(op).some(
      (key) => !['kind', ...fields, 'expectedRevision', 'boardId'].includes(key)
    )
  )
    throw invalid(
      op.kind === 'workshop_edits'
        ? 'Provide edits (1 to ' + WORKSHOP_EDIT_LIMIT + ' edits, each with its kind) and expectedRevision.'
        : op.kind === 'undo_workshop_edit'
        ? 'Provide receiptId (the receiptId a saved workshop edit answered with) and expectedRevision.'
        : 'Provide ' + fields.join(', ') + ' and expectedRevision.'
    )
  // Keep fingerprints identical across JSON property order and historical move receipts. The board is
  // named only when the call names it (a slate of one board answers to calls that never did).
  return {
    kind: op.kind,
    ...(op.boardId !== undefined && { boardId: op.boardId }),
    ...Object.fromEntries(fields.map((field) => [field, op[field]])),
    expectedRevision: op.expectedRevision,
  }
}

// Which board of the slate an operation is for (slate-boards.mjs): the one it names, or the only one.
// A slate of several boards and a call that names none is refused with the boards (board_required),
// so a call never changes the first board by accident.
export function operationBoard(slate, boardId) {
  try {
    return chooseBoard(slate, boardId)
  } catch (error) {
    if (error.code === 'board_required' || error.code === 'board_not_found')
      throw new WorkshopOperationError(error.code === 'board_required' ? 400 : 404, error.code, error.message, { boards: error.boards })
    throw invalid('This workshop version cannot be edited.')
  }
}

// The names an agent's pointer goes to, in the board's own scope (b2:card-<id> on a further board).
const scopedTargets = (report, boardId) =>
  boardId === MAIN_BOARD || !Array.isArray(report?.targets) ? report : { ...report, targets: report.targets.map((id) => workshopScopedId(id, boardId)) }

function applyWorkshopEdit(board, operation, slate) {
  switch (operation.kind) {
    case 'workshop_edits':
      return applyEdits(board, operation, slate)
    case 'move_workshop_card':
      return applyCardMove(board, operation, slate)
    case 'connect_workshop_card':
    case 'disconnect_workshop_card':
      return applyCardLine(board, operation, slate)
    case 'set_presentation_order': {
      try {
        const next = validateWorkshop({
          ...board,
          presentationOrder: operation.laneIds,
        })
        return { next, report: { presentationOrder: next.presentationOrder } }
      } catch (error) {
        throw invalid(error.message)
      }
    }
    default:
      return applyMapEdit(board, operation)
  }
}

function applyMapEdit(board, operation) {
  const adding = operation.kind === 'add_map_branch'
  const edit = adding
    ? {
        type: 'addBranch',
        from: operation.fromStationId,
        label: operation.label,
        outcome: operation.outcome,
      }
    : { type: 'outcome', id: operation.stationId, text: operation.outcome }
  if (!isMap(board))
    throw invalid('Choose an interactive map to edit its stations.', {
      supported: supportedOperations(board),
    })
  try {
    const { workshop: next } = prepareMapReply(
      { reply: 'Map updated.', edits: [edit] },
      board
    )
    const report = adding
      ? {
          addedBranches: [
            { fromStationId: edit.from, stationId: next.lanes.at(-1).id },
          ],
        }
      : { updatedOutcomes: [{ stationId: edit.id }] }
    return { next, report }
  } catch (error) {
    throw invalid(error.message)
  }
}

// A line from a card to another card, or to an ordinary note of the slate's drawing (by its id), as
// a person draws one with a card's plug; or every line between the two taken away, or one of the
// card's lines taken away by its id (the only name a line with a free end has).
function applyCardLine(board, operation, slate) {
  if (!workshopTakesLines(board))
    throw invalid('Lines join the cards of a lane workshop to notes and to each other. This board keeps the cards it came with.', {
      supported: supportedOperations(board),
    })
  const card = board.cards.find((item) => item.id === operation.cardId)
  if (!card) throw invalid('That card is not on the workshop. Use a card ID from the board.')
  const toId = operation.toId
  const toCard = board.cards.some((item) => item.id === toId)
  const toNote = (slate.nodes ?? []).some((node) => node?.options?.id === toId)
  if (toId === card.id) throw invalid('A line joins two different cards or notes.')
  const between = (line) =>
    (line.parentId === card.id && line.childId === toId) || (line.parentId === toId && line.childId === card.id)
  if (operation.kind === 'disconnect_workshop_card') {
    // A line is named by what it joins (a card or a note), or by its own id: a line whose end is
    // free on the canvas joins nothing, so the read gives it only its id and toPoint.
    const named = (line) => line.id === toId && (line.parentId === card.id || line.childId === card.id)
    const gone = (line) => between(line) || named(line)
    const removed = (board.lines ?? []).filter(gone)
    if (!removed.length) {
      if (!toCard && !toNote)
        throw invalid('That card, note or line is not on this slate. Use a card ID from the workshop, a note ID from the slate, or the id of one of the card\'s lines.')
      throw invalid(`${card.label} and ${toId} are not joined by a line.`)
    }
    const next = validateWorkshop({ ...board, lines: board.lines.filter((line) => !gone(line)) })
    return { next, report: { removedLines: removed.map((line) => line.id) } }
  }
  if (!toCard && !toNote) throw invalid('That card or note is not on this slate. Use a card ID from the workshop or a note ID from the slate.')
  const line = workshopNewLine(board, card.id, toId)
  const reason = workshopLineRefusal(board, line)
  if (reason) throw invalid(reason)
  return { next: workshopWithLine(board, line), report: { lines: [{ id: line.id, fromId: card.id, toId }] } }
}

// The short form of one move_card: the same reducer, the same rule a person's drag meets.
function applyCardMove(board, operation, slate) {
  const revision = operation.expectedRevision
  const card = board.cards.find((item) => item.id === operation.cardId)
  if (!card) throw invalid('That card is not on the workshop. Use a card ID from the board.')
  const lane = board.lanes.find((item) => item.id === operation.laneId)
  if (!lane) throw invalid('That lane is not on the workshop. Use a lane ID from the board.')
  if (card.laneId === lane.id) throw invalid(`${card.label} is already in ${lane.label}.`)
  const result = applyWorkshopEdits(board, [{ kind: 'move_card', card: { id: card.id }, lane: { id: lane.id } }])
  if (result.refused) {
    const current = workshopAt(board, slate, revision)
    throw new WorkshopOperationError(
      409,
      'move_refused',
      workshopRefusal(board, card.id, lane.id) ?? result.refused.reason ?? 'That move is not available.',
      {
        cardId: card.id,
        laneId: lane.id,
        legalLaneIds: current.cards.find((item) => item.id === card.id).legalLaneIds,
        revision,
        workshop: current,
      }
    )
  }
  return { next: result.workshop, report: { movedCards: result.report.movedCards, targets: targetsOf(result.report) } }
}

// The card lines taken away on their own. A line that went with a removed card is part of that
// card's removal (removedCards), not counted twice.
function removedLines(before, after) {
  const lines = new Set((after.lines ?? []).map((line) => line.id))
  const cards = new Set(after.cards.map((card) => card.id))
  const gone = new Set(before.cards.filter((card) => !cards.has(card.id)).map((card) => card.id))
  return (before.lines ?? [])
    .filter((line) => !lines.has(line.id) && !gone.has(line.parentId) && !gone.has(line.childId))
    .map((line) => line.id)
}

// What a list of edits took away, by comparing the boards: the cards and lanes that went, the
// dependencies that went between cards that stayed, the outcomes that went, and the card lines.
export function removedBetween(before, after) {
  const cards = new Set(after.cards.map((card) => card.id))
  const lanes = new Set(after.lanes.map((lane) => lane.id))
  const signals = new Set((after.signals ?? []).map((signal) => signal.id))
  const links = new Set(after.cards.flatMap((card) => (card.dependsOn ?? []).map((id) => card.id + '>' + id)))
  return {
    removedCards: before.cards.filter((card) => !cards.has(card.id)).map((card) => card.id),
    removedLanes: before.lanes.filter((lane) => !lanes.has(lane.id)).map((lane) => lane.id),
    removedLinks: before.cards.flatMap((card) =>
      cards.has(card.id)
        ? (card.dependsOn ?? [])
            .filter((id) => cards.has(id) && !links.has(card.id + '>' + id))
            .map((id) => ({ cardId: card.id, waitsOn: id }))
        : []
    ),
    removedOutcomes: (before.signals ?? []).filter((signal) => !signals.has(signal.id)).map((signal) => signal.id),
    removedPaths: removedPaths(before, after),
    // A step's picture taken off (set_station_image with null) is a removal too.
    removedImages: before.lanes
      .filter((lane) => lane.station?.image && lanes.has(lane.id) && !after.lanes.find((item) => item.id === lane.id)?.station?.image)
      .map((lane) => lane.id),
    // A card's line taken away (disconnect_cards, disconnect_note, an undo) is a removal too.
    removedLines: removedLines(before, after),
  }
}

// A map's paths that went between steps that stayed. A path a new step now carries (a step put
// in front of another: A → new → B for A → B) was moved, not taken away.
function removedPaths(before, after) {
  const was = new Map(before.lanes.filter((lane) => lane.station).map((lane) => [lane.id, lane.station.next ?? []]))
  const now = new Map(after.lanes.filter((lane) => lane.station).map((lane) => [lane.id, lane.station.next ?? []]))
  const added = new Set([...now.keys()].filter((id) => !was.has(id)))
  // Whether `to` is reached from `from` through new steps only.
  const bridged = (from, to) => {
    const seen = new Set()
    const queue = [...(now.get(from) ?? [])]
    while (queue.length) {
      const id = queue.shift()
      if (id === to) return true
      if (!added.has(id) || seen.has(id)) continue
      seen.add(id)
      queue.push(...(now.get(id) ?? []))
    }
    return false
  }
  const out = []
  for (const [from, next] of was) {
    if (!now.has(from)) continue
    for (const to of next) if (now.has(to) && !bridged(from, to)) out.push({ from, to })
  }
  return out
}

// The notes a save touched, by the names the canvas draws them under (card-<id>, lane-<id>):
// where an agent's pointer goes.
function targetsOf(report) {
  const out = []
  const add = (id) => { if (id && !out.includes(id)) out.push(id) }
  for (const edit of report.edits ?? []) add(edit.cardId ? 'card-' + edit.cardId : edit.laneId ? 'lane-' + edit.laneId : null)
  for (const move of report.movedCards ?? []) add('card-' + move.cardId)
  return out
}

// A refusal answers with the sentence a person is given, which edit it was, and the board as it
// stands. A move names the lanes the card may go to.
function refusedEdit(board, slate, revision, refused, edit) {
  const current = workshopAt(board, slate, revision)
  const cardId = refused.cardId ?? (typeof edit?.card === 'object' ? edit.card?.id : undefined)
  const card = cardId && current.cards.find((item) => item.id === cardId)
  const malformed = refused.code === 'invalid_edit'
  return new WorkshopOperationError(malformed ? 400 : 409, malformed ? 'invalid_operation_plan' : 'edit_refused', refused.reason, {
    status: 'refused',
    reason: refused.reason,
    code: refused.code,
    editIndex: refused.index,
    kind: refused.kind,
    ...(refused.laneId && { laneId: refused.laneId }),
    ...(card && { cardId: card.id }),
    ...(card && ['move_card', 'advance_card'].includes(refused.kind) && { legalLaneIds: card.legalLaneIds }),
    ...(refused.candidates && { candidates: refused.candidates }),
    // A number out of range: the range a person may use, and the sentence at each end.
    ...(refused.limits && { limits: refused.limits }),
    revision,
    workshop: current,
  })
}

function applyEdits(board, operation, slate) {
  const result = applyWorkshopEdits(board, operation.edits)
  if (result.refused)
    throw refusedEdit(board, slate, operation.expectedRevision, result.refused, operation.edits[result.refused.index])
  const added = new Set(board.cards.map((card) => card.id))
  return {
    next: result.workshop,
    report: {
      edits: result.report.edits,
      movedCards: result.report.movedCards,
      addedCards: result.workshop.cards.filter((card) => !added.has(card.id)).map((card) => card.id),
      ...removedBetween(board, result.workshop),
      targets: targetsOf(result.report),
    },
  }
}

export function createWorkshopOperations({
  slates,
  runs,
  saveCore,
  withTransaction,
  now = Date.now,
}) {
  return async function apply({
    slate: stored,
    token,
    plan,
    userMessage = '',
    dryRun = false,
    key,
  }) {
    if (typeof dryRun !== 'boolean' || typeof userMessage !== 'string')
      throw invalid('Use a boolean dryRun and a text userMessage.')
    // The slate as the board the operation is for sees it: creative is that board's record.
    const named = plan?.operations?.[0]?.boardId
    const chosen = operationBoard(stored, typeof named === 'string' ? named : undefined)
    const slate = slateAsBoard(stored, chosen.id)
    const boardId = chosen.id
    const paths = boardPaths(boardId)
    let supported
    try {
      supported = supportedOperations(readBoard(slate))
    } catch {
      /* readBoard reports an unreadable workshop when the edit is made. */
    }
    const operation = parseOperation(plan, supported)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([slate._id, plan.message, operation, userMessage]))
      .digest('hex')
    const runId = key
      ? createHash('sha256').update(JSON.stringify([token._id, key])).digest('hex')
      : null
    const replay = async (session) => {
      if (!key) return null
      const prior = await runs.findOne(
        { tokenId: token._id, idempotencyKey: key },
        { session }
      )
      if (!prior) return null
      if (prior.workshopFingerprint !== fingerprint) {
        throw new WorkshopOperationError(
          409,
          'idempotency_conflict',
          'That key belongs to a different edit. Use a new key.'
        )
      }
      return { status: 200, body: prior.response }
    }
    // An undo names a saved workshop edit of this account on this slate. It puts back the board
    // as it was before that edit only while nothing has changed since: the rule a person's
    // "Undo last change" keeps.
    const undoable = async (session) => {
      if (operation.kind !== 'undo_workshop_edit') return null
      const receipt = await runs.findOne({ _id: operation.receiptId }, { session })
      if (!receipt || receipt.slateId !== slate._id || receipt.userId !== token.userId || !receipt.before || (receipt.boardId ?? MAIN_BOARD) !== boardId)
        throw new WorkshopOperationError(404, 'not_found', 'There is no saved workshop edit of yours with that receiptId on this slate.')
      return receipt
    }
    function predict(receipt) {
      if (slate.creative.revision !== operation.expectedRevision) throw stale(slate)
      const board = readBoard(slate)
      let next, report
      if (receipt) {
        if (receipt.afterRevision !== slate.creative.revision) throw stale(slate)
        const refusal = checkWorkshopReplacement(board, receipt.before)
        if (refusal) throw refusedEdit(board, slate, operation.expectedRevision, { reason: refusal, code: 'refused', index: 0, kind: 'undo_workshop_edit', laneId: null })
        next = validateWorkshop(receipt.before)
        // Undoing an edit that added cards takes them away again: reported (and held) as any removal is.
        report = { undone: receipt._id, restoredRevision: receipt.beforeRevision, ...removedBetween(board, next), targets: receipt.report?.targets ?? [] }
      } else {
        ;({ next, report } = applyWorkshopEdit(board, operation, slate))
      }
      report = scopedTargets(report, boardId)
      const body = {
        ok: true,
        dryRun,
        shareId: slate.shareId,
        message: plan.message,
        operations: [operation],
        ...(boardId !== MAIN_BOARD && { boardId }),
        report,
        ...(!dryRun && runId && { receiptId: 'workshop-' + runId }),
        workshop: workshopAt(next, slate, operation.expectedRevision + (dryRun ? 0 : 1)),
      }
      return { board, next, body }
    }
    if (dryRun) return { status: 200, body: predict(await undoable()).body }
    if (!key)
      throw invalid('Set Idempotency-Key when committing a workshop operation.')
    // A board mutation and its replay receipt must either both commit or both roll back.
    try {
      return await withTransaction(async (session) => {
        const prior = await replay(session)
        if (prior) return prior
        const { board, next, body } = predict(await undoable(session))
        // A map's stations are its description: a change to them is saved with it.
        const describe =
          isMap(next) &&
          (operation.kind === 'add_map_branch' ||
            JSON.stringify(next.lanes.map((lane) => [lane.id, lane.label])) !== JSON.stringify(board.lanes.map((lane) => [lane.id, lane.label])))
        // The save core writes it on the workshop's own revision and logs the touched lanes
        // and cards, in this transaction.
        let saved = true
        // On a slate of many boards the slate's counter for all of them goes up in the same write, as a
        // person's change does (creativeSlates.save, play): the canvas's autosave is fenced on it.
        const counter = counterWrite(stored)
        try {
          await saveCore.save({
            slateId: slate._id,
            actor: { kind: 'agent', userId: token.userId, tokenId: token._id, tokenName: token.name },
            source: 'workshop',
            session,
            conditions: {
              userId: slate.userId,
              orgId: slate.orgId ?? null,
              [paths.kind]: 'workshop',
              [paths.revision]: operation.expectedRevision,
              ...counter.conditions,
              ...sharedSaveConditions(slate, token.userId),
            },
            build: () => ({
              set: {
                [paths.workshop]: next,
                ...counter.set,
                // A further board's map never describes the slate: its first board does.
                ...(describe && boardId === MAIN_BOARD && {
                  'options.description': portableWorkshopSlate.describe({
                    workshop: next,
                  }),
                }),
              },
              inc: { [paths.revision]: 1 },
            }),
          })
        } catch (error) {
          if (error?.code !== 'save_refused') throw error
          saved = false
        }
        const savedAt = now()
        if (!saved) {
          // The write is also refused when sharing changed. Show the board as it now
          // stands only to a caller who could still save it; otherwise say no more.
          const current = await slates.findOne(
            {
              _id: slate._id,
              userId: slate.userId,
              orgId: slate.orgId ?? null,
              ...sharedSaveConditions(slate, token.userId),
            },
            { session }
          )
          throw stale(current && slateAsBoard(current, boardId))
        }
        // The receipt keeps the board as it was, so this edit can be undone while nothing
        // has changed since (undo_workshop_edit, and a person's one-step undo).
        await runs.insertOne(
          {
            _id: 'workshop-' + runId,
            tokenId: token._id,
            userId: token.userId,
            slateId: slate._id,
            slateShareId: slate.shareId,
            ...(boardId !== MAIN_BOARD && { boardId }),
            idempotencyKey: key,
            workshopFingerprint: fingerprint,
            plan: { message: plan.message, operations: [operation] },
            report: body.report,
            before: board,
            beforeRevision: operation.expectedRevision,
            afterRevision: operation.expectedRevision + 1,
            userMessage,
            response: body,
            createdAt: savedAt,
          },
          { session }
        )
        return { status: 201, body }
      })
    } catch (error) {
      if (error.code === 11000) {
        const prior = await replay()
        if (prior) return prior
      }
      throw error
    }
  }
}
