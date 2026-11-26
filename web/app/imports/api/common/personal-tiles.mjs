// Personal tiles: what a use-case interview on the start page (start-interview.mjs) ends with, kept
// as the person's own tile on /new under "Yours", so they can make the same slate again: "Make
// another" opens a new slate from the boards the first build kept (no model), "Make a fresh
// version" drafts the boards again from the interview. Only the person sees their tiles; a guest's
// tiles are their guest account's, and stay theirs when they save the account (the same account).
//
// One row of personalTiles per tile:
//   { _id, userId, title, blurb, icon, interview: { summary, turns: [{ role, text }] }, plan: { title,
//     blurb, icon, boards: [{ kind, name, brief, why }] }, built: { libraryDraftIds, at } | null, pending: { fresh, libraryDraftIds } | null, createdAt, usedAt }
// The transcript keeps nothing sensitive: a turn that holds any is kept as a note that it was left out.
// Pure rules only (no Meteor): the bounds, a tile made from a talk, its checks, renaming, and the tile
// as people read it. Server: server/start/tiles-core.mjs; page: imports/ui/pages/FirstSlate.jsx.
import { tidyText } from './personal-facts.mjs'
import { sensitive } from './interview.mjs'
import { BOARD_KINDS, DEFAULT_TILE_ICON, START_LIMITS, StartError, TILE_ICON_IDS, planSensitive, readPlan } from './start-interview.mjs'

export const TILE_LIMITS = Object.freeze({
  // tiles one person keeps: past it a new plan is refused until they remove one
  perPerson: 24,
  title: START_LIMITS.title,
  blurb: START_LIMITS.blurb,
  summary: START_LIMITS.summary,
  // the transcript kept with a tile: the last turns of the talk, text only
  turns: 20,
  turnText: START_LIMITS.message,
  boards: START_LIMITS.boards,
})

export const TILE_ID_PATTERN = '^[A-Za-z0-9]{1,24}$'
const TILE_ID = new RegExp(TILE_ID_PATTERN)
export const validTileId = (id) => typeof id === 'string' && TILE_ID.test(id)

export const TILE_WORDS = Object.freeze({
  full: `You keep ${TILE_LIMITS.perPerson} of your own tiles, the most for now. Remove one to keep this plan.`,
  notFound: 'That tile is no longer here.',
  title: `Name it in 1 to ${TILE_LIMITS.title} characters.`,
  sensitive: 'That looks private, so it was not kept.',
  busy: 'Slatebox is still building. Try again in a moment.',
  buildFailed: 'That could not be built just now. Try again.',
  weakDraft: 'One of the boards did not come out well. The boards that did are kept, so trying again drafts only the rest.',
  revised: 'That plan was built already, so it stays as it is. Start a new talk to plan something else.',
  draftsGone: 'The boards this tile kept are no longer in your library. Make a fresh version instead.',
  buildOff: 'Building boards is off on this server. An administrator can turn it on.',
  guestUsedUp: 'You have used today’s free builds on the start page. Save your account to keep going, or come back tomorrow.',
})

/** What a kept turn says in place of words that looked private (a password, their own pay, their health). */
export const LEFT_OUT_TURN = 'Left out: it looked private.'

/** The kept transcript: the last TILE_LIMITS.turns turns, text only, each bounded, nothing sensitive (interview.mjs sensitive). */
export function keptTurns(turns) {
  return (Array.isArray(turns) ? turns : [])
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim())
    .slice(-TILE_LIMITS.turns)
    .map((turn) => {
      const text = turn.content.trim()
      return { role: turn.role, text: sensitive(text) ? LEFT_OUT_TURN : text.slice(0, TILE_LIMITS.turnText) }
    })
}

/**
 * Whether a stored tile is one this code reads: its fields, kinds and bounds, and nothing sensitive.
 * Throws StartError('invalid-tile') naming the first problem. → the tile
 */
export function checkTile(tile) {
  const fail = (why) => { throw new StartError('invalid-tile', why) }
  if (!tile || typeof tile !== 'object') fail('A tile is an object.')
  if (!validTileId(tile._id)) fail('A tile has an id.')
  if (typeof tile.userId !== 'string' || !tile.userId) fail('A tile belongs to one person.')
  if (!tidyText(tile.title, TILE_LIMITS.title) || tile.title.length > TILE_LIMITS.title) fail('A tile has a title.')
  if (!tidyText(tile.blurb, TILE_LIMITS.blurb) || tile.blurb.length > TILE_LIMITS.blurb) fail('A tile has a blurb.')
  if (!TILE_ICON_IDS.includes(tile.icon)) fail('A tile has an icon from the start page.')
  const boards = tile.plan?.boards
  if (!Array.isArray(boards) || !boards.length || boards.length > TILE_LIMITS.boards) fail(`A tile's plan has 1 to ${TILE_LIMITS.boards} boards.`)
  if (boards.some((board) => !BOARD_KINDS.includes(board?.kind) || typeof board.name !== 'string' || !board.name.trim() || board.name.length > START_LIMITS.boardName || typeof board.brief !== 'string' || typeof board.why !== 'string')) fail('Each board has a kind, a name, a brief and a why.')
  const turns = tile.interview?.turns
  if (typeof tile.interview?.summary !== 'string' || tile.interview.summary.length > TILE_LIMITS.summary) fail('A tile keeps the interview\'s summary.')
  if (!Array.isArray(turns) || turns.length > TILE_LIMITS.turns || turns.some((turn) => !['user', 'assistant'].includes(turn?.role) || typeof turn.text !== 'string' || turn.text.length > TILE_LIMITS.turnText)) fail(`A tile keeps at most ${TILE_LIMITS.turns} turns of text.`)
  const built = tile.built
  if (built !== null && built !== undefined && (!Array.isArray(built.libraryDraftIds) || built.libraryDraftIds.length > TILE_LIMITS.boards || built.libraryDraftIds.some((id) => typeof id !== 'string'))) fail('A built tile names its library drafts.')
  // the plan's words as readPlan reads them (a group's numbers are the group's); the transcript by the shared check
  if ([tile.title, tile.blurb, tile.interview.summary, ...boards.flatMap((board) => [board.name, board.brief, board.why])].some((text) => planSensitive(text))) fail(TILE_WORDS.sensitive)
  if (turns.some((turn) => turn.text !== LEFT_OUT_TURN && sensitive(turn.text))) fail(TILE_WORDS.sensitive)
  return tile
}

/**
 * The tile a talk's plan makes (checked again here: what readPlan accepts is all a tile holds).
 * `turns`: the talk's transcript ([{ role, content }]). → the row to store
 */
export function tileFromTalk({ id, userId, plan, summary, turns = [], now = Date.now() }) {
  const read = readPlan({ ...plan, summary })
  if (!read.plan) throw new StartError('invalid-plan', read.problems.join(' '))
  const at = new Date(now)
  return checkTile({
    _id: id,
    userId,
    title: read.plan.title,
    blurb: read.plan.blurb,
    icon: read.plan.icon || DEFAULT_TILE_ICON,
    interview: { summary: read.summary, turns: keptTurns(turns) },
    plan: read.plan,
    built: null,
    // the boards a build drafted before it stopped part way (tiles-core.mjs): none yet
    pending: null,
    createdAt: at,
    usedAt: null,
  })
}

/**
 * A tile revised in the same talk (the person changed the plan before building it): the new plan, summary
 * and transcript on the same tile, its name, id and dates kept. → the row to store
 */
export function revisedTile(tile, { plan, summary, turns = [] }) {
  const read = readPlan({ ...plan, summary })
  if (!read.plan) throw new StartError('invalid-plan', read.problems.join(' '))
  return checkTile({ ...tile, title: read.plan.title, blurb: read.plan.blurb, icon: read.plan.icon || DEFAULT_TILE_ICON, interview: { summary: read.summary, turns: keptTurns(turns) }, plan: read.plan })
}

/** A new name for a tile, checked: one line, 1 to TILE_LIMITS.title characters, nothing sensitive. */
export function tileTitle(value) {
  const title = tidyText(value, TILE_LIMITS.title + 1)
  if (!title || title.length > TILE_LIMITS.title) throw new StartError('invalid-title', TILE_WORDS.title)
  if (planSensitive(title)) throw new StartError('invalid-title', TILE_WORDS.sensitive)
  return title
}

const iso = (value) => (value ? new Date(value).toISOString() : null)

/** A tile as its person reads it: never the transcript, never another person's id. */
export function publicTile(tile) {
  return {
    id: tile._id,
    title: tile.title,
    blurb: tile.blurb,
    icon: tile.icon,
    boards: tile.plan.boards.map(({ kind, name, why }) => ({ kind, name, why })),
    built: tile.built?.libraryDraftIds?.length ? { boards: tile.built.libraryDraftIds.length, at: iso(tile.built.at) } : null,
    createdAt: iso(tile.createdAt),
    usedAt: iso(tile.usedAt),
  }
}

/** Tiles in the order /new shows them: the most recently used or made first. */
export const sortTiles = (tiles) => [...tiles].sort((a, b) => (new Date(b.usedAt || b.createdAt) - new Date(a.usedAt || a.createdAt)) || String(a._id).localeCompare(String(b._id)))

/** What a tile's card says it makes, by its boards' names: "Makes Draft board and Weekly lineup". */
export function tileMakesLine(tile) {
  const boards = tile?.boards || tile?.plan?.boards || []
  const names = boards.map((board) => (typeof board.name === 'string' && board.name.trim() ? board.name.trim() : board.kind === 'grid' ? 'a printable page' : 'a smart component'))
  if (!names.length) return ''
  if (names.length === 1) return `Makes ${names[0]}`
  return `Makes ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** What the page says while a tile builds, and on its buttons. */
export function tileBuildWords(tile, { fresh = false, repeat = false } = {}) {
  if (repeat) return { progress: `Opening a new ${tile.title}…`, button: `Make another: ${tile.title}` }
  // a build drafts each board in turn: the page names them, and says it can take a while
  const boards = (tile?.boards || tile?.plan?.boards || []).length
  const making = boards > 1 ? ` ${tileMakesLine(tile).replace(/^Makes /, 'Drafting ')}, one after another. This can take a minute or two.` : ''
  return fresh
    ? { progress: `Slatebox is making a fresh version of ${tile.title}…${making}`, button: `Make a fresh version: ${tile.title}` }
    : { progress: `Slatebox is building ${tile.title}…${making}`, button: `Build it: ${tile.title}` }
}
