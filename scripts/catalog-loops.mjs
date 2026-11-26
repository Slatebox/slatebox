// The library's looping pictures (library final.md §2.7, layer 1): one static SVG per catalogue entry,
// CSS keyframes only (no script), drawn from the entry's real preset (its lanes, steps or stages) and
// captioned with the rule's own sentence from the engine (behaviour.ts), so a rule change changes
// the picture. Written to web/app/public/library/<id>.svg.
//
// This is a template per board family (lanes, map, launch plan, pipeline, budget) with a scripted
// card path, not a headless Dragology replay of the drag spec: that generator is the next step.
//
//   node scripts/catalog-loops.mjs            write the files
//   node scripts/catalog-loops.mjs --check    exit 1 when a file differs (the snapshot test runs this)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { runwayMonths } from 'slateboxjs/workshops/rules'
import { catalogSamples } from 'slateboxjs/workshops/samples'
import { behaviourLines } from 'slateboxjs/workshops/behaviour'
import { catalog, catalogPreset } from 'slateboxjs/catalog'

const out = new URL('../web/app/public/library/', import.meta.url)
// The plans start on the next Monday: drawn from a fixed one, so a loop is the same file every day.
const samples = Object.fromEntries(Object.entries(catalogSamples).map(([key, make]) => [key, () => make('2026-11-23')]))
const esc = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const ink = '#24312e', paper = '#fffdf6', refuse = '#c2410c', accept = '#1f7a5c'
const fills = ['#d5e9e3', '#fbdfac', '#dedef4', '#dcebf3', '#efd7dc']

/** The sentence a loop is captioned with: the rule's own, from the engine. */
export function loopCaption(entry) {
  const board = validateWorkshop(catalogPreset(entry.id, undefined, samples))
  switch (entry.id) {
    case 'decision-path': return 'Not connected'
    // A plan: the line of its note the loop shows (a slip, working days, the snap).
    case 'launch-plan': return behaviourLines(board).find(line => /^A slip/.test(line))
    case 'customer-go-live': return behaviourLines(board).find(line => /^Days are working days/.test(line))
    case 'hiring-plan': return behaviourLines(board).find(line => /snap/.test(line))
    case 'budget': return 'The total stays fixed.'
    // A nested board: the line of its note the loop shows (how piles rank, where a solution sits, an action's warning).
    case 'sort-evidence': return behaviourLines(board).find(line => /^Piles rank/.test(line))
    case 'discovery-tree': return behaviourLines(board).find(line => /^Solutions sit/.test(line))
    case 'break-down-problem': case 'incident-review': return behaviourLines(board).find(line => /^Actions sit/.test(line))
    // Impact × effort, the reorg sandbox and goals & owners: a square's limit, open roles, the owners' rule.
    case 'impact-effort': return behaviourLines(board).find(line => /^Do now holds/.test(line))
    case 'reorg-sandbox': return behaviourLines(board).find(line => /^Open roles/.test(line))
    case 'goals-owners': return behaviourLines(board).find(line => /^A card is owned/.test(line))
    // A grid sheet: its built-in rule, the first line of its note.
    case 'printable-page': return behaviourLines(board).find(line => /^Tiles snap/.test(line))
    // A lane board or the pipeline: a line of its own "How this board behaves" note (a limit, the one the loop shows).
    default: return behaviourLines(board).filter(line => / holds \d+\.$/.test(line)).at(-1) ?? 'No rules: any card goes in any column.'
  }
}

// A still is the loop's picture without its motion: the strip under every message box and the + menu
// show stills (WCAG 2.2.2: nothing there moves on its own); the library plays one loop at a time.
let still = false

const frame = (id, body, caption, keyframes) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" role="img" class="sb-loop-svg"><style>` +
  `.c-${id}{font:600 7px system-ui,sans-serif;fill:${ink}}.t-${id}{font:5.5px system-ui,sans-serif;fill:${ink}}` +
  (still ? '' : `.m-${id},.r-${id},.d-${id}{animation:5s ease-in-out infinite}` + keyframes +
    // Reduced motion: the picture holds still wherever it is shown, an <img> included.
    `@media (prefers-reduced-motion:reduce){.m-${id},.r-${id},.d-${id}{animation:none}}`) +
  `</style><rect width="160" height="90" rx="6" fill="#faf8f2"/>${body}<text class="c-${id}" x="80" y="84" text-anchor="middle">${esc(caption)}</text></svg>\n`

function lanesLoop(entry, board, caption) {
  const id = entry.id, lanes = board.lanes.slice(0, 5), w = 150 / lanes.length
  const target = lanes.findIndex(lane => caption?.startsWith(lane.label)) >= 0 ? lanes.findIndex(lane => caption.startsWith(lane.label)) : Math.min(1, lanes.length - 1)
  let body = ''
  lanes.forEach((lane, i) => {
    const x = 5 + i * w
    body += `<rect ${i === target ? `class="d-${id}" ` : ''}x="${x + 1}" y="6" width="${w - 2}" height="64" rx="3" fill="${fills[i]}"/>` +
      `<text class="t-${id}" x="${x + w / 2}" y="14" text-anchor="middle">${esc(lane.label.slice(0, 12))}</text>`
    const full = i === target ? 2 : i === 0 ? 1 : 0
    for (let n = 0; n < full; n++) body += `<rect x="${x + 4}" y="${19 + n * 13}" width="${w - 8}" height="10" rx="2" fill="${paper}" stroke="#b9b3a3" stroke-width=".5"/>`
  })
  // The moving card: from the first lane toward the target, refused there, back home.
  const tx = 5 + target * w + 4, ty = 45
  body += `<rect class="m-${id}" x="9" y="32" width="${w - 8}" height="10" rx="2" fill="${paper}" stroke="${ink}" stroke-width=".6"/>`
  const keyframes = `@keyframes mv-${id}{0%,12%{transform:translate(0,0)}40%,60%{transform:translate(${tx - 9}px,${ty - 32}px)}52%{transform:translate(${tx - 9 + 2}px,${ty - 32}px)}56%{transform:translate(${tx - 9 - 2}px,${ty - 32}px)}88%,100%{transform:translate(0,0)}}` +
    `.m-${id}{animation-name:mv-${id}}@keyframes dm-${id}{0%,38%,66%,100%{opacity:1}44%,60%{opacity:.45;stroke:${refuse}}}.d-${id}{animation-name:dm-${id};stroke-width:1}`
  return frame(id, body, caption, keyframes)
}

function mapLoop(entry, board, caption) {
  const id = entry.id
  const at = lane => ({ x: 22 + lane.station.column * 58, y: 20 + lane.station.row * 30 })
  let body = ''
  for (const lane of board.lanes) for (const next of lane.station.next) {
    const a = at(lane), b = at(board.lanes.find(item => item.id === next))
    body += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#7d8f86" stroke-width="1.2"/>`
  }
  board.lanes.forEach((lane, i) => {
    const p = at(lane)
    body += `<circle ${i === 2 ? `class="d-${id}" ` : ''}cx="${p.x}" cy="${p.y}" r="7" fill="${fills[i % 5]}" stroke="${ink}" stroke-width=".5"/><text class="t-${id}" x="${p.x}" y="${p.y + 13}" text-anchor="middle">${esc(lane.label.slice(0, 12))}</text>`
  })
  const [a, b, c] = [at(board.lanes[0]), at(board.lanes[1]), at(board.lanes[3])]
  body += `<circle class="m-${id}" cx="${a.x}" cy="${a.y}" r="3.5" fill="#ffda75" stroke="${ink}" stroke-width=".6"/>`
  const keyframes = `@keyframes mv-${id}{0%,10%{transform:translate(0,0)}35%,45%{transform:translate(${b.x - a.x}px,${b.y - a.y}px)}70%,90%{transform:translate(${c.x - a.x}px,${c.y - a.y}px)}100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}` +
    `@keyframes dm-${id}{0%,30%,60%,100%{opacity:1}38%,52%{opacity:.35}}.d-${id}{animation-name:dm-${id}}`
  return frame(id, body, caption, keyframes)
}

function launchLoop(entry, board, caption) {
  const id = entry.id, tasks = board.cards.slice(0, 4), day = 130 / (board.launch?.day ?? 14)
  let body = `<line x1="${15 + 130 * 0.9}" y1="6" x2="${15 + 130 * 0.9}" y2="70" stroke="${accept}" stroke-width="1.2" stroke-dasharray="2 1.5"/><text class="t-${id}" x="${15 + 130 * 0.9}" y="76" text-anchor="middle">launch</text>`
  let start = 0
  tasks.forEach((task, i) => {
    const width = Math.max(10, (task.duration ?? 2) * day)
    body += `<rect ${i === tasks.length - 1 ? `class="m-${id}" ` : ''}x="${15 + start}" y="${9 + i * 15}" width="${width}" height="10" rx="2" fill="${fills[i]}" stroke="${ink}" stroke-width=".4"/><text class="t-${id}" x="${17 + start}" y="${16 + i * 15}">${esc(task.label.slice(0, 10))}</text>`
    start += width * 0.7
  })
  const keyframes = `@keyframes mv-${id}{0%,15%{transform:translate(0,0)}45%,65%{transform:translate(18px,0);fill:${refuse}}85%,100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}`
  return frame(id, body, caption, keyframes)
}

function hiringLoop(entry, board, caption) {
  const id = entry.id, hires = board.cards.slice(0, 4), week = 130 / board.hiring.weeks / 7
  const runway = runwayMonths(board)
  let body = `<text class="t-${id}" x="15" y="7">${esc('Runway with these hires: ' + runway + ' months')}</text>`
  hires.forEach((hire, i) => {
    const from = (hire.lag ?? 0) * week, width = Math.max(8, hire.duration * week)
    body += `<g${i === 2 ? ` class="m-${id}"` : ''}><rect x="${15 + from}" y="${12 + i * 15}" width="${width}" height="10" rx="2" fill="${fills[i]}" stroke="${ink}" stroke-width=".4"/>` +
      `<rect x="${15 + from + width}" y="${15.5 + i * 15}" width="${Math.max(0, 130 - from - width)}" height="3" rx="1.5" fill="#3f6f8e" opacity=".45"/></g>` +
      `<text class="t-${id}" x="${17 + from}" y="${19 + i * 15}">${esc(hire.label.slice(0, 12))}</text>`
  })
  const keyframes = `@keyframes mv-${id}{0%,15%{transform:translate(0,0)}45%,65%{transform:translate(22px,0)}85%,100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}`
  return frame(id, body, caption, keyframes)
}

function pipelineLoop(entry, board, caption) {
  return lanesLoop(entry, { ...board, lanes: board.lanes.slice(0, 5) }, caption)
}

function budgetLoop(entry, board, caption) {
  const id = entry.id, total = board.budget.total, teams = board.lanes
  let x = 8, body = ''
  teams.forEach((team, i) => {
    const width = 144 * (team.allocation ?? total / teams.length) / total
    body += `<rect ${i === 0 ? `class="m-${id}" ` : ''}x="${x}" y="24" width="${width}" height="22" fill="${fills[i]}" stroke="${ink}" stroke-width=".4"/><text class="t-${id}" x="${x + 2}" y="38">${esc(team.label.slice(0, 9))}</text>`
    x += width
  })
  body += `<text class="t-${id}" x="80" y="16" text-anchor="middle">${esc(board.budget.currency + Math.round(total / 1000) + 'k total')}</text>`
  const keyframes = `@keyframes mv-${id}{0%,15%,85%,100%{transform:scaleX(1)}45%,60%{transform:scaleX(1.25)}}.m-${id}{animation-name:mv-${id};transform-box:fill-box;transform-origin:left}`
  return frame(id, body, caption, keyframes)
}

// Piles: three piles of notes; a note carried from the second pile to the first, and the piles re-rank.
function pilesLoop(entry, board, caption) {
  const id = entry.id, piles = board.cards.filter(card => !card.parentId && card.laneId === board.lanes[0].id).slice(0, 3)
  let body = ''
  piles.forEach((pile, i) => {
    const x = 8 + i * 50, kids = board.cards.filter(card => card.parentId === pile.id).length
    body += `<g${i < 2 ? ` class="${i ? 'd' : 'r'}-${id}"` : ''}><rect x="${x}" y="8" width="44" height="12" rx="2" fill="${fills[1]}" stroke="${ink}" stroke-width=".4"/>` +
      `<text class="t-${id}" x="${x + 3}" y="16">${esc(pile.label.slice(0, 11))}</text>`
    for (let n = 0; n < kids; n++) body += `<rect x="${x + 4}" y="${24 + n * 12}" width="40" height="9" rx="2" fill="${paper}" stroke="#b9b3a3" stroke-width=".5"/>`
    body += '</g>'
  })
  body += `<rect class="m-${id}" x="62" y="48" width="40" height="9" rx="2" fill="${paper}" stroke="${ink}" stroke-width=".6"/>`
  const keyframes = `@keyframes mv-${id}{0%,12%{transform:translate(0,0)}45%,85%{transform:translate(-50px,12px)}100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}` +
    `@keyframes rk-${id}{0%,50%,100%{transform:translate(0,0)}60%,90%{transform:translate(50px,0)}}.r-${id}{animation-name:rk-${id}}` +
    `@keyframes rd-${id}{0%,50%,100%{transform:translate(0,0)}60%,90%{transform:translate(-50px,0)}}.d-${id}{animation-name:rd-${id}}`
  return frame(id, body, caption, keyframes)
}

// A tree: a card at the top, three under it, and under those; the card dragged up is refused (or flagged) and goes back.
function treeLoop(entry, board, caption) {
  const id = entry.id, root = board.cards.find(card => !card.parentId && card.laneId === board.lanes[0].id)
  const kids = board.cards.filter(card => card.parentId === root.id).slice(0, 3)
  let body = `<rect class="d-${id}" x="55" y="6" width="50" height="12" rx="2" fill="${fills[0]}" stroke="${ink}" stroke-width=".4"/><text class="t-${id}" x="58" y="14">${esc(root.label.slice(0, 13))}</text>`
  kids.forEach((kid, i) => {
    const x = 6 + i * 52
    body += `<line x1="80" y1="18" x2="${x + 24}" y2="28" stroke="#b5bdb3" stroke-width=".8"/><rect x="${x}" y="28" width="48" height="12" rx="2" fill="${fills[2]}" stroke="${ink}" stroke-width=".4"/>` +
      `<text class="t-${id}" x="${x + 3}" y="36">${esc(kid.label.slice(0, 12))}</text>`
  })
  body += `<line x1="30" y1="40" x2="30" y2="50" stroke="#b5bdb3" stroke-width=".8"/><rect class="m-${id}" x="8" y="50" width="44" height="11" rx="2" fill="${paper}" stroke="${ink}" stroke-width=".6"/>`
  const keyframes = `@keyframes mv-${id}{0%,15%{transform:translate(0,0)}45%,60%{transform:translate(50px,-34px)}52%{transform:translate(53px,-34px)}56%{transform:translate(47px,-34px)}85%,100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}` +
    `@keyframes dm-${id}{0%,40%,64%,100%{stroke:${ink}}46%,60%{stroke:${refuse};stroke-width:1.2}}.d-${id}{animation-name:dm-${id}}`
  return frame(id, body, caption, keyframes)
}

// A 2 by 2: four squares and the cards on them; a card dragged into a full Do now dims it and goes back.
function matrixLoop(entry, board, caption) {
  const id = entry.id, [xId, yId] = board.nest.axes
  const squares = [[8, 6, fills[0]], [80, 6, fills[2]], [8, 38, '#f3eee0'], [80, 38, fills[4]]]
  let body = squares.map(([x, y, fill], i) => `<rect${i ? '' : ` class="d-${id}"`} x="${x}" y="${y}" width="70" height="30" rx="2" fill="${fill}"/>`).join('') +
    `<text class="t-${id}" x="11" y="13">Do now</text>`
  for (const card of board.cards.filter(item => item.laneId === board.lanes[0].id)) {
    const x = 8 + card.fields[xId] * 14, y = 6 + (10 - card.fields[yId]) * 6
    body += `<rect${card.id === 'billing' ? ` class="m-${id}"` : ''} x="${Math.min(136, x)}" y="${Math.min(62, y)}" width="12" height="5" rx="1" fill="${paper}" stroke="${ink}" stroke-width=".4"/>`
  }
  const keyframes = `@keyframes mv-${id}{0%,15%{transform:translate(0,0)}45%,60%{transform:translate(-100px,-36px)}85%,100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}` +
    `@keyframes dm-${id}{0%,40%,64%,100%{stroke:none}46%,60%{stroke:${refuse};stroke-width:1.2}}.d-${id}{animation-name:dm-${id}}`
  return frame(id, body, caption, keyframes)
}

// A grid sheet: the tray's stamps beside a page of cells; a stamp's copy snaps into a free cell, a second one held over
// a taken cell is refused and goes back.
function gridLoop(entry, board, caption) {
  const id = entry.id, { rows, cols } = board.grid.cells
  const stamps = board.cards.filter(card => card.tile?.stamp).slice(0, 4)
  let body = stamps.map((card, i) => `<rect x="6" y="${6 + i * 15}" width="38" height="12" rx="2" fill="${fills[i % 5]}"/><text class="t-${id}" x="9" y="${14 + i * 15}">${esc(card.label.slice(0, 10))}</text>`).join('')
  body += `<rect x="56" y="3" width="56" height="72" fill="#fff" stroke="#b8bfb6" stroke-width=".6"/>`
  const w = 48 / cols, h = 64 / rows
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const taken = board.cards.some(card => card.laneId === board.lanes[1].id && card.cell && r >= card.cell.row && r < card.cell.row + (card.cell.rows ?? 1) && c >= card.cell.col && c < card.cell.col + (card.cell.cols ?? 1))
    body += `<rect${r === 0 && c === 0 ? ` class="d-${id}"` : ''} x="${(60 + c * w).toFixed(1)}" y="${(7 + r * h).toFixed(1)}" width="${(w - 1).toFixed(1)}" height="${(h - 1).toFixed(1)}" rx="1" fill="${taken ? fills[0] : '#f4f1e8'}"/>`
  }
  body += `<rect class="m-${id}" x="6" y="21" width="38" height="12" rx="2" fill="${paper}" stroke="${ink}" stroke-width=".6"/>`
  const keyframes = `@keyframes mv-${id}{0%,10%{transform:translate(0,0)}35%,48%{transform:translate(${(60 + (cols - 1) * w - 6).toFixed(1)}px,${(7 + (rows - 1) * h - 21).toFixed(1)}px)}50%{transform:translate(0,0)}62%,72%{transform:translate(54px,-14px)}90%,100%{transform:translate(0,0)}}.m-${id}{animation-name:mv-${id}}` +
    `@keyframes dm-${id}{0%,60%,76%,100%{stroke:none}64%,72%{stroke:${refuse};stroke-width:1.2}}.d-${id}{animation-name:dm-${id}}`
  return frame(id, body, caption, keyframes)
}

/** The SVG text of one entry's still: the loop's first frame, with no motion. */
export function stillSvg(entry) {
  still = true
  try { return loopSvg(entry) } finally { still = false }
}

/** The SVG text of one entry's loop. */
export function loopSvg(entry) {
  const board = validateWorkshop(catalogPreset(entry.id, undefined, samples))
  const caption = loopCaption(entry)
  if (board.lanes[0].station) return mapLoop(entry, board, caption)
  if (board.kind === 'launch-plan') return launchLoop(entry, board, caption)
  if (board.kind === 'hiring-plan') return hiringLoop(entry, board, caption)
  if (board.kind === 'pipeline') return pipelineLoop(entry, board, caption)
  if (board.kind === 'budget') return budgetLoop(entry, board, caption)
  if (board.kind === 'nest' && board.nest.layout === 'matrix') return matrixLoop(entry, board, caption)
  if (board.kind === 'nest') return board.nest.layout === 'clusters' ? pilesLoop(entry, board, caption) : treeLoop(entry, board, caption)
  if (board.kind === 'grid') return gridLoop(entry, board, caption)
  return lanesLoop(entry, board, caption)
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  mkdirSync(out, { recursive: true })
  const check = process.argv.includes('--check')
  let stale = 0
  for (const entry of catalog) {
    for (const [name, text] of [[entry.id + '.svg', loopSvg(entry)], [entry.id + '-still.svg', stillSvg(entry)]]) {
      const file = new URL(name, out)
      if (check) {
        let was = ''
        try { was = readFileSync(file, 'utf8') } catch { /* missing */ }
        if (was !== text) { stale++; console.error('Out of date: ' + name) }
      } else writeFileSync(file, text)
    }
  }
  if (check && stale) process.exit(1)
  console.log(check ? 'Every loop is up to date.' : 'Wrote ' + catalog.length + ' loops to ' + out.pathname)
}
