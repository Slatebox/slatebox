// Impact × effort, the reorg & hiring sandbox and goals & owners in the chat and the library (dragology final.md
// §3.6–3.8, D5–D7). Every sentence is the engine's edits through its one reducer; rule phrases change the next drag;
// questions are answered with nothing changed; the 12-phrase test; every phrase offered is kept by the server's
// whole save as proposed; exec's check_move and the server's play of a canvas drag agree with the board.
import assert from 'node:assert/strict'
import test from 'node:test'
import { applyWorkshopEdits, validateWorkshop } from 'slateboxjs/workshops/model'
import { nestLegal, checkNestMove, nestScores, quadrantOf } from 'slateboxjs/workshops/rules'
import { catalogSamples as samples } from 'slateboxjs/workshops/samples'
import 'slateboxjs/workshops/behaviour'
import { catalogEntry } from 'slateboxjs/catalog'
import { proposeLaneReply } from '../web/app/imports/api/common/lane-conversation.mjs'
import '../web/app/imports/api/common/board-chat.mjs'
import { boardMoves, catalogSample, entryOfBoard, listedEntries, startersFor } from '../web/app/imports/api/common/library.mjs'
import { checkMove } from '../web/app/server/actions/slate-check-move.mjs'
import { playWorkshopChanges, readWorkshopChanges } from '../web/app/server/methods/workshop-play.mjs'
import { replaceWorkshop } from '../web/app/server/methods/workshop-replace.mjs'

const tim = { by: 'Tim' }
const say = (board, message, selection = null) => proposeLaneReply(board, message, selection, tim)
const matrix = () => validateWorkshop(samples['impact-effort']())
const org = () => validateWorkshop(samples.reorg())
const goals = () => validateWorkshop(samples.goals())
const card = (board, id) => board.cards.find(item => item.id === id)
const quadrant = (board, id) => quadrantOf(board, card(board, id))
const lands = (board, edits) => !('refused' in applyWorkshopEdits(board, edits))
const under = (id, parent) => [{ kind: 'nest_card', card: { id }, under: { id: parent } }]
const owner = (id, team) => [{ kind: 'set_owner', card: { id }, owner: team }]
const rule = (board, kind, test = () => true) => board.behaviour.rules.find(item => item.kind === kind && test(item))

test('Impact × effort in chat: a full Do now refuses, "Do now holds 4" is a diff, then the same move lands; axes renamed; a comparison answered', () => {
  const board = matrix()
  assert.throws(() => say(board, 'Move AI summaries to Do now'), /^Error: Do now holds 3\. Exports has the lowest impact there\.$/)
  const four = say(board, 'Do now holds 4')
  assert.deepEqual(four.diff.lines, ['~ Do now holds 3. → Do now holds 4.'])
  assert.deepEqual(four.workshop.cards, board.cards)
  assert.equal(quadrant(say(four.workshop, 'Move AI summaries to Do now').workshop, 'summaries'), 'do-now')
  const renamed = say(board, 'Rename the axes Reach and Confidence').workshop
  assert.deepEqual(renamed.nest.fields.map(field => field.label), ['Confidence', 'Reach'])
  assert.throws(() => say(renamed, 'Move AI summaries to Do now'), /Exports has the lowest reach there\./)
  assert.deepEqual(say(board, 'Is Exports harder than Faster search?'), { reply: 'No on effort: Exports 2, Faster search 3.' })
  assert.deepEqual(say(board, 'Is SSO more valuable than Exports?'), { reply: 'Yes on impact: SSO 9, Exports 6.' })
  const scored = say(board, 'Score Slack alerts impact 7, effort 8').workshop
  assert.deepEqual(nestScores(scored, card(scored, 'alerts')), { x: 8, y: 7 })
  assert.equal(quadrant(scored, 'alerts'), 'plan')
  assert.equal(card(say(board, 'Add a card called Webhooks').workshop, 'card-1').laneId, 'unscored')
})

test('the reorg sandbox in chat: open roles and contractors refuse; a team moves with its manager; a pasted list lands row for row', () => {
  const board = org()
  assert.throws(() => say(board, 'Move Tom Berg under VP Sales'), /^Error: Open roles don’t manage\. VP Sales is an open role\.$/)
  assert.throws(() => say(board, 'Move Tom Berg under Sam Lee'), /^Error: Contractors don’t manage\. Sam Lee is a contractor\.$/)
  const moved = say(board, 'Move Jo Park, Growth under Priya Rao, VP Eng').workshop
  assert.deepEqual(['jo', 'ravi', 'lena', 'sam'].map(id => card(moved, id).parentId), ['priya', 'jo', 'jo', 'jo'])
  const freed = say(board, 'Sam Lee is not a contractor').workshop
  assert.equal(card(freed, 'sam').fields.contractor, 0)
  assert.ok(lands(freed, under('tom', 'sam')))
  const strict = say(board, 'Stop me when a manager has no designer').workshop
  assert.throws(() => say(strict, 'Move Lena Ortiz under Kai Wong, Platform'), /Every manager has a designer under them\. Jo Park, Growth would have none\./)
  assert.equal(rule(say(board, 'No manager over 3 reports').workshop, 'children').max, 3)
  const pasted = ['name, role, manager', 'Noor Ali, manager, Priya Rao, VP Eng', 'Eli Ford, engineer, Noor Ali', 'Mia Holt, designer, Noor Ali', 'Kim Cho, engineer, Noor Ali'].join('\n')
  const started = Date.now()
  const made = say(board, pasted).workshop
  assert.ok(Date.now() - started < 10000)
  const named = label => made.cards.find(item => item.label === label)
  assert.equal(named('Noor Ali').parentId, 'priya')
  assert.deepEqual(['Eli Ford', 'Mia Holt', 'Kim Cho'].map(label => [named(label).role, named(label).parentId]), [['engineer', named('Noor Ali').id], ['designer', named('Noor Ali').id], ['engineer', named('Noor Ali').id]])
  // Under "Stop me when a manager has no designer": a new manager is hired, then their designer, in one pasted list
  // the server keeps as shown; marking someone on a team already short a contractor is never held to it.
  const hire = ['name, role, manager', 'Noor Ali, manager, Priya Rao, VP Eng', 'Mia Holt, designer, Noor Ali', 'Eli Ford, engineer, Noor Ali'].join('\n')
  const hired = say(strict, hire).workshop
  assert.equal(hired.cards.filter(item => item.parentId === hired.cards.find(other => other.label === 'Noor Ali').id).length, 2)
  const kept = replaceWorkshop(strict, hired, { revision: 2, current: 2, userId: 'u1', actor: tim })
  assert.ok(kept.workshop, kept.refused?.reason)
  assert.equal(card(say(strict, 'Tom Berg is a contractor').workshop, 'tom').fields.contractor, 1)
})

test('goals & owners in chat: a key result given to another team is flagged; carry brings its initiatives; ask, refuse and questions', () => {
  const board = goals()
  const given = say(board, 'Give Self-serve upgrades 30% to Platform').workshop
  assert.equal(card(given, 'self-serve').owner, 'platform')
  assert.equal(card(given, 'pricing-page').owner, 'growth')
  const carry = say(board, 'When I move a key result, bring its initiatives along')
  assert.deepEqual(carry.diff.lines, ['~ A card is owned by the team that owns what it sits under (a warning only). → A card is owned by the team that owns what it sits under; moving one to a team brings what is under it along (a warning only).'])
  const carried = say(carry.workshop, 'Give Onboarding under 10 min to Platform').workshop
  assert.deepEqual(['fast-onboarding', 'guided', 'starters'].map(id => card(carried, id).owner), ['platform', 'platform', 'platform'])
  const brought = say(given, 'Move what is under Self-serve upgrades 30% to Platform too').workshop
  assert.equal(card(brought, 'pricing-page').owner, 'platform')
  const strict = say(board, 'Stop me when a key result is owned outside its objective’s team').workshop
  assert.throws(() => say(strict, 'Give Self-serve upgrades 30% to Platform'), /^Error: Self-serve upgrades 30% is Platform’s; what it sits under is Growth’s\.$/)
  assert.deepEqual(say(board, 'Who owns p95 under 300 ms?'), { reply: 'p95 under 300 ms is Platform’s.' })
  assert.deepEqual(say(board, 'Add Data as a team').workshop.nest.owners.at(-1), { id: 'data', label: 'Data' })
  assert.equal(rule(say(board, 'Turn ownership checks off').workshop, 'sameOwnerAs').on, false)
})

test('the 12-phrase test on all three: behaviour phrases outside the chips compile into rules that act on the sample, or get the honest boundary', () => {
  const runs = {
    'impact-effort': [
      ['Later holds 2', b => rule(b, 'quadrant', r => r.quadrant === 'later')?.max === 2],
      ['Skip holds 1', b => !lands(b, [{ kind: 'score_card', card: { id: 'dark-mode' }, x: 8, y: 2 }])],
      ['The plan it square holds 3', b => rule(b, 'quadrant', r => r.quadrant === 'plan')?.max === 3],
      ['Do now can hold 5', b => lands(b, [{ kind: 'score_card', card: { id: 'summaries' }, x: 3, y: 9 }])],
      ['Do now takes up to 2', b => rule(b, 'quadrant', r => r.quadrant === 'do-now').max === 2],
      ['Warn instead of refusing', b => lands(b, [{ kind: 'score_card', card: { id: 'summaries' }, x: 3, y: 9 }])],
      ['Just warn me instead of blocking', b => lands(b, [{ kind: 'score_card', card: { id: 'summaries' }, x: 3, y: 9 }])],
      ['Plan it can hold 1', b => !lands(b, [{ kind: 'score_card', card: { id: 'dark-mode' }, x: 8, y: 8 }])],
      ['Later holds at most 4 cards', b => rule(b, 'quadrant', r => r.quadrant === 'later')?.max === 4],
      ['Skip can hold 2 ideas', b => rule(b, 'quadrant', r => r.quadrant === 'skip')?.max === 2],
      ['Do now holds 6', b => rule(b, 'quadrant', r => r.quadrant === 'do-now').max === 6],
      ['Scores can never go above 8', null],
    ],
    'reorg-sandbox': [
      ['No manager over 2 reports', b => !lands(b, under('tom', 'jo'))],
      ['Managers have at most 4 reports', b => rule(b, 'children').max === 4],
      ['Designers don’t manage', b => !lands(b, under('tom', 'lena'))],
      ['Interns never manage', b => b.behaviour.rules.some(r => r.kind === 'parent' && r.not === 'intern')],
      ['Every manager needs an engineer', b => rule(b, 'contains', r => r.of === 'engineer')?.severity === 'refuse'],
      ['Every team needs a designer, just warn me', b => rule(b, 'contains', r => r.of === 'designer').severity === 'warn'],
      ['Stop me when a manager has no engineer', b => rule(b, 'contains', r => r.of === 'engineer')?.severity === 'refuse'],
      ['Warn instead of refusing', b => lands(b, under('tom', 'vp-sales'))],
      ['Cards nest up to 3 levels deep', b => !lands(b, under('jo', 'kai'))],
      ['Engineers never manage', b => !lands(b, under('tom', 'ravi'))],
      ['A manager holds at most 5', b => rule(b, 'children').max === 5],
      ['People can only report to one manager', null],
    ],
    'goals-owners': [
      ['Warn me when a key result is owned outside its objective’s team', b => rule(b, 'sameOwnerAs').severity === 'warn' && rule(b, 'sameOwnerAs').on],
      ['Stop me when an initiative is owned outside its key result’s team', b => !lands(b, owner('self-serve', 'platform'))],
      ['When we move a key result, bring what is under it along', b => applyWorkshopEdits(b, owner('self-serve', 'platform')).workshop.cards.find(c => c.id === 'pricing-page').owner === 'platform'],
      ['Ask me before moving anything I didn’t drag', b => rule(b, 'sameOwnerAs').mode === 'ask'],
      ['Leave what is under a card where it is', b => rule(b, 'sameOwnerAs').mode === 'warn'],
      ['Turn ownership checks off', b => rule(b, 'sameOwnerAs').on === false],
      ['Key results sit only under objectives', b => !lands(b, under('fast-onboarding', 'self-serve'))],
      ['Initiatives must sit under a key result or an objective', b => lands(b, under('guided', 'activation'))],
      ['Warn instead of blocking', b => lands(b, under('guided', 'activation'))],
      ['A key result holds at most 1', b => !lands(b, under('pricing-page', 'fast-onboarding'))],
      ['Let initiatives sit under an objective', b => lands(b, under('cache', 'uptime'))],
      ['Owners must always match', null],
    ],
  }
  for (const [id, phrases] of Object.entries(runs)) {
    const sample = catalogSample(id, samples)
    const chips = startersFor(catalogEntry(id), sample, null, { all: true }).map(item => item.text)
    let acted = 0
    for (const [phrase, acts] of phrases) {
      assert.ok(!chips.includes(phrase), id + ': “' + phrase + '” is a chip')
      let proposal
      try { proposal = say(sample, phrase) } catch (error) {
        assert.match(error.message, /^I can’t make that a rule yet\. I can make one like “.+”\.$/, id + ': “' + phrase + '”')
        assert.equal(acts, null, id + ': “' + phrase + '” was refused: ' + error.message)
        continue
      }
      assert.ok(proposal.workshop, id + ': “' + phrase + '” changed nothing: ' + proposal.reply)
      assert.ok(acts && acts(proposal.workshop), id + ': “' + phrase + '” did not act')
      acted++
    }
    assert.ok(acted >= 10, id + ': ' + acted + ' of 12 acted')
  }
})

test('the library lists all three: each phrase parses on its sample, each rule phrase changes the next drag, and "What can this do?" works on each board', () => {
  for (const id of ['impact-effort', 'reorg-sandbox', 'goals-owners']) {
    const entry = catalogEntry(id)
    assert.ok(listedEntries().includes(entry), id + ' is listed')
    assert.match(entry.loop.src, new RegExp('/library/' + id + '\\.svg$'))
    const sample = catalogSample(id, samples)
    assert.equal(entryOfBoard(sample).id, id)
    const offered = startersFor(entry, sample, null, { all: true })
    for (const edit of entry.edits) assert.ok(offered.some(item => item.edit === edit), id + ': no phrase for ' + edit)
    for (const kind of entry.rules) {
      const phrase = offered.find(item => item.rule === kind)
      assert.ok(phrase.changes(sample, say(sample, phrase.text).workshop), id + ': “' + phrase.text + '” changes no drag')
    }
    const moves = boardMoves(sample)
    assert.ok(moves.length >= 6, id + ': ' + moves.length + ' moves')
    for (const move of moves) assert.doesNotThrow(() => say(sample, move.text), id + ': “' + move.text + '”')
  }
})

test('every phrase offered on the three boards, and their structure sentences, is kept by the server’s whole save as proposed', () => {
  const places = board => board.cards.map(item => [item.id, item.laneId, item.parentId ?? null, item.role ?? null, item.owner ?? null, item.label, JSON.stringify(item.fields ?? null)].join('|')).sort()
  const extra = {
    'impact-effort': ['Move Rewrite billing to Later', 'Do now holds 4', 'Score Audit log impact 2, effort 1'],
    'reorg-sandbox': ['Move Jo Park, Growth under Priya Rao, VP Eng', 'Sam Lee is not a contractor', ['name, role, manager', 'Noor Ali, manager, Kai Wong, Platform', 'Eli Ford, engineer, Noor Ali'].join('\n')],
    'goals-owners': ['Give Self-serve upgrades 30% to Platform', 'Move what is under Onboarding under 10 min to Sales too'],
  }
  let kept = 0
  for (const id of Object.keys(extra)) {
    const sample = catalogSample(id, samples)
    const phrases = [...startersFor(catalogEntry(id), sample, null, { all: true }).map(item => item.text), ...extra[id]]
    for (const phrase of phrases) {
      const proposal = say(sample, phrase)
      if (!proposal?.workshop) continue
      const out = replaceWorkshop(sample, proposal.workshop, { revision: 3, current: 3, userId: 'u1', actor: tim })
      assert.ok(out.workshop, id + ': “' + phrase + '” was proposed but the save refused it: ' + out.refused?.reason)
      assert.deepEqual(places(out.workshop), places(proposal.workshop), id + ': “' + phrase + '” was kept differently')
      assert.deepEqual(out.workshop.nest, proposal.workshop.nest, id + ': “' + phrase + '” nest')
      kept++
    }
  }
  assert.ok(kept >= 25, kept + ' kept')
  // Under carry, a whole save that shows a different carry than the server works out is refused.
  const carry = say(goals(), 'When I move a key result, bring its initiatives along').workshop
  const kept0 = replaceWorkshop(goals(), carry, { revision: 1, current: 1, userId: 'u1', actor: tim }).workshop
  const shown = applyWorkshopEdits(goals(), owner('fast-onboarding', 'platform')).workshop
  assert.equal(replaceWorkshop(kept0, { ...shown, behaviour: kept0.behaviour }, { revision: 2, current: 2, userId: 'u1', actor: tim }).refused.reason, 'The board changed while you were dragging. Try again.')
})

test('exec’s check_move on an org chart is the drag’s verdict; the server plays a 2 by 2 drag and a drop on a team as the board stands', () => {
  const slate = { creative: { revision: 2, model: { kind: 'workshop', workshop: org() } } }
  assert.deepEqual(checkMove(slate, { card: 'Tom Berg', under: 'VP Sales' }).refused.sentence, 'Open roles don’t manage. VP Sales is an open role.')
  assert.ok(checkMove(slate, { card: 'Tom Berg', under: 'Jo Park, Growth' }).ok)
  const board = org()
  for (const item of board.cards) for (const target of board.cards.filter(other => other.laneId === 'org')) {
    assert.equal('ok' in checkNestMove(board, { id: item.id }, { under: { id: target.id } }), nestLegal(board, item.id).some(({ spot }) => spot.under === target.id), item.id + ' under ' + target.id)
  }
  const [score] = readWorkshopChanges([{ edits: [{ kind: 'score_card', card: { id: 'billing' }, x: 3, y: 3 }], cardId: 'billing' }])
  assert.equal(quadrant(playWorkshopChanges(matrix(), [score]).workshop, 'billing'), 'later')
  const [give] = readWorkshopChanges([{ edits: [{ kind: 'set_owner', card: { id: 'self-serve' }, owner: 'platform', carry: [] }], cardId: 'self-serve' }])
  assert.equal(card(playWorkshopChanges(goals(), [give]).workshop, 'self-serve').owner, 'platform')
})
