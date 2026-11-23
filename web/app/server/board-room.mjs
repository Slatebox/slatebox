// The room a board keeps on a slate of many boards (the engine's workshopReserve): five lanes for a
// board of lanes, its kit's desktop width for a launch plan, hiring plan, pipeline, budget or nested
// board. Server only: it loads the kits, which the page fetches only for a slate that holds such a board.
import 'slateboxjs/workshops/behaviour'
import 'slateboxjs/workshops/rules'
import { workshopReserve } from 'slateboxjs/workshops/model'
import { kitFor } from 'slateboxjs/boards'
import 'slateboxjs/boards/nest'

const BUSINESS = new Set(['launch-plan', 'hiring-plan', 'pipeline', 'budget', 'nest'])

export const boardRoom = workshop => workshopReserve(workshop, {}, BUSINESS.has(workshop?.kind) ? kitFor(workshop.kind) : undefined)
