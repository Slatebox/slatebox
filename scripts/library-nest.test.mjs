// The nested boards in the chat and the library (dragology final.md §3.4, §3.5, §3.9, D4): Sort the evidence,
// Discovery tree, Break down a problem and Incident review. Every sentence is the engine's edits through its
// one reducer; rule phrases change the next drag; questions are answered with nothing changed; a rule the
// vocabulary can't say gets the honest boundary answer; the 12-phrase test.
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { checkNestMove, nestKids, nestLegal, nestRoots, nestEmptyDrop } from 'slateboxjs/workshops/rules'
import { catalogSamples as samples } from 'slateboxjs/workshops/samples'
import 'slateboxjs/workshops/behaviour'
import { catalogEntry } from 'slateboxjs/catalog'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { boardMoves, catalogSample, dragsDiffer, entryOfBoard, startersFor } from '../web/app/imports/api/common/library.mjs'
import { checkMove } from '../web/app/server/actions/slate-check-move.mjs'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'
import { replaceWorkshop } from '../web/app/server/methods/workshop-replace.mjs'

const tim = { by: 'Tim' }
const say = (board, message, selection = null) => proposeLaneReply(board, message, selection, tim)
const evidence = () => validateWorkshop(samples['sort-evidence']())
const tree = () => validateWorkshop(samples['discovery-tree']())
const parentOf = (board, id) => board.cards.find(card => card.id === id)?.parentId
const moved = (board, card, under) => applyWorkshopEdits(board, [{ kind: 'nest_card', card, under }])

test('the discovery loop in chat: refused in the rule’s words, the rule changed with a diff, then the same move lands', () => {
  const board = tree()
  assert.throws(() => say(board, 'Move CSV import under Activation to 40%'), /^Error: Solutions sit under an opportunity\.$/)
  const why = say(board, 'Why can’t I move CSV import under the outcome?')
  assert.equal(why.reply, 'Solutions sit under an opportunity. That rule came with the board.')
  const kept = say(board, 'Let solutions sit under the outcome for now')
  assert.deepEqual(kept.diff.lines, ['~ Solutions sit under an opportunity. → Solutions sit under an opportunity or an outcome.'])
  assert.deepEqual(kept.workshop.cards, board.cards)
  assert.equal(kept.workshop.behaviour.rules.find(rule => rule.role === 'solution').set.by, 'Tim')
  assert.equal(parentOf(say(kept.workshop, 'Move CSV import under Activation to 40%').workshop, 'csv-import'), 'outcome')
  // Warn instead: the move lands, with the rule's sentence as a warning.
  const warned = say(board, 'Warn instead of blocking').workshop
  assert.ok(warned.behaviour.rules.filter(rule => ['nests', 'children', 'depth'].includes(rule.kind)).every(rule => rule.severity === 'warn'))
  assert.equal(parentOf(say(warned, 'Move CSV import under Activation to 40%').workshop, 'csv-import'), 'outcome')
})

test('questions are answered from the board, with nothing changed', () => {
  const board = tree()
  assert.deepEqual(say(board, 'Which opportunities have no solutions yet?'), { reply: 'Hard to share results has no solutions yet.' })
  assert.match(say(board, 'How does this board behave?').reply, /• Solutions sit under an opportunity\.\n• Cards nest up to 3 levels deep\.\n• An opportunity holds at most 4\./)
  assert.equal(say(board, 'Why can’t I move CSV import under Data trust?').reply, 'CSV import can go under Data trust.')
})

test('Sort the evidence by chat: weight, cap, far drops, merge, group into themes, hand off to a tree', () => {
  const board = evidence()
  const arr = say(board, 'Weight by ARR').workshop
  assert.deepEqual(nestRoots(arr, 'piles').map(card => card.id), ['reporting', 'onboarding', 'pricing'])
  assert.throws(() => say(board, 'Weight by MRR'), /Cards on this board carry no MRR\. Say “Track MRR” first/)
  const capped = say(board, 'Piles hold at most 3; split anything bigger').workshop
  assert.throws(() => say(capped, 'Move Couldn’t find CSV export to Onboarding'), /Onboarding holds 3\. It has 3\./)
  const tray = say(board, 'Drops in empty space go to Unsorted').workshop
  assert.equal(nestEmptyDrop(tray, 'invites').cards.find(card => card.id === 'invites').laneId, 'unsorted')
  const merged = say(board, 'Merge Onboarding and Pricing')
  assert.equal(merged.reply, 'Merged “Pricing” into “Onboarding”: 2 cards moved.')
  const themes = say(board, 'Group Pricing and Reporting into Money')
  assert.deepEqual(themes.diff.lines, ['~ Cards nest one level deep. → Cards nest up to 2 levels deep.'])
  const money = themes.workshop.cards.find(card => card.label === 'Money')
  assert.deepEqual(nestKids(themes.workshop, money.id).map(card => card.id).sort(), ['pricing', 'reporting'])
  const handed = say(board, 'Turn the top 2 piles into a discovery tree').workshop
  assert.equal(handed.nest.layout, 'tree')
  const outcome = handed.cards.find(card => card.role === 'outcome')
  assert.deepEqual(nestKids(handed, outcome.id).map(card => card.role), ['opportunity', 'opportunity'])
  assert.equal(entryOfBoard(handed).id, 'discovery-tree')
  // Structure and fields: a note added to a pile, a new pile, who said it, ARR, a note to the tray, removal.
  assert.equal(parentOf(say(board, 'Add a note called Slow exports to Reporting').workshop, 'card-1'), 'reporting')
  assert.equal(parentOf(say(board, 'Start a pile called Data trust with I don’t trust the numbers').workshop, 'trust'), 'card-1')
  assert.equal(say(board, 'Mobile app please came from Initech').workshop.cards.find(card => card.id === 'mobile').source, 'Initech')
  assert.equal(say(board, 'Set Mobile app please’s ARR to $15k').workshop.cards.find(card => card.id === 'mobile').fields.arr, 15000)
  assert.equal(say(board, 'Move Invite flow is confusing to Unsorted').workshop.cards.find(card => card.id === 'invites').laneId, 'unsorted')
  assert.equal(say(board, 'Remove Reporting').reply, 'Removed “Reporting”. What was in it went to “Unsorted”.')
})

test('Break down a problem: warnings, never refusals, until someone says “stop me”', () => {
  const board = validateWorkshop(samples['break-down']())
  // An action under the problem itself lands with a warning; "stop me" makes it a refusal.
  assert.equal(parentOf(say(board, 'Move Survey churned accounts under Churn rose in Q3').workshop, 'survey'), 'problem')
  const strict = say(board, 'Stop me when an action is not under a cause').workshop
  assert.throws(() => say(strict, 'Move Survey churned accounts under Churn rose in Q3'), /Actions sit under a cause\./)
  assert.equal(parentOf(say(board, 'Add a cause called Unclear pricing page under Price rise in July').workshop, 'card-1'), 'price-rise')
})

test('the 12-phrase test: behaviour phrases outside the chips compile into rules that act on the sample, or get the honest boundary', () => {
  const runs = {
    'sort-evidence': [
      ['Rank the piles by notes', b => nestRoots(b, 'piles')[0].id === 'onboarding' && b.behaviour.rules.some(rule => rule.kind === 'rank' && rule.by === 'count')],
      ['Sort piles by ARR', b => nestRoots(b, 'piles')[0].id === 'reporting'],
      ['Each pile holds up to 3 notes', b => 'refused' in moved(b, 'Couldn’t find CSV export', 'Onboarding')],
      ['A pile can hold 1', b => 'refused' in moved(b, 'Invite flow is confusing', 'Pricing')],
      ['Cards let go in empty space go to Unsorted', b => nestEmptyDrop(b, 'invites').cards.find(card => card.id === 'invites').laneId === 'unsorted'],
      ['Cards nest up to 2 levels deep', b => !('refused' in moved(b, 'Pricing', 'Reporting'))],
      ['Notes must sit under a pile or a theme', b => b.behaviour.rules.find(rule => rule.kind === 'nests' && rule.role === 'note').under.includes('theme')],
      ['Let notes sit under a theme too', b => b.behaviour.rules.find(rule => rule.kind === 'nests' && rule.role === 'note').under.includes('theme')],
      ['Warn instead of refusing', b => !('refused' in moved(b, 'Pricing', 'Reporting'))],
      ['Stop me when a note is not under a pile', b => 'refused' in applyWorkshopEdits(b, [{ kind: 'nest_card', card: 'Invite flow is confusing', lane: 'Piles' }])],
      ['Order piles by number of customers', b => b.behaviour.rules.some(rule => rule.kind === 'rank' && rule.by === 'sources')],
      ['Pricing can never hold more than Onboarding', null],
    ],
    'discovery-tree': [
      ['Solutions sit only under opportunities', b => 'refused' in moved(b, 'CSV import', 'Activation to 40%')],
      ['Allow solutions to sit under outcomes too', b => !('refused' in moved(b, 'CSV import', 'Activation to 40%'))],
      ['Opportunities must sit under an outcome', b => 'refused' in moved(b, 'Data trust', 'Guided setup')],
      ['An opportunity holds at most 2', b => 'refused' in moved(b, 'Reconcile with finance', 'Onboarding is slow')],
      ['Each opportunity can hold 1 solution', b => 'refused' in moved(b, 'Guided setup', 'Data trust')],
      ['Cards nest up to 4 levels deep', b => b.behaviour.rules.find(rule => rule.kind === 'depth').max === 4],
      ['Warn instead of refusing', b => !('refused' in moved(b, 'CSV import', 'Activation to 40%'))],
      ['Stop me when a solution is not under an opportunity', b => 'refused' in moved(b, 'CSV import', 'Activation to 40%')],
      ['Drops in empty space go to Parked ideas', b => nestEmptyDrop(b, 'csv-import').cards.find(card => card.id === 'csv-import').laneId === 'parked'],
      ['Let opportunities sit under a theme', b => b.behaviour.rules.find(rule => rule.kind === 'nests' && rule.role === 'opportunity').under.includes('theme')],
      ['Cards nest up to 2 levels deep', null],
      ['Experiments can only sit under solutions', null],
    ],
  }
  for (const [id, phrases] of Object.entries(runs)) {
    const sample = validateWorkshop(samples[catalogEntry(id).build.sample]())
    const chips = startersFor(catalogEntry(id), sample, null, { all: true }).map(item => item.text)
    let acted = 0
    for (const [phrase, acts] of phrases) {
      assert.ok(!chips.includes(phrase), id + ': “' + phrase + '” is a chip')
      let proposal
      try { proposal = say(sample, phrase) } catch (error) {
        // The honest answers: a rule the vocabulary can't say, or one that contradicts the board's own.
        assert.match(error.message, /^I can’t make that a rule yet\. I can make one like “.+”\.$|levels down, but cards nest only/, id + ': “' + phrase + '”')
        continue
      }
      assert.ok(proposal.workshop, id + ': “' + phrase + '” changed nothing')
      if (acts && acts(proposal.workshop) && dragsDiffer(sample, proposal.workshop) !== null) acted++
      else assert.ok(!acts, id + ': “' + phrase + '” did not act')
    }
    assert.ok(acted >= 10, id + ': ' + acted + ' of 12 acted')
  }
})

test('the library: every nest entry’s phrases parse on its sample, and each rule phrase changes the next drag', () => {
  for (const id of ['sort-evidence', 'discovery-tree', 'break-down-problem', 'incident-review']) {
    const entry = catalogEntry(id)
    const sample = catalogSample(id, samples)
    assert.equal(entryOfBoard(sample).id, id)
    const offered = startersFor(entry, sample, null, { all: true })
    for (const edit of entry.edits) assert.ok(offered.some(item => item.edit === edit), id + ': no phrase for ' + edit)
    for (const kind of entry.rules) {
      const phrase = offered.find(item => item.rule === kind)
      assert.ok(phrase.changes(sample, say(sample, phrase.text).workshop), id + ': “' + phrase.text + '” changes no drag')
    }
    assert.ok(boardMoves(sample).length >= 4)
  }
})

test('exec’s check_move on a nest board: the verdict a drag gets, by under', () => {
  const slate = { creative: { revision: 4, model: { kind: 'workshop', workshop: tree() } } }
  assert.deepEqual(checkMove(slate, { card: 'CSV import', under: 'Activation to 40%' }), { revision: 4, rev: 0,
    // A rule of what sits under what may be broken once the person agrees: offered as "Move anyway" (nest_card override).
    refused: { sentence: 'Solutions sit under an opportunity.', ruleId: 'rule-2', nearest: 'Data trust', overridable: true, set: { by: 'Slatebox', at: '2026-11-21T00:00:00.000Z', via: 'preset' } } })
  assert.deepEqual(checkMove(slate, { card: 'CSV import', under: 'Data trust' }), { revision: 4, rev: 0, ok: true, warnings: [] })
  assert.deepEqual(checkMove(slate, { card: 'Templates gallery', lane: 'Parked ideas' }), { revision: 4, rev: 0, ok: true, warnings: [] })
  // The same as the drag's candidates, card by card.
  const board = tree()
  for (const card of board.cards) for (const target of board.cards.filter(item => item.laneId === 'tree')) {
    const drag = nestLegal(board, card.id).some(({ spot }) => spot.under === target.id)
    assert.equal('ok' in checkNestMove(board, { id: card.id }, { under: { id: target.id } }), drag, card.id + ' under ' + target.id)
  }
})

test('the server plays a canvas drag and a note dropped on a pile on the board as it stands', () => {
  const board = evidence()
  const [drag, note] = readWorkshopChanges([
    { edits: [{ kind: 'nest_card', card: { id: 'csv-export' }, under: { id: 'onboarding' } }], cardId: 'csv-export' },
    { cardId: 'note-1', laneId: 'piles', noteToCard: { noteId: 'note-1', label: 'Exports time out', under: 'reporting' } },
  ])
  assert.equal(note.noteToCard.under, 'reporting')
  const played = playWorkshopChanges(board, [drag, note])
  assert.equal(parentOf(played.workshop, 'csv-export'), 'onboarding')
  assert.equal(parentOf(played.workshop, 'note-1'), 'reporting')
  // Someone merged Reporting away while the note was in the air: it lands where Reporting went.
  const merged = applyWorkshopEdits(board, [{ kind: 'merge_cards', card: 'Reporting', into: 'Pricing' }]).workshop
  const late = playWorkshopChanges(merged, [note])
  assert.equal(parentOf(late.workshop, 'note-1'), 'pricing')
})

// Review s3-nest finding 1: a kept chat change is a whole save (creativeSlates.save), made again by the server
// from the kit's edits. Every phrase the library offers on a nested board, and the structure sentences, must be
// kept as proposed: the same cards in the same places, the same rules.
test('every phrase offered on a nested board is kept by the server’s whole save, as proposed', () => {
  const places = board => board.cards.map(card => [card.id, card.laneId, card.parentId ?? null, card.role ?? null, card.label, card.source ?? null, JSON.stringify(card.fields ?? null),
    (card.parentId ? nestKids(board, card.parentId) : nestKids(board, null, card.laneId)).findIndex(item => item.id === card.id)].join('|')).sort()
  const extra = {
    'sort-evidence': ['Group Pricing and Reporting into Money', 'Turn the top 3 piles into a discovery tree', 'Merge Pricing into Onboarding', 'Track Seats', 'Set Mobile app please’s ARR to $15k',
      'Start a pile called Trust with I don’t trust the numbers', 'Move Want annual billing to Onboarding', 'Add a note called A loose idea', 'Remove Onboarding'],
    'discovery-tree': ['Move CSV import under Data trust', 'Draw it as piles', 'Make Templates gallery an opportunity', 'Remove Data trust'],
    'break-down-problem': ['Move Survey churned accounts under Churn rose in Q3'],
    'incident-review': [],
  }
  let kept = 0
  for (const id of Object.keys(extra)) {
    const sample = catalogSample(id, samples)
    const phrases = [...startersFor(catalogEntry(id), sample, null, { all: true }).map(item => item.text), ...extra[id]]
    for (const phrase of phrases) {
      let proposal
      try { proposal = say(sample, phrase) } catch { continue }
      if (!proposal?.workshop) continue
      const out = replaceWorkshop(sample, proposal.workshop, { revision: 3, current: 3, userId: 'u1', actor: tim })
      assert.ok(out.workshop, id + ': “' + phrase + '” was proposed but the save refused it: ' + out.refused?.reason)
      assert.deepEqual(places(out.workshop), places(proposal.workshop), id + ': “' + phrase + '” was kept differently')
      assert.deepEqual(out.workshop.behaviour.rules.map(({ set: _set, ...rule }) => rule), proposal.workshop.behaviour.rules.map(({ set: _set, ...rule }) => rule), id + ': “' + phrase + '” rules')
      assert.deepEqual(out.workshop.nest, proposal.workshop.nest, id + ': “' + phrase + '” nest')
      kept++
    }
  }
  assert.ok(kept >= 30, kept + ' kept')
  // A whole save that moves a card where the rules refuse it is still refused, rules changed in it or not.
  const board = tree()
  const bad = { ...board, cards: board.cards.map(card => card.id === 'csv-import' ? { ...card, parentId: 'outcome' } : card) }
  assert.equal(replaceWorkshop(board, bad, { revision: 1, current: 1, userId: 'u1', actor: tim }).refused.reason, 'Solutions sit under an opportunity.')
  const capped = { ...bad, behaviour: { ...board.behaviour, rules: board.behaviour.rules.map(rule => rule.kind === 'children' ? { ...rule, max: 3 } : rule) } }
  assert.equal(replaceWorkshop(board, capped, { revision: 1, current: 1, userId: 'u1', actor: tim }).refused.reason, 'Solutions sit under an opportunity.')
})
