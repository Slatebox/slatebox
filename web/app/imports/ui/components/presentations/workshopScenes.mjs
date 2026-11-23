import { workshopPresentationScenes } from 'slateboxjs/workshops/model'

const MAIN = 'main'
const isWorkshop = (record) => record?.model?.kind === 'workshop' && record.model.workshop

/**
 * A slate's boards as the presenter takes them, from its live board records (the first board's,
 * then the further ones', each `{ boardId, model }`): one workshop when the slate holds one board
 * (as it always was), else `[{ id, workshop }]` in the order the boards were added. → null for none.
 */
export function presentedBoards(main, further = []) {
  const rest = (further || []).filter((record) => typeof record?.boardId === 'string' && record.boardId !== MAIN && isWorkshop(record))
    .sort((a, b) => Number(a.boardId.slice(1)) - Number(b.boardId.slice(1)))
  if (!rest.length) return isWorkshop(main) ? main.model.workshop : null
  return [...(isWorkshop(main) ? [{ id: MAIN, workshop: main.model.workshop }] : []), ...rest.map((record) => ({ id: record.boardId, workshop: record.model.workshop }))]
}

/** A board list from either shape: one workshop, or `[{ id, workshop }]`. */
const boardsOf = (workshop) => (Array.isArray(workshop) ? workshop.filter((board) => board?.workshop) : workshop ? [{ id: MAIN, workshop }] : [])

/** What changes a board's scenes (its order, lanes and cards), for every board. */
export function workshopScenesKey(workshop) {
  const boards = boardsOf(workshop)
  return boards.length ? JSON.stringify(boards.map(({ id, workshop: w }) => [id, w.presentationOrder ?? null, (w.lanes || []).map((lane) => lane.id), (w.cards || []).map((card) => [card.id, card.laneId])])) : ''
}

/**
 * A slate's workshop as the viewpoints that open its presentation: each lane, in the authored
 * presentation order, framed with its picture and its cards. The narrative is the lane's name,
 * and its outcome when the outcome says more than the name. `label` is the lane's name: a lane's
 * viewpoint in any plan starts with it, so viewers know where they are. On a slate of many boards
 * (`[{ id, workshop }]`) every board's lanes play, board by board, each named in its own scope.
 */
export function workshopScenes(workshop) {
  return boardsOf(workshop).flatMap(({ id, workshop: board }) => {
    let scenes
    try { scenes = workshopPresentationScenes(board, id === MAIN ? {} : { scope: id }) } catch { return [] }
    return scenes.map(({ lane, nodeIds }) => {
      const outcome = String(lane.station?.outcome ?? '').trim()
      return { nodeIds, label: lane.label, narrative: outcome && outcome !== lane.label ? `${lane.label} — ${outcome}` : lane.label }
    })
  })
}
