// Personal tiles, without Meteor (server/start/meteor.js wires the real dependencies; the tests use
// stand-ins). Each tile is one row of personalTiles (imports/api/common/personal-tiles.mjs):
//   list(principal)                  the person's own tiles, most recently used first
//   full(userId)                     whether they keep the most tiles one person keeps
//   saveFromTalk(principal, talk)    the plan a use-case interview ended with, kept as a new tile (or, with
//                                    talk.tileId, the same talk's changed plan on its own tile, before it is built)
//   revisable(principal, tileId)     throws unless that tile is theirs and not built (nor part built) yet
//   rename(principal, { tileId, title }), remove(principal, { tileId })
//   build(principal, { tileId })     the first build drafts each board; once built, "Make another":
//                                    a new slate from the kept drafts, at once, with no model
//   rebuild(principal, { tileId })   "Make a fresh version": every board drafted again from the talk
// A person reaches only their own tiles: another person's tile id answers as not found.
//
// Drafting is For you's path (workshops.js, through deps.draft): the drafting's switch and quality
// gate, each board held to buildProblems, saved as the person's private library draft (library
// saveMade, madeFor the tile), then all of them opened on one new private slate (open-slate.mjs
// openBoardsOnNewSlate). The whole build is one metered action (deps.run): a signed-in person's
// under 'personal.build' (the personalization allowance), a guest's under 'start.build' (the guest
// allowance), so one build is one use however many boards it holds. What the person keeps in About
// you reaches the drafts only when they are signed in with personalization on, and never for a guest.
// A build that stopped part way keeps the boards it drafted (pending): trying again drafts only the rest,
// and when every board is drafted already (only opening the slate failed) it opens them with no model and no meter.
import { personalizationOn } from '../../imports/api/common/personal-facts.mjs'
import { factsForIdeas } from '../../imports/api/common/personal-ideas.mjs'
import { StartError } from '../../imports/api/common/start-interview.mjs'
import { TILE_LIMITS, TILE_WORDS, publicTile, revisedTile, sortTiles, tileFromTalk, tileTitle, validTileId } from '../../imports/api/common/personal-tiles.mjs'
import { repairComponent } from '../../imports/api/common/builder-freeform.mjs'
import { buildProblems } from '../personal/core.mjs'

const fail = (status, code, message, details) => new StartError(code, message, status, details)
const notFound = () => fail(404, 'not_found', TILE_WORDS.notFound)

/**
 * deps: {
 *   tiles                     the personalTiles collection (MongoDB driver)
 *   loadUser(userId)          → { _id, isAnonymous? } | null
 *   profile                   About you's store: getSettings(userId), forPrompt(userId)
 *   newId()                   a tile's id (17 letters and digits)
 *   allowed(user)             → throws the meter's refusal for a build, or resolves (before the lock)
 *   lock(userId)              → release() | null   one build at a time per person
 *   run(user, fn)             runAIAction({ feature: 'personal.build' | 'start.build', userId }, fn)
 *   draft({ userId, brief, format, tile: { summary, name, why, facts } }) → the drafted board (workshops.js draftForTile)
 *   library                   saveMade(principal, { workshop, title, summary, madeFor: { kind: 'tile', tileId } }) → { itemId }
 *   open({ principal, itemIds, name, key }) → { shareId }   open-slate.mjs openBoardsOnNewSlate
 *   marker(userId, count)     how many tiles the person keeps, on their account (/new reads it to show the start page)
 *   now?()
 * }
 */
export function createPersonalTiles(deps) {
  const now = deps.now || Date.now
  const rows = deps.tiles

  async function person(principal) {
    const user = principal?.userId ? await deps.loadUser(principal.userId) : null
    if (!user) throw fail(403, 'sign_in', 'Open Slatebox again to see your tiles.')
    return user
  }
  async function own(principal, tileId) {
    if (!validTileId(tileId)) throw notFound()
    const tile = await rows.findOne({ _id: tileId, userId: principal.userId })
    if (!tile) throw notFound()
    return tile
  }
  const count = (userId) => rows.countDocuments({ userId })
  const mark = async (userId) => { await deps.marker(userId, await count(userId)) }

  async function list(principal) {
    await person(principal)
    const tiles = await rows.find({ userId: principal.userId }).toArray()
    return { tiles: sortTiles(tiles).map(publicTile), max: TILE_LIMITS.perPerson }
  }

  // A tile the talk may still change: theirs, and neither built nor part built (its boards are not drafted yet).
  async function revisable(principal, tileId) {
    await person(principal)
    const tile = await own(principal, tileId)
    if (tile.built?.libraryDraftIds?.length || tile.pending?.libraryDraftIds?.length) throw fail(409, 'tile_built', TILE_WORDS.revised)
    return tile
  }

  async function saveFromTalk(principal, { plan, summary, turns, tileId = null }) {
    const user = await person(principal)
    if (tileId) {
      const tile = await revisable(principal, tileId)
      let revised
      try {
        revised = revisedTile(tile, { plan, summary, turns })
      } catch (error) {
        throw fail(422, 'invalid_plan', error.message)
      }
      const { title, blurb, icon, interview, plan: kept } = revised
      // fenced on the tile still being unbuilt: a build that started meanwhile keeps the plan it read
      const out = await rows.updateOne({ _id: tile._id, userId: user._id, built: null, pending: null }, { $set: { title, blurb, icon, interview, plan: kept } })
      if (out?.matchedCount === 0) throw fail(409, 'tile_built', TILE_WORDS.revised)
      return publicTile(revised)
    }
    if (await count(user._id) >= TILE_LIMITS.perPerson) throw fail(409, 'tiles_full', TILE_WORDS.full)
    let tile
    try {
      tile = tileFromTalk({ id: deps.newId(), userId: user._id, plan, summary, turns, now: now() })
    } catch (error) {
      throw fail(422, 'invalid_plan', error.message)
    }
    await rows.insertOne(tile)
    await mark(user._id)
    return publicTile(tile)
  }

  async function rename(principal, { tileId, title }) {
    await person(principal)
    const tile = await own(principal, tileId)
    let named
    try { named = tileTitle(title) } catch (error) { throw fail(400, 'invalid_request', error.message, { field: 'title' }) }
    await rows.updateOne({ _id: tile._id, userId: principal.userId }, { $set: { title: named } })
    return publicTile({ ...tile, title: named })
  }

  async function remove(principal, { tileId }) {
    await person(principal)
    const tile = await own(principal, tileId)
    await rows.deleteOne({ _id: tile._id, userId: principal.userId })
    await mark(principal.userId)
    // The boards it kept stay in the person's library: they are their own drafts, and may be on slates.
    return { tileId: tile._id, removed: true }
  }

  // What reaches a draft from About you: signed in, personalization on, nothing sensitive. Never a guest's.
  async function factsFor(user) {
    if (user.isAnonymous) return ''
    if (!personalizationOn(await deps.profile.getSettings(user._id))) return ''
    return factsForIdeas((await deps.profile.forPrompt(user._id)) || '')
  }

  const used = (tile, patch) => rows.updateOne({ _id: tile._id, userId: tile.userId }, { $set: { usedAt: new Date(now()), ...patch } })

  // Opens the kept drafts on a new slate: a repeat build, or the end of a first or fresh one.
  async function open(principal, tile, itemIds, nonce) {
    try {
      return await deps.open({ principal, itemIds, name: tile.title, key: `tile-${tile._id}-${nonce}` })
    } catch (error) {
      // a draft the person discarded from their library since
      if (error?.status === 404 || error?.code === 'not_found') throw fail(409, 'drafts_gone', TILE_WORDS.draftsGone)
      throw error
    }
  }

  // The first build, or a fresh version: every board drafted, gated, saved as a private library draft.
  async function draftAll(principal, user, tile, { fresh }) {
    // Drafted and saved already in an earlier try that stopped part way (a later board did not come out
    // well, or the slate did not open): those boards are kept, and only the rest are drafted (and metered) again.
    const pending = tile.pending?.fresh === fresh && Array.isArray(tile.pending.libraryDraftIds) ? tile.pending.libraryDraftIds.slice(0, tile.plan.boards.length) : []
    // Every board is drafted already: only the slate is left to open, so no model is asked and no use is taken.
    const drafted = pending.length === tile.plan.boards.length
    if (!drafted) await deps.allowed(user)
    const release = await deps.lock(user._id)
    if (!release) throw fail(409, 'busy', TILE_WORDS.busy)
    try {
      const itemIds = drafted ? pending : await deps.run(user, async () => {
        const facts = await factsFor(user)
        const ids = [...pending]
        for (const [index, board] of tile.plan.boards.entries()) {
          if (index < ids.length) continue
          const workshop = await deps.draft({ userId: user._id, brief: board.brief, format: board.kind, tile: { summary: tile.interview.summary, name: board.name, why: board.why, facts } })
          const problems = buildProblems(workshop, board.kind, board.brief)
          // the gate's words are written for the agent: the person reads plain ones, the detail stays in details
          if (problems.length) throw fail(422, 'weak_draft', TILE_WORDS.weakDraft, { problems, board: index })
          const made = board.kind === 'grid' ? workshop : repairComponent(workshop, { message: board.brief }).workshop
          // the board is called what the plan called it (what the person saw), so the slate's boards read as the plan did
          const title = String(board.name || '').trim() || String(made.title || '').trim() || `${tile.title} ${index + 1}`
          const saved = await deps.library.saveMade(principal, { workshop: { ...made, title }, title, summary: board.why, madeFor: { kind: 'tile', tileId: tile._id } })
          ids.push(saved.itemId)
          await rows.updateOne({ _id: tile._id, userId: tile.userId }, { $set: { pending: { fresh, libraryDraftIds: [...ids] } } })
        }
        return ids
      })
      let opened
      try {
        opened = await open(principal, tile, itemIds, itemIds.join('-'))
      } catch (error) {
        // a kept draft is gone from their library: the next try drafts every board again rather than failing the same way
        if (error?.code === 'drafts_gone') await rows.updateOne({ _id: tile._id, userId: tile.userId }, { $set: { pending: null } })
        throw error
      }
      const built = { libraryDraftIds: itemIds, at: new Date(now()) }
      await rows.updateOne({ _id: tile._id, userId: tile.userId }, { $set: { built, usedAt: new Date(now()), pending: null } })
      return { tileId: tile._id, title: tile.title, shareId: opened.shareId, boards: itemIds.length, repeat: false, fresh }
    } finally {
      await release()
    }
  }

  async function build(principal, { tileId }) {
    const user = await person(principal)
    const tile = await own(principal, tileId)
    const kept = tile.built?.libraryDraftIds
    if (!kept?.length) return draftAll(principal, user, tile, { fresh: false })
    // Make another: the kept drafts on a new slate, at once. No model, no meter.
    const opened = await open(principal, tile, kept, deps.newId())
    await used(tile)
    return { tileId: tile._id, title: tile.title, shareId: opened.shareId, boards: kept.length, repeat: true, fresh: false }
  }

  async function rebuild(principal, { tileId }) {
    const user = await person(principal)
    const tile = await own(principal, tileId)
    return draftAll(principal, user, tile, { fresh: true })
  }

  return { list, full: async (userId) => (await count(userId)) >= TILE_LIMITS.perPerson, revisable, saveFromTalk, rename, remove, build, rebuild }
}

/** The account is going: its tiles too (server/profile/store.mjs removeAll calls this through its `tiles`). */
export const removeTiles = (rows, userId) => rows.deleteMany({ userId })
