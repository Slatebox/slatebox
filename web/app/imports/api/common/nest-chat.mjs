// What a person says to a nested board (dragology final.md §3.4, §3.5, §3.9, D4): Sort the evidence, a
// Discovery tree, Break down a problem, an Incident review. Its rules ("Weight by ARR", "Piles hold at most
// 7", "Drops in empty space go to Unsorted", "Let solutions sit under the outcome for now", "Warn instead
// of blocking", "Group Pricing and Billing into Money") and its structure ("Move CSV import under Data
// trust", "Merge Onboarding and First-run", "Turn the top 3 piles into a discovery tree") become the engine's
// edits, made by its one reducer, so a sentence, a drag and an agent's exec are decided by the same rules in
// the same words. Questions ("Which opportunities have no solutions yet?", "Why can't I move CSV import
// under the outcome?") are answered from the board, with nothing changed. Rules read roles and fields, never
// a card's words: a sentence names cards only to say which ones to move.
import { applyWorkshopEdits, workshopReferences, workshopRules, workshopRulesLoaded } from 'slateboxjs/workshops/model'

const N = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)'
const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const number = text => /^\d+$/.test(text) ? Number(text) : words.indexOf(text.toLowerCase())
const listOf = text => text.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)\s*/).filter(Boolean)
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = iso => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? null : at.getDate() + ' ' + months[at.getMonth()] }
const plural = role => /[^aeiou]y$/.test(role) ? role.slice(0, -1) + 'ies' : /(?:s|sh|ch|x)$/.test(role) ? role + 'es' : role + 's'
const names = items => items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items.at(-1) : items[0] ?? ''

function refused(reason) {
  const error = Error(reason)
  error.code = 'refused'
  return error
}

const rules = board => board.behaviour?.rules ?? []
const ruleOf = (board, kind, test = () => true) => rules(board).find(rule => rule.kind === kind && test(rule))
/** A rule set: the board's rule of this kind changed (it keeps its id; the diff says ~), or a new one added. */
const replace = (board, kind, body, test) => {
  const old = ruleOf(board, kind, test)
  if (!old) return [{ kind: 'add_rule', rule: { kind, ...body } }]
  // Only what a rule edit changes: the role a rule is about, and a square, stay with the rule.
  const { role: _role, quadrant: _quadrant, ...change } = body
  return [{ kind: 'set_rule', rule: old.id, on: true, ...change }]
}

/** The roles a board knows: on its cards and in its rules. */
const rolesOf = board => [...new Set([...board.cards.flatMap(card => card.role ? [card.role] : []),
  ...rules(board).flatMap(rule => rule.kind === 'nests' ? [rule.role, ...rule.under] : rule.role ? [rule.role] : [])])]
/** "solutions", "an opportunity", "the outcome": a role this board knows, or null. */
const roleNamed = (board, text) => {
  const word = String(text).trim().toLowerCase().replace(/^(?:an?|the|our|each|every)\s+/, '')
  return rolesOf(board).find(role => role === word || plural(role) === word) ?? null
}
/** A role a card may sit under: one the board knows, or a new word ("a theme"), said in the singular. */
const parentRole = (board, text) => roleNamed(board, text) ?? (word => /^[a-z]{3,24}$/.test(word) ? word.replace(/ies$/, 'y').replace(/(s|sh|ch|x)es$/, '$1').replace(/([^s])s$/, '$1') : null)(
  String(text).trim().toLowerCase().replace(/^(?:an?|the|our)\s+/, ''))
const fieldNamed = (board, text) => (board.nest?.fields ?? []).find(field => field.id === text.toLowerCase() || field.label.toLowerCase() === text.toLowerCase())

/** A sentence about a nested board: `{ edits }`, `{ reply }`, or null when it is not one. */
function nestSentence(board, text, actor) {
  const refs = workshopReferences(board)
  // A card by its name, or by its role when one card has it ("the outcome").
  const card = name => refs.cards.attempt(String(name).trim().replace(/^the\s+(.+?)\s+pile$/i, '$1')) ?? refs.cards.attempt(String(name).trim()) ?? (role => {
    const only = role ? board.cards.filter(item => item.role === role) : []
    return only.length === 1 ? only[0] : null
  })(roleNamed(board, name))
  const lane = name => refs.lanes.attempt(String(name).trim())
  const main = board.lanes[0], tray = board.lanes[1]
  let m

  // Questions, answered from the board.
  if ((m = /^why\s+(?:can(?:'|’|no)?t|won(?:'|’)t|doesn(?:'|’)t)\s+(?:i|we|it)\s+(?:move|drag|put)\s+(.+?)\s+(?:under|into|in|to|onto)\s+(?:the\s+)?(.+?)\??$/i.exec(text)) && card(m[1])) {
    const what = card(m[1]), target = card(m[2]) ?? lane(m[2])
    if (!target) return null
    const edit = { kind: 'nest_card', card: { id: what.id }, ...(target.laneId ? { under: { id: target.id } } : { lane: { id: target.id } }) }
    const made = applyWorkshopEdits(board, [edit])
    if (!('refused' in made)) return { reply: what.label + ' can go ' + (target.laneId ? 'under ' : 'to ') + target.label + '.' }
    const reason = made.refused.reason
    const rule = rules(board).find(item => {
      if (!item.on) return false
      const alone = applyWorkshopEdits({ ...board, behaviour: { ...board.behaviour, rules: [{ ...item, severity: 'refuse' }] } }, [edit])
      return 'refused' in alone && alone.refused.reason === reason
    })
    const who = rule ? (rule.set.via === 'preset' ? ' That rule came with the board.' : ' ' + rule.set.by + ' set that rule' + (day(rule.set.at) ? ' on ' + day(rule.set.at) : '') + '.') : ''
    return { reply: reason + who }
  }
  if ((m = /^which\s+(.+?)\s+(?:have|has)\s+no\s+(.+?)(?:\s+(?:yet|under\s+(?:them|it)))*\??$/i.exec(text))) {
    const parent = roleNamed(board, m[1]), child = roleNamed(board, m[2])
    if (parent && child) {
      const bare = board.cards.filter(item => item.role === parent && !board.cards.some(kid => kid.parentId === item.id && kid.role === child))
      return { reply: bare.length ? names(bare.map(item => item.label)) + (bare.length === 1 ? ' has no ' : ' have no ') + plural(child) + ' yet.' : 'Every ' + parent + ' has ' + (/^[aeiou]/.test(child) ? 'an ' : 'a ') + child + '.' }
    }
  }
  if (/\?$/.test(text)) return null

  // The rules.
  if ((m = /^(?:weight|rank|sort|order)\s+(?:the\s+)?(?:piles\s+)?by\s+(?:the\s+)?(?:number\s+of\s+)?(.+)$/i.exec(text))) {
    const said = m[1].trim()
    const by = /^(?:notes?|cards?|evidence|count|quotes?)$/i.test(said) ? 'count' : /^(?:customers?|people|sources?|accounts?|companies|users?)$/i.test(said) ? 'sources' : fieldNamed(board, said)?.id
    if (!by) throw refused('Cards on this board carry no ' + said + '. Say “Track ' + said + '” first, then give cards their numbers.')
    return { edits: replace(board, 'rank', { by }) }
  }
  // "Piles hold at most 7; split anything bigger": the limit is set and nothing moves (a pile over it shows so).
  if ((m = new RegExp('^(?:an?\\s+|each\\s+|every\\s+)?(.+?)\\s+(?:holds?|can\\s+hold|takes?)\\s+(?:at\\s+most\\s+|up\\s+to\\s+|only\\s+)?' + N + '(?:\\s+[a-z]+)?(?:\\s*[,;:–—-]\\s*split\\s+(?:anything|any|the\\s+ones?)\\s+(?:bigger|larger))?$', 'i').exec(text))) {
    const role = roleNamed(board, m[1])
    if (role) return { edits: replace(board, 'children', { role, max: number(m[2]) }, rule => rule.role === role) }
  }
  if ((m = /^(?:drops?|cards?|notes?)\s+(?:let\s+go\s+|dropped\s+)?in\s+empty\s+space\s+(?:go(?:es)?\s+(?:to|into)\s+(?:the\s+)?(.+)|starts?\s+a\s+(?:new\s+)?pile)$/i.exec(text))) {
    if (m[1] && lane(m[1])?.id !== tray.id) return null
    return { edits: replace(board, 'emptyDrop', { drop: m[1] ? 'unsorted' : 'new-pile' }) }
  }
  if ((m = new RegExp('^(?:let\\s+)?cards?\\s+nest\\s+(?:up\\s+to\\s+|at\\s+most\\s+)?' + N + '\\s+levels?\\s+deep$', 'i').exec(text))) {
    return { edits: replace(board, 'depth', { max: number(m[1]) }) }
  }
  if ((m = /^(?:let|allow)\s+(.+?)\s+(?:to\s+)?sit\s+under\s+(?:an?\s+|the\s+)?(.+?)(?:\s+(?:for\s+now|too|as\s+well))*$/i.exec(text))) {
    const role = roleNamed(board, m[1]), under = parentRole(board, m[2])
    if (role && under) {
      const rule = ruleOf(board, 'nests', item => item.role === role)
      if (!rule) return { reply: 'Nothing holds ' + plural(role) + ' back: they can sit under any card already.' }
      if (rule.under.includes(under)) return { reply: plural(role)[0].toUpperCase() + plural(role).slice(1) + ' may sit under ' + plural(under) + ' already.' }
      return { edits: replace(board, 'nests', { role, under: [...rule.under, under] }, item => item.role === role) }
    }
  }
  if ((m = /^(.+?)\s+(?:sit|go|belong)\s+only\s+under\s+(?:an?\s+|the\s+)?(.+)$|^(.+?)\s+must\s+sit\s+under\s+(?:an?\s+|the\s+)?(.+)$/i.exec(text))) {
    const role = roleNamed(board, m[1] ?? m[3]), under = listOf((m[2] ?? m[4]).replace(/\s+or\s+/gi, ', ')).map(item => parentRole(board, item))
    if (role && under.length && under.every(Boolean)) return { edits: replace(board, 'nests', { role, under }, item => item.role === role) }
  }
  if (/^(?:just\s+)?warn\s+(?:me\s+|us\s+)?instead\s+of\s+(?:blocking|refusing|stopping)(?:\s+(?:me|us))?$/i.test(text)) {
    const strict = rules(board).filter(rule => rule.on && rule.severity === 'refuse' && ['nests', 'children', 'depth', 'quadrant', 'parent', 'contains', 'sameOwnerAs'].includes(rule.kind))
    if (!strict.length) return { reply: 'Nothing on this board blocks a move now: its rules only warn.' }
    return { edits: strict.map(rule => ({ kind: 'set_rule', rule: rule.id, severity: 'warn' })) }
  }
  if ((m = /^(?:stop|block)\s+(?:me|us)\s+(?:when|if)\s+(?:an?\s+)?(.+?)\s+(?:is\s+not|isn(?:'|’)t|is)\s+under\s+(?:an?\s+|the\s+)?(.+)$/i.exec(text))) {
    const role = roleNamed(board, m[1]), under = roleNamed(board, m[2])
    if (role && under) {
      const rule = ruleOf(board, 'nests', item => item.role === role)
      if (rule) return { edits: [{ kind: 'set_rule', rule: rule.id, severity: 'refuse', on: true, ...(!rule.under.includes(under) && { under: [...rule.under, under] }) }] }
      return { edits: [{ kind: 'add_rule', rule: { kind: 'nests', role, under: [under] } }] }
    }
  }

  // The structure.
  if ((m = /^merge\s+(.+?)\s+(into|with|and)\s+(.+)$/i.exec(text))) {
    const a = card(m[1]), b = card(m[3])
    if (a && b) return { edits: [/^into$/i.test(m[2]) ? { kind: 'merge_cards', card: { id: a.id }, into: { id: b.id } } : { kind: 'merge_cards', card: { id: b.id }, into: { id: a.id } }] }
  }
  if ((m = /^group\s+(.+?)\s+into\s+(?:a\s+theme\s+called\s+|a\s+theme\s+named\s+)?(.+)$/i.exec(text))) {
    const items = listOf(m[1]).map(card)
    const label = m[2].trim()
    if (items.length >= 2 && items.every(Boolean) && !card(label)) {
      const depth = ruleOf(board, 'depth')
      const deeper = depth && depth.max < 2 ? replace(board, 'depth', { max: 2 }) : []
      return { edits: [...deeper, { kind: 'add_card', lane: { id: main.id }, label, role: 'theme' }, ...items.map(item => ({ kind: 'nest_card', card: { id: item.id }, under: label }))] }
    }
  }
  if ((m = new RegExp('^turn\\s+(?:the\\s+)?top\\s+' + N + '\\s+(?:piles\\s+)?into\\s+a\\s+discovery\\s+tree$', 'i').exec(text)) && workshopRulesLoaded('nest')) {
    const top = workshopRules('nest').order(board, main.id).slice(0, number(m[1])).map(id => board.cards.find(item => item.id === id))
    if (!top.length) throw refused('There are no piles to turn into a tree yet.')
    const outcome = card('Our outcome') ? 'Our outcome (new)' : 'Our outcome'
    // Drawn as a tree, with a tree's rules: opportunities under the outcome, notes under them, three deep. A rule
    // the piles had of the same kind is changed in place (its id kept), new ones are added, and the piles' others
    // removed last, so a whole save of it is said as the same rule edits (behaviourEditsBetween).
    const wanted = [{ kind: 'nests', role: 'opportunity', under: ['outcome'] }, { kind: 'nests', role: 'note', under: ['opportunity', 'pile'] }, { kind: 'depth', max: 3 }]
    const kept = new Set()
    const ruled = wanted.map(({ kind, ...body }) => {
      const old = ruleOf(board, kind, rule => !kept.has(rule.id) && (kind !== 'nests' || rule.role === body.role))
      if (!old) return { kind: 'add_rule', rule: { kind, ...body } }
      kept.add(old.id)
      const { role: _role, ...change } = body
      return { kind: 'set_rule', rule: old.id, on: true, severity: 'refuse', ...change }
    })
    return { edits: [{ kind: 'set_layout', layout: 'tree' }, ...ruled.filter(edit => edit.kind === 'add_rule'), ...ruled.filter(edit => edit.kind === 'set_rule'),
      ...rules(board).filter(rule => !kept.has(rule.id)).map(rule => ({ kind: 'remove_rule', rule: rule.id })), { kind: 'add_card', lane: { id: main.id }, label: outcome, role: 'outcome' },
      ...top.flatMap(item => [{ kind: 'nest_card', card: { id: item.id }, under: outcome }, { kind: 'set_role', card: { id: item.id }, role: 'opportunity' }])] }
  }
  if ((m = /^(?:draw|show)\s+(?:it|this|the\s+board)\s+as\s+(?:a\s+)?(tree|piles|clusters)$/i.exec(text))) {
    return { edits: [{ kind: 'set_layout', layout: /^tree$/i.test(m[1]) ? 'tree' : 'clusters' }] }
  }
  if ((m = /^start\s+a\s+(?:new\s+)?pile\s+(?:called\s+|named\s+)?(.+?)\s+with\s+(.+)$/i.exec(text)) && card(m[2])) {
    return { edits: [{ kind: 'start_pile', card: { id: card(m[2]).id }, label: m[1].trim() }] }
  }
  if ((m = /^(?:move|put|drag)\s+(.+?)\s+(?:to|into|under|onto|in)\s+(?:the\s+)?(.+?)$/i.exec(text)) && card(m[1])) {
    const what = card(m[1]), target = card(m[2]) ?? lane(m[2])
    if (target) return { edits: [{ kind: 'nest_card', card: { id: what.id }, ...(target.laneId ? { under: { id: target.id } } : { lane: { id: target.id } }) }] }
  }
  if ((m = /^add\s+(?:an?\s+)?([a-z][a-z ]{0,23}?)\s+(?:called|named)\s+(.+?)(?:\s+(?:to|under|in|into)\s+(?:the\s+)?(.+))?$/i.exec(text))) {
    const noun = m[1].trim().toLowerCase()
    const target = m[3] ? card(m[3]) ?? lane(m[3]) : null
    if (m[3] && !target) return null
    const role = /^(?:note|card|item)$/.test(noun) ? undefined : roleNamed(board, noun) ?? (/^[a-z]+$/.test(noun) ? noun : undefined)
    return { edits: [{ kind: 'add_card', lane: { id: target && !target.laneId ? target.id : target?.laneId ?? main.id }, label: m[2].trim(),
      ...(target?.laneId && { under: { id: target.id } }), ...(role && { role }) }] }
  }
  if ((m = /^(.+?)\s+(?:came|comes)\s+from\s+(.+)$|^(.+?)\s+is\s+from\s+(.+)$/i.exec(text)) && card(m[1] ?? m[3])) {
    return { edits: [{ kind: 'set_source', card: { id: card(m[1] ?? m[3]).id }, source: (m[2] ?? m[4]).trim() }] }
  }
  if ((m = /^track\s+(?:the\s+)?(.+)$/i.exec(text)) && !card(m[1])) {
    const label = m[1].trim()
    return { edits: [{ kind: 'add_field', label, ...(/\b(?:arr|mrr|acv|revenue|spend|budget)\b/i.test(label) && { currency: '$' }) }] }
  }
  if ((m = /^(?:set\s+)?(.+?)(?:'|’)s\s+(.+?)\s+(?:is|to)\s+\$?\s?(\d+(?:[.,]\d+)?)\s*(k|m)?$/i.exec(text)) && card(m[1]) && fieldNamed(board, m[2])) {
    return { edits: [{ kind: 'set_field', card: { id: card(m[1]).id }, field: fieldNamed(board, m[2]).id, value: Math.round(Number(m[3].replace(',', '.')) * ({ k: 1e3, m: 1e6 }[m[4]?.toLowerCase()] ?? 1)) }] }
  }
  if ((m = /^make\s+(.+?)\s+(?:an?|the)\s+([a-z][a-z ]{0,23})$/i.exec(text)) && card(m[1])) {
    return { edits: [{ kind: 'set_role', card: { id: card(m[1]).id }, role: roleNamed(board, m[2]) ?? m[2].trim().toLowerCase() }] }
  }
  if ((m = /^rename\s+(.+?)\s+to\s+(.+)$/i.exec(text)) && card(m[1])) return { edits: [{ kind: 'rename_card', card: { id: card(m[1]).id }, label: m[2].trim() }] }
  if ((m = /^(?:remove|delete|drop)\s+(.+)$/i.exec(text)) && card(m[1])) return { edits: [{ kind: 'remove_card', card: { id: card(m[1]).id } }] }
  // A rule this board can't say yet: the honest answer, with the nearest rule it can make (never a silent no-op).
  if (/\b(?:can(?:'|’)?t|cannot|only|must|never|at\s+most|no\s+more\s+than|always|may\s+not|skip)\b/i.test(text)) {
    const [child, parent] = (() => { const rule = ruleOf(board, 'nests'); return rule ? [rule.role, rule.under[0]] : ['note', 'pile'] })()
    throw refused('I can’t make that a rule yet. I can make one like “' + plural(child)[0].toUpperCase() + plural(child).slice(1) + ' sit only under ' + plural(parent) + '” or “' +
      (board.nest?.layout === 'clusters' ? 'Piles hold at most 7' : 'Cards nest up to 3 levels deep') + '”.')
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Impact × effort, the reorg sandbox and goals & owners (dragology final.md §3.6–3.8): the engine's nestPlus edits.

const squares = [['do-now', 'Do now', false, true], ['plan', 'Plan it', true, true], ['later', 'Later', false, false], ['skip', 'Skip', true, false]]
const squareNamed = text => squares.find(([id, label]) => label.toLowerCase() === String(text).trim().toLowerCase().replace(/^the\s+/, '') || id === String(text).trim().toLowerCase())
const axesOf = board => board.nest?.layout === 'matrix' ? board.nest.axes.map(id => board.nest.fields.find(field => field.id === id)) : null
const ownerNamed = (board, text) => (board.nest?.owners ?? []).find(owner => owner.label.toLowerCase() === String(text).trim().toLowerCase().replace(/^(?:the\s+)?(.+?)(?:\s+team)?$/, '$1') ||
  owner.label.toLowerCase() === String(text).trim().toLowerCase())
/** A yes/no field by its name, singular or plural ("contractor", "Contractors", "remote"). */
const flagNamed = (board, text) => (board.nest?.fields ?? []).find(field => field.flag && [field.label.toLowerCase(), plural(field.label.toLowerCase()), field.id].includes(String(text).trim().toLowerCase().replace(/^(?:an?|the)\s+/, '')))
const below = (board, id) => { const out = []; const visit = key => board.cards.filter(card => card.parentId === key).forEach(card => { out.push(card); visit(card.id) }); visit(id); return out }

/** A pasted list of people (name, role, manager): one add_card per row, a manager before the people under them. */
function pastedPeople(board, raw) {
  const lines = String(raw ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const cells = line => line.split(/\t|\s*[,;]\s*/).map(cell => cell.trim().replace(/^"|"$/g, ''))
  const head = cells(lines[0]).map(cell => cell.toLowerCase())
  const at = { name: head.findIndex(cell => /^(?:name|person|who)$/.test(cell)), role: head.findIndex(cell => /^(?:role|title|job)$/.test(cell)),
    manager: head.findIndex(cell => /^(?:manager|reports\s+to|boss|lead)$/.test(cell)) }
  if (at.name < 0 || at.manager < 0) return null
  const rows = lines.slice(1).map(cells).filter(row => row[at.name])
  const known = new Set(board.cards.map(card => card.label.toLowerCase()))
  const edits = [], placed = new Set()
  for (let round = 0; round < rows.length && placed.size < rows.length; round++) {
    for (const row of rows) {
      const name = row[at.name]
      if (placed.has(name)) continue
      const boss = row[at.manager] ?? ''
      if (boss && !known.has(boss.toLowerCase()) && rows.some(other => other[at.name] === boss) && !placed.has(boss)) continue
      const role = at.role >= 0 && row[at.role] ? row[at.role].toLowerCase() : undefined
      edits.push({ kind: 'add_card', lane: { id: board.lanes[boss ? 0 : 1].id }, label: name, ...(role && /^[a-z][a-z -]{0,23}$/.test(role) && { role }), ...(boss && { under: boss }) })
      placed.add(name)
      known.add(name.toLowerCase())
    }
  }
  return edits.length ? { edits } : null
}

/** A sentence about one of the three boards, or null. */
function moreSentence(board, text, raw, card) {
  let m
  const rules = board.behaviour?.rules ?? []
  const axes = axesOf(board)
  if (axes) {
    const [x, y] = axes
    if ((m = new RegExp('^(?:the\\s+)?(do now|plan it|later|skip)\\s+(?:square\\s+)?(?:holds?|can\\s+hold|takes?)\\s+(?:at\\s+most\\s+|up\\s+to\\s+|only\\s+)?' + N + '(?:\\s+(?:cards?|ideas?|items?))?$', 'i').exec(text))) {
      const [id] = squareNamed(m[1])
      return { edits: replace(board, 'quadrant', { quadrant: id, max: number(m[2]) }, rule => rule.quadrant === id) }
    }
    if ((m = /^(?:move|put|drag|send)\s+(.+?)\s+(?:to|into)\s+(?:the\s+)?(do now|plan it|later|skip)$/i.exec(text)) && card(m[1])) {
      const what = card(m[1]), [, , across, up] = squareNamed(m[2])
      const fit = (score, high) => high ? Math.max(5, score ?? 7) : Math.min(4, score ?? 2)
      const on = what.laneId === board.lanes[0].id
      return { edits: [{ kind: 'score_card', card: { id: what.id }, x: fit(on ? what.fields?.[x.id] : undefined, across), y: fit(on ? what.fields?.[y.id] : undefined, up) }] }
    }
    const axis = '(' + [x, y].map(field => field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
    if ((m = new RegExp('^score\\s+(.+?)\\s+' + axis + '\\s+(\\d{1,2})\\s*(?:,|and)?\\s*' + axis + '\\s+(\\d{1,2})$', 'i').exec(text)) && card(m[1])) {
      const scores = { [m[2].toLowerCase()]: Number(m[3]), [m[4].toLowerCase()]: Number(m[5]) }
      const of = field => scores[field.label.toLowerCase()] ?? scores[field.id]
      if (of(x) === undefined || of(y) === undefined) throw refused('Score it on ' + y.label + ' and ' + x.label + ', such as “Score ' + card(m[1]).label + ' ' + y.label.toLowerCase() + ' 7, ' + x.label.toLowerCase() + ' 2”.')
      return { edits: [{ kind: 'score_card', card: { id: card(m[1]).id }, x: of(x), y: of(y) }] }
    }
    if ((m = /^rename\s+the\s+axes\s+(?:to\s+)?(.+?)\s+and\s+(.+)$/i.exec(text))) {
      return { edits: [{ kind: 'rename_field', field: y.id, label: m[1].trim() }, { kind: 'rename_field', field: x.id, label: m[2].trim() }] }
    }
    if ((m = /^rename\s+(?:the\s+)?(.+?)(?:\s+axis)?\s+to\s+(.+)$/i.exec(text)) && [x, y].some(field => field.label.toLowerCase() === m[1].toLowerCase())) {
      return { edits: [{ kind: 'rename_field', field: [x, y].find(field => field.label.toLowerCase() === m[1].toLowerCase()).id, label: m[2].trim() }] }
    }
    if ((m = /^is\s+(.+?)\s+(harder|easier|bigger|smaller|more\s+valuable|less\s+valuable|more\s+important|less\s+important)\s+than\s+(.+?)\??$/i.exec(text)) && card(m[1]) && card(m[3])) {
      const a = card(m[1]), b = card(m[3]), field = /hard|eas/i.test(m[2]) ? x : y, more = /hard|big|more/i.test(m[2])
      const sa = a.fields?.[field.id], sb = b.fields?.[field.id]
      if (sa === undefined || sb === undefined) return { reply: (sa === undefined ? a : b).label + ' has no ' + field.label.toLowerCase() + ' score yet.' }
      const yes = more ? sa > sb : sa < sb
      return { reply: (sa === sb ? 'They score the same' : yes ? 'Yes' : 'No') + ' on ' + field.label.toLowerCase() + ': ' + a.label + ' ' + sa + ', ' + b.label + ' ' + sb + '.' }
    }
  }
  if (board.nest?.layout === 'tree' && board.cards.some(item => item.role === 'manager' || item.role === 'open role')) {
    const people = pastedPeople(board, raw)
    if (people) return people
    if ((m = new RegExp('^no\\s+(?:manager|one|lead)\\s+(?:(?:has|with|takes)\\s+)?(?:over|more\\s+than)\\s+' + N + '\\s+(?:direct\\s+)?reports?$', 'i').exec(text))) {
      return { edits: replace(board, 'children', { role: 'manager', max: number(m[1]) }, rule => rule.role === 'manager') }
    }
    if ((m = new RegExp('^(?:a\\s+|each\\s+|every\\s+)?managers?\\s+(?:has|have|takes?)\\s+(?:at\\s+most\\s+|up\\s+to\\s+)' + N + '\\s+(?:direct\\s+)?reports?$', 'i').exec(text))) {
      return { edits: replace(board, 'children', { role: 'manager', max: number(m[1]) }, rule => rule.role === 'manager') }
    }
    if ((m = /^(.+?)\s+(?:don(?:'|’)?t|do\s+not|can(?:'|’)?t|cannot|never)\s+manage(?:\s+anyone)?$/i.exec(text))) {
      const what = flagNamed(board, m[1])?.id ?? roleNamed(board, m[1]) ?? parentRole(board, m[1])
      if (what) {
        if (rules.some(rule => rule.kind === 'parent' && rule.not === what)) {
          const rule = rules.find(item => item.kind === 'parent' && item.not === what)
          return rule.on && rule.severity === 'refuse' ? { reply: 'That is a rule here already.' } : { edits: [{ kind: 'set_rule', rule: rule.id, on: true, severity: 'refuse' }] }
        }
        return { edits: [{ kind: 'add_rule', rule: { kind: 'parent', not: what } }] }
      }
    }
    if ((m = /^(?:every|each)\s+(.+?)\s+(?:needs|has|must\s+have)\s+(?:an?\s+|at\s+least\s+one\s+)(.+?)(?:\s+under\s+(?:them|it))?(?:\s*,?\s*(just\s+warn\s+(?:me|us)))?$/i.exec(text))) {
      const role = roleNamed(board, m[1]) ?? (/^pods?|teams?$/i.test(m[1]) ? 'manager' : null), of = flagNamed(board, m[2])?.id ?? roleNamed(board, m[2]) ?? parentRole(board, m[2])
      if (role && of) {
        const old = rules.find(rule => rule.kind === 'contains' && rule.role === role && rule.of === of)
        const severity = m[3] ? 'warn' : 'refuse'
        return { edits: old ? [{ kind: 'set_rule', rule: old.id, on: true, severity }] : [{ kind: 'add_rule', rule: { kind: 'contains', role, of, atLeast: 1, severity } }] }
      }
    }
    if ((m = /^stop\s+(?:me|us)\s+when\s+an?\s+(.+?)\s+has\s+no\s+(.+)$/i.exec(text))) {
      const role = roleNamed(board, m[1]), of = flagNamed(board, m[2])?.id ?? roleNamed(board, m[2])
      if (role && of) {
        const old = rules.find(rule => rule.kind === 'contains' && rule.role === role && rule.of === of)
        return { edits: old ? [{ kind: 'set_rule', rule: old.id, on: true, severity: 'refuse' }] : [{ kind: 'add_rule', rule: { kind: 'contains', role, of, atLeast: 1 } }] }
      }
    }
  }
  if ((m = /^(?:track|add)\s+(?:an?\s+)?(.+?)\s+(?:as\s+(?:a\s+)?)?yes(?:\s*\/\s*|\s+or\s+)no(?:\s+field)?$/i.exec(text))) {
    const label = m[1].trim().replace(/^(.)/, c => c.toUpperCase())
    return { edits: [{ kind: 'add_field', label, flag: true }] }
  }
  if ((m = /^(.+?)\s+is\s+(not\s+|no\s+longer\s+)?(?:an?\s+)?(.+)$/i.exec(text)) && flagNamed(board, m[3]) && card(m[1])) {
    return { edits: [{ kind: 'set_field', card: { id: card(m[1]).id }, field: flagNamed(board, m[3]).id, value: m[2] ? 0 : 1 }] }
  }
  if (board.nest?.owners?.length) {
    const own = rules.find(rule => rule.kind === 'sameOwnerAs')
    const mode = (value, severity) => own ? [{ kind: 'set_rule', rule: own.id, on: true, ...(value && { mode: value }), ...(severity && { severity }) }]
      : [{ kind: 'add_rule', rule: { kind: 'sameOwnerAs', mode: value ?? 'warn', severity: severity ?? 'warn' } }]
    if (/^when\s+(?:i|we)\s+move\s+(?:an?\s+)?.+?,?\s+bring\s+(?:its|their|what(?:'s|’s|\s+is)\s+under\s+it)(?:\s+.+?)?\s+(?:along|too|with\s+it)$/i.test(text) || /^bring\s+what(?:'s|’s|\s+is)\s+under\s+a\s+card\s+along$/i.test(text)) return { edits: mode('carry') }
    if (/^ask\s+(?:me\s+)?before\s+moving\s+(?:what(?:'s|’s|\s+is)\s+under\s+(?:a|the)\s+card|anything\s+i\s+didn(?:'|’)?t\s+drag)$/i.test(text)) return { edits: mode('ask') }
    if (/^(?:leave|keep)\s+what(?:'s|’s|\s+is)\s+under\s+(?:a|the)\s+card\s+(?:where\s+it\s+is|behind)$/i.test(text)) return { edits: mode('warn') }
    if ((m = /^(warn|stop)\s+(?:me|us)\s+when\s+(?:an?\s+)?(.+?)\s+is\s+owned\s+outside\s+(?:its|their)\s+.+$/i.exec(text))) return { edits: mode(null, /^stop$/i.test(m[1]) ? 'refuse' : 'warn') }
    if (/^turn\s+(?:the\s+)?ownership\s+checks?\s+off$/i.test(text)) return own ? { edits: [{ kind: 'set_rule', rule: own.id, on: false }] } : { reply: 'This board checks no owners now.' }
    if (/^turn\s+(?:the\s+)?ownership\s+checks?\s+on$/i.test(text)) return { edits: mode(null, null) }
    if ((m = /^add\s+(?:a\s+team\s+called\s+|an?\s+owner\s+called\s+)(.+)$|^add\s+(.+?)\s+as\s+(?:a\s+team|an\s+owner)$/i.exec(text))) return { edits: [{ kind: 'add_owner', label: (m[1] ?? m[2]).trim() }] }
    if ((m = /^(?:move|give|hand)\s+what(?:'s|’s|\s+is)\s+under\s+(.+?)\s+to\s+(.+?)(?:\s+too)?$/i.exec(text)) && card(m[1]) && ownerNamed(board, m[2])) {
      const top = card(m[1]), owner = ownerNamed(board, m[2])
      return { edits: [{ kind: 'set_owner', card: { id: top.id }, owner: owner.id, carry: below(board, top.id).filter(item => item.owner !== owner.id).map(item => ({ id: item.id })) }] }
    }
    if ((m = /^(?:give|move|hand|assign)\s+(.+?)\s+to\s+(.+?)$/i.exec(text)) && card(m[1]) && ownerNamed(board, m[2])) return { edits: [{ kind: 'set_owner', card: { id: card(m[1]).id }, owner: ownerNamed(board, m[2]).id }] }
    if ((m = /^(.+?)\s+(?:owns|takes)\s+(.+)$/i.exec(text)) && ownerNamed(board, m[1]) && card(m[2])) return { edits: [{ kind: 'set_owner', card: { id: card(m[2]).id }, owner: ownerNamed(board, m[1]).id }] }
    if ((m = /^who\s+owns\s+(.+?)\??$/i.exec(text)) && card(m[1])) {
      const item = card(m[1]), owner = (board.nest.owners ?? []).find(team => team.id === item.owner)
      return { reply: owner ? item.label + ' is ' + owner.label + '’s.' : 'No team owns ' + item.label + ' yet.' }
    }
  }
  return null
}

/** The nested board's conversation: `{ edits }`, `{ reply }` (a question answered), or null for any other sentence. */
export function nestChat(board, text, actor, raw = text) {
  if (board.kind !== 'nest') return null
  const refs = workshopReferences(board)
  const card = name => refs.cards.attempt(String(name).trim())
  return moreSentence(board, text, raw, card) ?? nestSentence(board, text, actor)
}
