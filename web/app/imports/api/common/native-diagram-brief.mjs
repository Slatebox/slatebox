import signInOutage from './sign-in-outage.mjs'
import interviews from './interview-notes-slate.mjs'
import callStatus from './call-status-slate.mjs'

const maxBriefLength = 1200
const invalidText = /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
const playableRequest = /^(?:create|build|make|draw) (?:me )?an? (?:interactive|playable) (?:map|flow|slate)\b/i
const sources = new Map([
  ['sign-in-outage', signInOutage],
  ['call-status', callStatus],
  ['interview-notes', interviews],
])

export const nativeDiagramSources = Object.freeze([...sources.keys()])

function normalizeBrief(input) {
  const brief = typeof input === 'string' ? input.trim() : ''
  if (!brief || brief.length > maxBriefLength || invalidText.test(brief.replaceAll('->', '→'))) {
    throw new Error('Use a question or a few lines of steps, up to 1,200 characters.')
  }
  return brief
}

export function readCreationBrief(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const brief = normalizeBrief(params.get('brief'))
  for (const key of params.keys()) {
    if (!['brief', 'source', 'play'].includes(key) || params.getAll(key).length !== 1) {
      throw new Error('This slate link has unknown or duplicate options.')
    }
  }
  const source = params.get('source')
  if (source !== null && source !== 'pilot-budget' && !sources.has(source)) throw new Error('Unknown source for this slate.')
  const play = params.get('play')
  if (play !== null && (play !== '1' || source)) throw new Error('Invalid interactive slate link.')
  return { brief, source, play: play === '1' || (!source && playableRequest.test(brief)) }
}

function splitSteps(line) {
  const from = /^(?:draw|map|diagram|show|build|create)\s+(?:(?:a|the)\s+)?(?:flow(?:chart)?|diagram|path)\s+from\s+/i
  const terms = from.test(line)
    ? line.replace(from, '').split(/\s*(?:→|->)\s*|\s+to\s+/i)
    : line.split(/\s*(?:→|->)\s*|,?\s+(?:then|followed by)\s+/i)
  if (terms.some(term => !term.trim())) throw new Error('Give each connected step a name.')
  return terms.map(term => term.trim())
}

const briefRows = brief => brief.split(/\r?\n/).map(line => line.trim().replace(/^[-*]\s+/, '')).filter(Boolean)

// Each row of a brief is a path of named steps, in the order its author wrote them.
export function nativeBriefPaths(input) {
  return briefRows(normalizeBrief(input)).map(splitSteps)
}

// The free drawing path uses the steps supplied by its author. Named steps in
// another row can extend or branch from the same native SVG object.
export function nativeSlateFromBrief(input, source = null) {
  const brief = normalizeBrief(input)
  if (source !== null && !sources.has(source)) throw new Error('Unknown source for this slate.')
  const rows = briefRows(brief)
  const paths = rows.map(splitSteps)
  // Named after its first note, never a whole row of steps glued together ("A → B").
  const board = source ? JSON.parse(JSON.stringify(sources.get(source))) : {
    options: { name: (paths[0]?.[0] || rows[0]).slice(0, 120) },
    nodes: [],
  }
  board.options.creationBrief = brief
  if (source) {
    board.options.briefSource = source
    // The source already supplies the drawing. A single unstructured brief opens
    // the conversation. Explicit paths and pasted rows add content to the source.
    if (paths.length === 1 && paths[0].length === 1) return board
  }

  // A step names a source note by its words, however that note wraps its lines.
  const named = text => text.replace(/\s+/g, ' ').trim().toLowerCase()
  const existing = new Map(board.nodes.map(node => [named(node.options.text), node]))
  let y = Math.max(0, ...board.nodes.map(node => node.options.yPos + node.options.height + 48))
  for (const path of paths) {
    let previous
    let x = 36
    let tallest = 76
    for (const label of path) {
      const key = named(label)
      let node = existing.get(key)
      if (!node) {
        if (existing.size >= 24) throw new Error('Use up to 24 distinct steps per brief.')
        const width = label.length > 60 ? 292 : 218
        const height = Math.max(76, Math.ceil(label.length / (width / 12)) * 24 + 30)
        node = {
          options: {
            id: 'step-' + (existing.size + 1), text: label, xPos: x, yPos: y + 32, width, height,
            fontSize: 18, shapeHint: 'rectangle', backgroundColor: previous ? '#d8e7df' : '#f2d695',
            foregroundColor: '#243b32', borderColor: '#789082', borderWidth: 1,
          },
          relationships: { associations: [] },
        }
        board.nodes.push(node)
        existing.set(key, node)
      }
      if (previous && previous !== node) {
        const edges = previous.relationships.associations
        const parentId = previous.options.id
        const childId = node.options.id
        if (!edges.some(edge => edge.childId === childId)) {
          edges.push({ id: parentId + '-' + childId, parentId, childId, lineType: 'straight',
            lineColor: '#516b60', lineWidth: 3, showChildArrow: true })
        }
      }
      tallest = Math.max(tallest, node.options.height)
      x = node.options.xPos + node.options.width + 96
      previous = node
    }
    y += tallest + 64
  }
  return board
}
