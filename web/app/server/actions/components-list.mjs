import { defineAction } from './registry.mjs'
import { loadSlate } from './slate-access.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { catalog, catalogEntry, catalogFits, catalogVersion } from 'slateboxjs/catalog'
import { problem } from './errors.mjs'
// The plans' edits and rule keys join the engine's table as the rules load: load them before reading it.
import 'slateboxjs/workshops/rules'
import { describeWorkshopEdits } from 'slateboxjs/workshops/model'
import { slateBoards } from '../../imports/api/common/slate-boards.mjs'

// The library (library final.md §2.8): everything a person can add to a slate, as the panel shows
// it, with each edit joined to the engine's edit table. With a slate, whether each entry fits
// there (beside its boards, up to 8 on one slate: the honest sentence when not). The list stays well under
// exec's 40,000-character result, so `return slatebox.components.list()` comes back whole: the
// heavy per-entry details (the phrases that make each change, the looping picture's steps) are
// read one entry at a time with components.get.
const summaries = new Map(describeWorkshopEdits().map((edit) => [edit.kind, edit.summary]))
function entrySummary(entry, slate) {
  return {
    id: entry.id, group: entry.group, name: entry.name, line: entry.line, kind: entry.build.kind,
    add: entry.addSay[0], addAbout: entry.addSay[1],
    edits: entry.edits.map((kind) => ({ kind, summary: summaries.get(kind) })),
    rules: entry.rules, limits: entry.limits, loop: { src: entry.loop.src, alt: entry.loop.alt, caption: entry.loop.caption },
    ...(slate && { fits: fitsOn(entry.id, slate) }),
  }
}

// Whether an entry fits a slate: beside the boards it holds, up to 8. A slate of another creative kind
// (not a workshop) takes no board.
function fitsOn(id, slate) {
  const boards = slateBoards(slate).length
  if (slate.creative && !boards) return { ok: false, reason: 'This slate can’t hold a board.' }
  return catalogFits(id, { hasBoard: boards > 0, many: true, boards })
}

export function listComponents(slate = null) {
  return { catalogVersion, components: catalog.map((entry) => entrySummary(entry, slate)) }
}

export function getComponent(id, slate = null) {
  const entry = catalogEntry(id)
  if (!entry) throw problem(404, 'not_found', 'There is nothing called ' + String(id).slice(0, 60) + ' in the library. components.list names what can be added.')
  const summary = entrySummary(entry, slate)
  return {
    catalogVersion,
    component: {
      ...summary,
      moves: entry.moves.map(({ words, say, edit }) => ({ words, say, edit })),
      loop: { ...summary.loop, steps: entry.loop.steps },
    },
  }
}

export default defineAction({
  id: 'components.list',
  title: 'List the library',
  description:
    'Everything a person can add to a slate from the library (boards and starters): each entry with its group, one line, the message that adds it ("Add a retro"), the edits it takes (joined to the workshop_edits table), the rule kinds it can be given by chat, its limits and its looping picture. The phrases that make each change (moves) and the picture\'s steps come with components.get for one entry. With shareId, whether each fits that slate: a slate holds up to 8 boards, side by side. Add one to a slate with slates.applyOperations (plan operation add_component, with the slate revision), the same door as the chat\'s Add; it goes beside the boards already there.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/components', operationId: 'listComponents' } },
  input: { type: 'object', properties: { shareId: shareIdInput }, additionalProperties: false },
  output: { type: 'object', properties: { catalogVersion: { type: 'string' }, components: { type: 'array', items: { type: 'object' } } }, required: ['catalogVersion', 'components'] },
  load: (principal, input, ctx) => (input.shareId ? loadSlate(false)(principal, input, ctx) : null),
  tool: { name: 'list_components', title: 'List boards and starters', description: 'List the boards and starters a person can add to a slate (such as pipeline, budget, hiring plan, launch plan and release plan boards), with what each one is for. A slate holds up to 8 boards side by side.' },
  cli: { command: 'components' },
  handler: (_principal, _input, { resource: slate }) => listComponents(slate ?? null),
})

export const componentsGet = defineAction({
  id: 'components.get',
  title: 'Read a library entry',
  description:
    'One entry of the library (an id from components.list) with everything components.list gives plus the phrases that make each change (moves: the words a person says, what the board answers and the edit it makes) and the looping picture\'s steps. With shareId, whether it fits that slate.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/components/{id}', operationId: 'getComponent' } },
  input: {
    type: 'object',
    properties: { id: { type: 'string', minLength: 1, maxLength: 100, description: 'The library entry (components.list ids).' }, shareId: shareIdInput },
    required: ['id'],
    additionalProperties: false,
  },
  output: { type: 'object', properties: { catalogVersion: { type: 'string' }, component: { type: 'object' } }, required: ['catalogVersion', 'component'] },
  load: (principal, input, ctx) => (input.shareId ? loadSlate(false)(principal, input, ctx) : null),
  tool: { name: 'get_component', title: 'Read a board or starter', description: 'Read one board or starter from the library in full, by the id list_components gives.' },
  cli: { command: 'component' },
  handler: (_principal, input, { resource: slate }) => getComponent(input.id, slate ?? null),
})
