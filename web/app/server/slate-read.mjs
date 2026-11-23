// readSlate: the one read of a slate, for every surface that reads one (GET /api/v1/slates/{id},
// and through it the MCP get_slate tool and `slatebox read`). The canvas part is the engine's
// readSlate (slateboxjs/operations), built from the write contract's key tables, so an agent
// reads every key it can write. Around it: who may do what here, where the slate lives, its
// comments, its conversation and, on a workshop, the workshop read.
//
// An agent reads what a person in the same role sees, and nothing more: the share link's role
// is the owner's (the Share dialog is), and the
// stored row never leaves (include=full returns the engine's document, without visibility
// flags, access keys or comment markers).
import { backgroundOf, readSlate as readCanvas, toSlateDocument } from 'slateboxjs/operations'
import { slatePreview } from '../imports/api/common/slate-preview.mjs'
import { canvasStarters } from '../imports/api/common/native-canvas-conversation.mjs'
import { workshopStarters } from '../imports/api/common/workshop-starters.mjs'
import { boardCan } from '../imports/api/common/library.mjs'
import { slateVisibility } from './methods/slate-role.mjs'
import { summarizeWorkshop } from './workshop-operation-api.mjs'
import { MAIN_BOARD, boardSummary, slateAsBoard, slateBoards } from '../imports/api/common/slate-boards.mjs'
import { boardEmbed } from '../imports/api/common/slate-embed.mjs'

const LIST = /^[^,]+(,[^,]+)*$/
export const SELECTION_INPUT = {
  fields: {
    type: 'string',
    pattern: LIST.source,
    description:
      'Comma-separated note keys to return (id always comes): any key a write sets, and image and comments.',
  },
  ids: { type: 'string', pattern: LIST.source, description: 'Comma-separated note IDs: only these notes.' },
  within: {
    type: 'string',
    pattern: '^-?[0-9.]+,-?[0-9.]+,[0-9.]+,[0-9.]+$',
    description: 'x,y,width,height: only notes lying wholly inside this rectangle.',
  },
  groupId: { type: 'string', minLength: 1, description: 'Only the notes of this group.' },
  q: {
    type: 'string',
    minLength: 1,
    maxLength: 10000,
    description:
      'Notes whose whole text is this, ignoring case and extra spaces: the notes a write naming this text would change.',
  },
  match: { type: 'string', enum: ['exact', 'contains'], description: 'With q: contains searches inside the text.' },
  limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Notes per page (default 100). A page also stops at a size ceiling.' },
  cursor: { type: 'string', minLength: 1, maxLength: 2000, description: 'nextCursor from the page before.' },
}

const list = (value) => (value === undefined ? undefined : value.split(',').map((item) => item.trim()))

/** The engine's selection from the HTTP input; `comments` is the app's own note field. */
export function selectionFrom(input) {
  const fields = list(input.fields)
  const within = input.within === undefined ? undefined : input.within.split(',').map(Number)
  return {
    wantComments: !fields || fields.includes('comments'),
    selection: {
      ...(fields && { fields: fields.filter((field) => field !== 'comments') }),
      ...(input.ids !== undefined && { ids: list(input.ids) }),
      ...(within && { within: { x: within[0], y: within[1], width: within[2], height: within[3] } }),
      ...(input.groupId !== undefined && { groupId: input.groupId }),
      ...(input.q !== undefined && { q: input.q }),
      ...(input.match !== undefined && { match: input.match }),
      ...(input.limit !== undefined && { limit: input.limit }),
      ...(input.cursor !== undefined && { cursor: input.cursor }),
    },
  }
}

const isWorkshop = (slate) => slate.creative?.model?.kind === 'workshop'

// The address a reader opens the slate at: the slate's own address for its owner and on a
// public slate, the reader's own invitation otherwise (the users.getSlateAccessUrl rule).
function addressFor(slate, access, origin) {
  const key = !access.isOwner && slateVisibility(slate) !== 'public' && access.grantKey ? access.grantKey : slate.shareId
  return new URL('/canvas/' + key, origin).href
}

/**
 * stores: listComments(slateOptionsId) -> [{nodeId, resolved}], findPresentation(selector) -> row,
 * appOrigin() and embedOrigin() -> origins, now() -> ms.
 */
export function createSlateReader({ listComments, findPresentation, appOrigin, embedOrigin, now = Date.now }) {
  async function commentCounts(slate) {
    const rows = slate.options?.id ? await listComments(slate.options.id) : []
    const byNote = new Map()
    let unresolved = 0
    for (const row of rows) {
      const counts = byNote.get(row.nodeId) ?? { count: 0, unresolved: 0 }
      counts.count += 1
      if (!row.resolved) {
        counts.unresolved += 1
        unresolved += 1
      }
      byNote.set(row.nodeId, counts)
    }
    return { byNote, total: { count: rows.length, unresolved } }
  }

  // The published picture of a slate (a slate with a workshop included), which the embed address serves.
  async function canvasEmbed(slate) {
    const row = await findPresentation({ slateShareId: slate.shareId, isPublished: true })
    if (!row) return null
    return boardEmbed(embedOrigin(), slate.shareId)
  }

  /**
   * slate: the stored row. access: {role, canEdit, isOwner, linkRole, grantKey} from the token
   * service (role null for a visitor's read of a public slate reads as READ).
   */
  return async function readSlate(slate, access, input = {}) {
    const { selection, wantComments } = selectionFrom(input)
    const workshop = isWorkshop(slate)
    // A workshop's lanes and cards are drawn as notes beside the slate's own; read them where
    // the canvas draws them.
    const canvas = readCanvas(workshop ? slatePreview(slate) : slate, selection)
    const comments = await commentCounts(slate)
    const nodes = wantComments
      ? canvas.nodes.map((node) => ({ ...node, comments: comments.byNote.get(node.id) ?? { count: 0, unresolved: 0 } }))
      : canvas.nodes
    const role = access.role ?? 'READ'
    const conversationAvailable = access.canEdit && (!slate.creative || Boolean(slate.nativeCanvasDrawing))
    const body = {
      shareId: slate.shareId,
      revision: slate.revision ?? 0,
      name: canvas.name,
      description: canvas.description,
      url: addressFor(slate, access, appOrigin()),
      embed: await canvasEmbed(slate),
      access: {
        visibility: slateVisibility(slate),
        yourRole: role,
        isOwner: access.isOwner === true,
        canEdit: access.canEdit === true,
        ...(access.isOwner && { linkRole: access.linkRole ?? null }),
      },
      brief: slate.options?.creationBrief || null,
      background: backgroundOf(slate.options?.containerStyle),
      bounds: canvas.bounds,
      nodeCount: canvas.nodeCount,
      nodes,
      connections: canvas.connections,
      nextCursor: canvas.nextCursor,
      comments: comments.total,
      conversation: {
        available: workshop ? access.canEdit === true : conversationAvailable,
        // A row whose notes are not a list reads as a slate with none, as the engine reads it.
        starters: workshop ? [] : canvasStarters(Array.isArray(slate.nodes) ? slate.nodes : []),
      },
    }
    if (workshop) {
      try {
        body.workshop = summarizeWorkshop(slate, { now: now() })
      } catch {
        throw Object.assign(new Error('This saved workshop could not be read.'), { status: 422, code: 'invalid_workshop' })
      }
      // summarizeWorkshop has validated the model.
      body.conversation.starters = workshopStarters(slate.creative.model.workshop)
      // What this board takes, in plain words, each with a phrase that does it (the gear's "What else
      // can this board do?"): for an agent changing the board as a person in focus on it would.
      body.workshop = { ...body.workshop, can: boardCan(slate.creative.model.workshop) }
      // Every board on the slate (main first), each read as workshop is: what a workshop operation names by boardId.
      body.boards = slateBoards(slate).map((board) => {
        const view = slateAsBoard(slate, board.id)
        let read
        try { read = board.id === MAIN_BOARD ? body.workshop : { ...summarizeWorkshop(view, { now: now() }), can: boardCan(board.model.workshop) } }
        catch { return { ...boardSummary(board), origin: board.origin, revision: board.revision ?? 0, unreadable: true } }
        return { ...boardSummary(board), origin: board.origin, ...read, revision: board.revision ?? 0 }
      })
    }
    if (input.include === 'full') body.document = toSlateDocument(slate)
    return body
  }
}
