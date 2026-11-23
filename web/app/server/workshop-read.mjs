// The read of a workshop or map: what a person sees on its canvas and in its chrome, as data.
// Every read path that returns a workshop (GET /slates/{id}, a refused write's current board,
// the create receipt) returns this one shape.
import {
  describeWorkshopEdits,
  releaseLoad,
  resolveWorkshopSignals,
  startupExperienceKind,
  workshopBoardKind,
  workshopBudgetResult,
  workshopDestinations,
  workshopLaneCaption,
  workshopPresentationLanes,
  workshopPresentationScenes,
} from 'slateboxjs/workshops/model'
import { budgetCommitted, launchFinish, pipelineForecast, runwayMonths, scheduleLaunch } from 'slateboxjs/workshops/rules'
import { visibleLiveSession } from './methods/live-presentation.mjs'

function liveStep(slate, now) {
  const live = visibleLiveSession(slate, now)
  return live && { sessionId: live.sessionId, step: live.step, revision: live.revision, expiresAt: live.expiresAt }
}

// What this kind of board keeps as it came, in the sentence it answers a change with; null
// where it may change. Read from the engine's edit table, so it says what the rules say.
function fixedParts(board) {
  const edits = new Map(describeWorkshopEdits(board).map((edit) => [edit.kind, edit]))
  const refused = (kind) => (edits.get(kind)?.accepted === false ? edits.get(kind).refusal : null)
  return {
    lanes: (refused('add_lane') && refused('remove_lane')) || null,
    cards: refused('add_card'),
  }
}

/**
 * board: a validated workshop. slate: its stored row (for revision and live presentation).
 * operations: the operation kinds the operations route takes on this board.
 * edits: the edits workshop_edits takes on this board (the engine's table, read for it).
 */
export function readWorkshop(board, slate, { operations, edits, now = Date.now() } = {}) {
  const kind = workshopBoardKind(board)
  const release = board.kind === 'release-plan'
  const scenes = workshopPresentationScenes(board)
  // A launch plan's days, as the canvas draws them: each task's start and end, and its slack.
  const times = board.kind === 'launch-plan' || board.kind === 'hiring-plan' ? scheduleLaunch(board) : null
  return {
    title: board.title,
    kind,
    ...(board.launch && { launch: { day: board.launch.day, finish: launchFinish(board), ...(board.launch.name && { name: board.launch.name }) } }),
    // A dated plan's first day (days are offsets from it); a hiring plan's money and its runway readout.
    ...(board.clock && { clock: board.clock }),
    ...(board.hiring && { hiring: { ...board.hiring, runway: runwayMonths(board) } }),
    ...(board.forecast && { forecast: { ...board.forecast, value: pipelineForecast(board) } }),
    ...(board.budget && { budget: board.budget }),
    experience: startupExperienceKind(board) ?? null,
    fixed: fixedParts(board),
    revision: slate.creative.revision,
    presentationOrder: workshopPresentationLanes(board).map((lane) => lane.id),
    lanes: board.lanes.map((lane) => {
      const held = board.cards.filter((card) => card.laneId === lane.id).length
      const budget = workshopBudgetResult(board, lane.id)
      return {
        id: lane.id,
        label: lane.label,
        ...(lane.capacity !== undefined && { capacity: lane.capacity }),
        // The line under the lane's name on the canvas: "2 of 3", "4 / 8 points", "$300 · ...".
        caption: workshopLaneCaption(board, lane.id),
        held,
        ...(release && { load: releaseLoad(board, lane.id) }),
        ...(budget && { budget: { amount: budget.amount, description: budget.description } }),
        ...(lane.probability !== undefined && { probability: lane.probability }),
        ...(lane.role && { role: lane.role }),
        ...(lane.allocation !== undefined && { allocation: lane.allocation, committed: budgetCommitted(board, lane.id) }),
        ...(lane.floor !== undefined && { floor: lane.floor }),
        ...(lane.cap !== undefined && { cap: lane.cap }),
        ...(lane.station && {
          outcome: lane.station.outcome,
          next: lane.station.next,
          position: { column: lane.station.column, row: lane.station.row },
          ...(lane.station.image && { image: { src: lane.station.image.src, alt: lane.station.image.alt } }),
        }),
      }
    }),
    cards: board.cards.map((card) => ({
      id: card.id,
      label: card.label,
      laneId: card.laneId,
      ...(card.allowedLaneIds && { allowedLaneIds: card.allowedLaneIds }),
      // The canvas asks the same question before a drag (workshopCandidate).
      legalLaneIds: workshopDestinations(board, card.id)
        .filter((lane) => lane.id !== card.laneId)
        .map((lane) => lane.id),
      ...(release && { points: card.points ?? 1, dependsOn: card.dependsOn ?? [] }),
      ...(times && { duration: card.duration, lag: card.lag ?? 0, dependsOn: card.dependsOn ?? [],
        start: times.get(card.id).start, end: times.get(card.id).end, slack: times.get(card.id).slack, critical: times.get(card.id).critical,
        ...(board.clock && { from: times.get(card.id).from, to: times.get(card.id).to }), ...(card.band && { band: card.band }) }),
      ...(card.amount !== undefined && { amount: card.amount }),
      // A nested board: the card it sits under, what it is, its place among its siblings, who said it, its numbers.
      ...(card.parentId && { parentId: card.parentId }), ...(card.role && { role: card.role }), ...(card.order && { order: card.order }),
      ...(card.source && { source: card.source }), ...(card.fields && { fields: card.fields }),
      // Goals & owners: the team that owns it.
      ...(card.owner && { owner: card.owner }),
    })),
    // The lines joined to its cards: to other cards, or to ordinary notes of the slate (by note id),
    // or ending free at a point on the canvas (toPoint).
    lines: (board.lines ?? []).map((line) => ({
      id: line.id,
      fromId: line.parentId,
      ...(line.targetPoint ? { toPoint: { x: line.targetPoint.x, y: line.targetPoint.y } } : { toId: line.childId }),
      ...(line.label && { label: line.label }),
    })),
    ...(board.nest && { nest: board.nest }),
    outcomes: resolveWorkshopSignals(board),
    // One scene per lane or step, in presentation order, as the Present view steps through them.
    scenes: scenes.map((scene) => ({
      laneId: scene.lane.id,
      label: scene.lane.label,
      caption: workshopLaneCaption(board, scene.lane.id),
      cardIds: scene.cards.map((card) => card.id),
      outcomeIds: scene.signals.map((signal) => signal.id),
      nodeIds: scene.nodeIds,
    })),
    // Someone presenting the slate to everyone: the viewpoint of their presentation everyone is on.
    livePresentation: liveStep(slate, now),
    ...(operations && { operations }),
    ...(edits && { edits }),
  }
}
