// Personal tiles on the start page (/new, under "Yours"): what each use-case interview there ended
// with, kept so the person can make the same slate again. The person's own, for themselves only: a
// signed-in person or a guest (whose tiles stay theirs when they save the account), in the app.
// No token reaches them: they are the start page's, as the interview that makes them is.
//   start.tiles.list      the person's tiles, most recently used first
//   start.tiles.rename    a new name
//   start.tiles.remove    gone (the boards it kept stay in their library)
//   start.tiles.build     the first build drafts each board (metered, one build however many boards);
//                         after that, "Make another": a new slate from the kept boards, no model
//   start.tiles.rebuild   "Make a fresh version": every board drafted again from the interview
// The work is server/start/tiles-core.mjs (deps.startTiles); the rules imports/api/common/personal-tiles.mjs.
import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { TILE_ICON_IDS, BOARD_KINDS } from '../../imports/api/common/start-interview.mjs'
import { TILE_ID_PATTERN, TILE_LIMITS } from '../../imports/api/common/personal-tiles.mjs'

// Calls per session, per minute (DDPRateLimiter in server/start/meteor.js); build and rebuild are
// also AI methods (metering/limits.mjs).
export const TILE_RATE_LIMITS = Object.freeze({
  'start.tiles.list': 30,
  'start.tiles.rename': 20,
  'start.tiles.remove': 20,
  'start.tiles.build': 6,
  'start.tiles.rebuild': 3,
})

const serviceOf = (deps) => {
  if (!deps.startTiles) throw problem(501, 'not_available', 'Tiles are not available on this server.')
  return deps.startTiles
}

const tileIdInput = { type: 'string', pattern: TILE_ID_PATTERN, description: 'The tile, as start.tiles.list gives it (tiles[].id).' }
const tileSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    blurb: { type: 'string' },
    icon: { type: 'string', enum: [...TILE_ICON_IDS] },
    boards: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: [...BOARD_KINDS] }, why: { type: 'string' } } } },
    built: { type: ['object', 'null'], properties: { boards: { type: 'integer' }, at: { type: ['string', 'null'] } }, description: 'Once built: how many boards it keeps (Make another opens them again).' },
    createdAt: { type: ['string', 'null'] },
    usedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'title', 'blurb', 'icon', 'boards', 'built', 'createdAt', 'usedAt'],
}
const tileInput = { type: 'object', properties: { tileId: tileIdInput }, required: ['tileId'], additionalProperties: false }
const builtOutput = {
  type: 'object',
  properties: {
    tileId: { type: 'string' },
    title: { type: 'string' },
    shareId: { type: 'string', description: 'The new private slate it opened on.' },
    boards: { type: 'integer' },
    repeat: { type: 'boolean', description: 'true: made again from the kept boards, with no model.' },
    fresh: { type: 'boolean' },
  },
  required: ['tileId', 'title', 'shareId', 'boards', 'repeat', 'fresh'],
}
const app = ['person', 'guest']

const list = defineAction({
  id: 'start.tiles.list',
  title: 'Your tiles on the start page',
  description: `The tiles your talks on the start page made (at most ${TILE_LIMITS.perPerson}), most recently used first. Only you see them.`,
  toolset: 'account',
  kind: 'read',
  scope: 'profile:read',
  principals: app,
  mounts: { ddp: true },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: { type: 'object', properties: { tiles: { type: 'array', items: tileSchema }, max: { type: 'integer' } }, required: ['tiles', 'max'] },
  handler: (principal, _input, { deps }) => serviceOf(deps).list(principal),
})

const rename = defineAction({
  id: 'start.tiles.rename',
  title: 'Rename a tile',
  description: `A new name for one of your tiles, 1 to ${TILE_LIMITS.title} characters.`,
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: app,
  mounts: { ddp: true },
  successStatus: 200,
  input: { type: 'object', properties: { tileId: tileIdInput, title: { type: 'string', minLength: 1, maxLength: TILE_LIMITS.title + 40 } }, required: ['tileId', 'title'], additionalProperties: false },
  output: tileSchema,
  failure: { code: 'tile_failed', message: 'That could not be changed. Retry.' },
  handler: (principal, input, { deps }) => serviceOf(deps).rename(principal, input),
})

const remove = defineAction({
  id: 'start.tiles.remove',
  title: 'Remove a tile',
  description: 'Removes one of your tiles. The boards it made stay in your library and on your slates.',
  toolset: 'account',
  kind: 'write',
  changesNoSlate: true,
  scope: 'profile:write',
  principals: app,
  mounts: { ddp: true },
  successStatus: 200,
  input: tileInput,
  output: { type: 'object', properties: { tileId: { type: 'string' }, removed: { const: true } }, required: ['tileId', 'removed'] },
  failure: { code: 'tile_failed', message: 'That could not be changed. Retry.' },
  handler: (principal, input, { deps }) => serviceOf(deps).remove(principal, input),
})

const build = defineAction({
  id: 'start.tiles.build',
  title: 'Make a slate from a tile',
  description: 'The first time, the agent drafts each of the tile\'s boards (one metered build), keeps them as your private library drafts and opens them together on a new private slate. After that, Make another: a new slate from the kept boards, at once, with no model.',
  toolset: 'account',
  kind: 'write',
  scope: 'profile:write',
  alsoScopes: ['slates:write'],
  principals: app,
  mounts: { ddp: true },
  input: tileInput,
  output: builtOutput,
  failure: { code: 'build_failed', message: 'That could not be built just now. Try again.' },
  handler: (principal, input, { deps }) => serviceOf(deps).build(principal, input),
})

const rebuild = defineAction({
  id: 'start.tiles.rebuild',
  title: 'Make a fresh version of a tile',
  description: 'The agent drafts every board of the tile again from the talk it came from (one metered build), keeps the new boards for Make another, and opens them on a new private slate.',
  toolset: 'account',
  kind: 'write',
  scope: 'profile:write',
  alsoScopes: ['slates:write'],
  principals: app,
  mounts: { ddp: true },
  input: tileInput,
  output: builtOutput,
  failure: { code: 'build_failed', message: 'That could not be built just now. Try again.' },
  handler: (principal, input, { deps }) => serviceOf(deps).rebuild(principal, input),
})

export default [list, rename, remove, build, rebuild]
