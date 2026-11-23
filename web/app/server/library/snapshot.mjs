// What a library version holds, made on the server from stored rows (never from a browser): a
// slate's content without anything that belongs to its author's copy, a deck's look, and a board.
// Pure: tested in scripts/library-snapshot.test.mjs.
import { createHash } from 'node:crypto'
import { sourceOnly, sourceOnlyOptions } from '../actions/slate-copy.mjs'
import { canonicalJson, scrubSecrets, SLATE_FLAGS, OPTION_FLAGS } from '../team-export/format.mjs'
import { LIBRARY_LIMITS, libraryError } from '../../imports/api/common/library-model.mjs'

// Beyond what a copy leaves behind (slate-copy.mjs): the people and conversations on the slate,
// its library fields, an import's bookkeeping and the directory flags.
const PRIVATE_FIELDS = ['comments', 'collaborators', 'chatHistory', 'aiHistory', 'messages', 'conversation', 'nativeConversation',
  'library', 'libraryOrigin', 'teamImportId', 'importedVisibility', 'importedFrom', 'boardSeq', 'guestEditKey', 'invitationLease']
const PRIVATE_OPTIONS = ['isPrivate', 'isPublic', 'isUnlisted', 'isTemplate', 'templateApproved', 'templateMarkdown', 'templateTags',
  'tags', 'basedOnTemplate', 'templateName', 'userNameOverride', 'eligibleForThemeCompilation', 'id']
// The fields of a published deck the player needs (PresentPublishedSlate), never who made it or its links.
const DECK_FIELDS = ['name', 'description', 'showNarrative', 'viewpoints', 'direction', 'style', 'presentationData', 'slateJSON', 'playOnHover', 'autoplayOnPublish']

function stripBoard(record) {
  if (!record || typeof record !== 'object') return record
  const board = { ...record }
  delete board.undo
  delete board.trades
  if ('revision' in board) board.revision = 0
  return board
}

/** A slate's content for the library: what a copy keeps, less everything private (the list above). */
export function snapshotSlate(row) {
  if (!row || typeof row !== 'object') throw libraryError(404, 'not_found', 'Slate not found or unavailable.')
  const copy = structuredClone(row)
  for (const key of [...sourceOnly, ...PRIVATE_FIELDS, ...SLATE_FLAGS]) delete copy[key]
  for (const key of Object.keys(copy)) if (key.startsWith('lastSaved')) delete copy[key]
  copy.options = { ...(copy.options || {}) }
  for (const key of [...sourceOnlyOptions, ...PRIVATE_OPTIONS, ...OPTION_FLAGS]) delete copy.options[key]
  for (const key of Object.keys(copy.options)) if (key.startsWith('lastSaved')) delete copy.options[key]
  copy.nodes = Array.isArray(copy.nodes) ? copy.nodes : []
  if (copy.creative && typeof copy.creative === 'object') copy.creative = stripBoard(copy.creative)
  if (copy.boards && typeof copy.boards === 'object') {
    copy.boards = Object.fromEntries(Object.entries(copy.boards).map(([id, record]) => [id, stripBoard(record)]))
  }
  if (copy.boardsRevision !== undefined) copy.boardsRevision = 0
  return scrubSecrets(copy)
}

/** A deck's look as a library version keeps it: from a stored presentation row. */
export function snapshotDeck(row) {
  if (!row || typeof row !== 'object') return null
  const deck = {}
  for (const key of DECK_FIELDS) if (row[key] !== undefined) deck[key] = structuredClone(row[key])
  return scrubSecrets(deck)
}

/** A board's workshop for a component version: without its Undo records or trades. */
export function snapshotWorkshop(workshop) {
  if (!workshop || typeof workshop !== 'object') throw libraryError(409, 'no_board', 'There is no board to save yet. Make one by chat first.')
  return scrubSecrets(structuredClone(workshop))
}

export const contentHash = (content) => createHash('sha256').update(canonicalJson(content)).digest('hex')
export const contentSize = (content) => Buffer.byteLength(JSON.stringify(content ?? null), 'utf8')

/** Checks a version's size: at most 1,000,000 bytes. Answers its size. */
export function checkSize(content) {
  const size = contentSize(content)
  if (size > LIBRARY_LIMITS.versionBytes)
    throw libraryError(413, 'too_large', 'This is too large for the library (over 1 MB). Remove some notes or pictures and try again.')
  return size
}
