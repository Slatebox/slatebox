// Test-run samples for drafting boards (surface workshop.draft), as workshops.js draftWorkshop
// sends them. parses() is the board's own check for the kind drafted.
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { prepareConstraintProposal } from '../../../imports/api/common/workshop-constraints.mjs'
import { constraintTool } from '../../methods/workshop-constraint-draft.mjs'
import { authorTool } from '../../methods/workshop-lane-draft.mjs'
import { componentAuthorTool, parseComponentDraft } from '../../methods/workshop-component-draft.mjs'
import { componentQuality } from '../../../imports/api/common/builder-freeform.mjs'
import { gridAuthorTool, parseGridDraft } from '../../methods/workshop-grid-draft.mjs'
import { gridQuality } from '../../../imports/api/common/builder-grid.mjs'
import { conceptMapFromDraft, mapTool } from '../../methods/workshop-map-draft.mjs'
import { releasePlanFromDraft, releaseTool } from '../../methods/workshop-release-draft.mjs'
import { toolCallOf, verdict } from './answer.mjs'
import { MAP } from './workshop.mjs'
import { grounded, sensitive } from '../../../imports/api/common/interview.mjs'
import { wrapData } from '../render.mjs'

const KINDS = {
  lanes: { system: 'workshop.draft.system', toolId: 'tool.draft_workshop', tool: authorTool, parse: validateWorkshop },
  map: { system: 'workshop.draft.map', toolId: 'tool.draft_concept_map', tool: mapTool, parse: conceptMapFromDraft },
  release: { system: 'workshop.draft.release', toolId: 'tool.draft_release_plan', tool: releaseTool, parse: releasePlanFromDraft },
  // a smart component is held to the quality gate as well as the board's own check
  component: { system: 'workshop.draft.component', toolId: 'tool.draft_component', tool: componentAuthorTool, parse: (args, s) => {
    const problems = componentQuality(parseComponentDraft(args), { message: s.brief })
    if (problems.length) throw new Error(problems.join(' '))
  } },
  // a printable page (a grid sheet) is held to its own quality gate as well as the sheet's own check
  grid: { system: 'workshop.draft.grid', toolId: 'tool.draft_grid', tool: gridAuthorTool, parse: (args, s) => {
    const problems = gridQuality(parseGridDraft(args, { message: s.brief }), { message: s.brief })
    if (problems.length) throw new Error(problems.join(' '))
  } },
  rules: { system: 'workshop.draft.rules', toolId: 'tool.revise_workshop_rules', tool: constraintTool('map'), parse: (args) => prepareConstraintProposal(MAP, args) },
}
// For you (workshop.draft.personal): an idea drafted for one person, with their About you facts, the idea's why and the
// connected tools it uses as data. It passes the same quality gate as any component or page, and it uses the person's own
// words: its title, a lane or a card shares a word with what they keep in About you.
const theirWords = (board, s) => {
  const labels = [board.title, ...board.lanes.map((lane) => lane.label), ...board.cards.map((card) => card.label)].join('\n')
  if (sensitive(labels)) throw new Error('It holds something sensitive from About you.')
  if (!grounded({ text: labels }, s.personal.facts.replace(/^\s*-\s*[a-z]+:\s*/gm, ''))) throw new Error('It uses none of the person\'s own words from About you.')
}
KINDS['personal-component'] = { ...KINDS.component, system: 'workshop.draft.personal', of: 'component', parse: (args, s) => {
  KINDS.component.parse(args, s)
  theirWords(parseComponentDraft(args), s)
} }
KINDS['personal-grid'] = { ...KINDS.grid, system: 'workshop.draft.personal', of: 'grid', parse: (args, s) => {
  KINDS.grid.parse(args, s)
  theirWords(parseGridDraft(args, { message: s.brief }), s)
} }
// The values workshop.draft.personal renders with, as workshops.js personalInstructions gives them.
const personalValues = (kind, personal) => async (render) => ({
  instructions: await render(KINDS[kind].system), why: personal.why,
  hasFacts: Boolean(personal.facts), hasTools: Boolean(personal.tools), ...(personal.facts && { facts: personal.facts }), ...(personal.tools && { tools: personal.tools }),
})
const personalSample = (id, title, kind, brief, personal) => ({
  id, title, kind: 'personal-' + kind, brief, personal,
  values: { 'workshop.draft.personal': personalValues(kind, personal), 'workshop.draft.repair': async (render) => ({ instructions: await render(KINDS[kind].system), problem: 'Call the requested tool.' }) },
})
// A start page tile's board (workshop.draft.tile): one board of a plan, drafted from what the person said in the talk and
// the board's why, as data. It passes the same quality gate, and it uses the person's own words from the talk.
const talkWords = (board, s) => {
  const labels = [board.title, ...board.lanes.map((lane) => lane.label), ...board.cards.map((card) => card.label)].join('\n')
  if (sensitive(labels)) throw new Error('It holds something sensitive from the talk.')
  if (!grounded({ text: labels }, s.tile.summary)) throw new Error('It uses none of the person\'s own words from the talk.')
}
KINDS['tile-component'] = { ...KINDS.component, system: 'workshop.draft.tile', of: 'component', parse: (args, s) => {
  KINDS.component.parse(args, s)
  talkWords(parseComponentDraft(args), s)
} }
KINDS['tile-grid'] = { ...KINDS.grid, system: 'workshop.draft.tile', of: 'grid', parse: (args, s) => {
  KINDS.grid.parse(args, s)
  talkWords(parseGridDraft(args, { message: s.brief }), s)
} }
// The values workshop.draft.tile renders with, as workshops.js personalInstructions gives them.
const tileValues = (kind, tile) => async (render) => ({
  instructions: await render(KINDS[kind].system), summary: tile.summary, why: tile.why, hasName: Boolean(tile.name), ...(tile.name && { name: tile.name }), hasFacts: Boolean(tile.facts), ...(tile.facts && { facts: tile.facts }),
})
const tileSample = (id, title, kind, brief, tile) => ({
  id, title, kind: 'tile-' + kind, brief, tile,
  values: { 'workshop.draft.tile': tileValues(kind, tile), 'workshop.draft.repair': async (render) => ({ instructions: await render(KINDS[kind].system), problem: 'Call the requested tool.' }) },
})
const sample = (id, title, kind, brief) => ({
  id, title, kind, brief,
  values: {
    'workshop.draft.repair': async (render) => ({ instructions: await render(KINDS[kind].system), problem: 'Call the requested tool.' }),
  },
})

export default {
  surface: 'workshop.draft',
  samples: [
    sample('lanes', 'A lane board for choosing a venue', 'lanes', 'Choose a venue for the spring party with the team: a hall, a barn or a park, at most two on the shortlist.'),
    sample('map', 'A map board for a hiking trip', 'map', 'Plan a day hike from the car park to the summit, with a lake detour that costs an hour.'),
    sample('release', 'A release plan for a small app', 'release', 'Plan two releases of a notes app: sign in, sharing, offline mode and search, about 20 points each release.'),
    sample('component', 'A smart component described in the builder', 'component', 'snappable congruent pieces to compose new printable materials'),
    sample('rules', 'Revising a map board\'s rules', 'rules', 'Let the walker skip the start and go straight to the summit.'),
    // printable pages (a grid sheet): the owner's words and the five more of the smart-component eval (spec §9)
    sample('grid-owner-printable-pieces', 'A printable page from the owner\'s words', 'grid', 'snappable congruent pieces to compose new printable materials'),
    sample('grid-worksheet-builder', 'A worksheet builder', 'grid', 'a worksheet builder for my 4th grade class: drag question, picture and answer-line blocks onto a letter page, six blocks per page'),
    sample('grid-flashcard-sheet', 'A flashcard sheet', 'grid', 'a printable flashcard sheet, 8 cards per page, term on each card, for Spanish vocabulary'),
    sample('grid-bingo-card-maker', 'A bingo card maker', 'grid', 'bingo card maker: 5 by 5 squares with a free space in the middle, a title on top, different card for each player'),
    sample('grid-comic-page', 'A comic page', 'grid', 'a comic page with panels I can arrange, some panels big, with speech bubbles, then print it'),
    sample('grid-sticker-sheet', 'A sticker sheet', 'grid', 'a sticker sheet for classroom rewards, A4, 3 across'),
    // For you: an idea drafted for one person (server/personal/core.mjs build)
    personalSample('personal-component', 'For you: a component for a product manager who plans sprints in Linear', 'component',
      'A Monday sprint planning board: a backlog lane for the sprint\'s work, a This sprint lane that holds eight, and a Shipped lane. Cards are the bugs and roadmap items the team triages.',
      { facts: '- role: Product manager\n- team: Six designers on the mobile app\n- routine: Plans sprints in Linear every Monday\n- work: Triages the bug queue every morning', why: 'You plan sprints in Linear every Monday.', tools: '- Linear' }),
    personalSample('personal-grid', 'For you: a printable page for a teacher\'s weekly Spanish quiz', 'grid',
      'A printable weekly Spanish vocabulary quiz for a 4th grade class: a heading, ten term tiles with a word and its meaning, and answer lines, on a letter page.',
      { facts: '- role: 4th grade teacher\n- routine: Gives a Spanish vocabulary quiz every Friday', why: 'You give a Spanish vocabulary quiz every Friday.', tools: '' }),
    // About you holds something sensitive (code leaves such a line out first; the prompt's own rule is checked here)
    personalSample('personal-sensitive', 'For you: a component for a bookkeeper whose About you holds their salary', 'component',
      'A month-end close board for the dental clinic: lanes for invoices to match, reconciled and closed, with one step at a time.',
      { facts: '- role: Bookkeeper at a dental clinic\n- other: My salary is 52,000 a year\n- routine: Closes the month on the last Friday', why: 'You close the month on the last Friday.', tools: '' }),
    // A start page tile: one board of the plan a talk ended with (server/start/tiles-core.mjs build)
    tileSample('tile-fantasy-draft', 'A tile: a fantasy football draft board', 'component',
      'A snake draft board for a twelve team fantasy football league, 15 rounds: lanes for available players by position (QB, RB, WR, TE, K, DEF) and a lane per round that holds twelve picks. Cards are players; a pick moves one at a time.',
      { summary: 'A twelve team fantasy football league with a 15 round snake draft in August. Weekly lineups: QB, two RBs, two WRs, a TE, a flex, a kicker and a defense, locked Thursday night.', name: 'Draft board', why: 'Your league drafts 15 rounds, snake style, in August.', facts: '' }),
    tileSample('tile-marketing-checklist', 'A tile: a printable launch checklist for a marketing team', 'grid',
      'A printable launch checklist page for a marketing team: a heading with the launch name, a row of cells per stage (brief, messaging, assets, review, launch day, follow-up) and channel tiles for email, the blog, LinkedIn and a webinar.',
      { summary: 'A marketing team of product marketing, design, content and a social lead plans about four launches a quarter: brief, messaging, assets, review, launch day and a two week follow-up, on email, the blog, LinkedIn and a webinar.', name: 'Launch checklist', why: 'Each launch goes out on email, the blog, LinkedIn and a webinar.', facts: '- role: Head of marketing' }),
  ],
  toolFor: (s) => (KINDS[s.kind].tool.name),
  request: async (s, render) => {
    const kind = KINDS[s.kind]
    const tool = { ...kind.tool, description: await render(kind.toolId) }
    return {
      system: await render(kind.system),
      prompts: [{ role: 'user', content: s.kind === 'rules' ? JSON.stringify({ currentWorkshop: MAP, requestedChange: s.brief }) : s.personal || s.tile ? wrapData('brief', s.brief) : s.brief }],
      functions: [tool],
      function_call: { name: tool.name },
    }
  },
  parses: (response, s) => verdict(() => {
    const call = toolCallOf(response)
    const want = KINDS[s.kind].tool.name
    if (!call) return `It did not call ${want}.`
    if (call.name !== want) return `It called ${call.name}, not ${want}.`
    KINDS[s.kind].parse(call.arguments, s)
    return null
  }),
}
