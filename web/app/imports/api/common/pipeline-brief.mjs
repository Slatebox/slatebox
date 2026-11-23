import { validateWorkshop } from 'slateboxjs/workshops/model'
import { readNoteNumbers, samplePipeline } from 'slateboxjs/workshops/rules'

// “Make a sales pipeline with Northwind 40k, Acme 25k, Globex 60k, target 250k”. Deals are a name
// and an optional amount, and start in the first stage; “target X” sets the forecast target and
// “stages A, B, C” the open stages (Won and Lost follow them). “Make a sales pipeline” alone opens
// the sample pipeline. Server only: it brings the pipeline's rules.

export const pipelineOpener = /^make\s+a\s+(?:sales\s+)?pipeline\b/i
const instructions = 'Name the deals, like “Make a sales pipeline with Northwind 40k, Acme 25k, target 250k”.'

const slug = (label, used) => {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'deal'
  let id = /^[a-z0-9]/.test(base) ? base : 'd-' + base
  for (let n = 2; used.has(id); n++) id = base + '-' + n
  used.add(id)
  return id
}
const amountOf = words => {
  const read = readNoteNumbers(words)
  if (read.amount === undefined || read.label) throw new Error('Write the target as an amount, like “target 250k”.')
  return read
}

export function pipelineFromBrief(text) {
  let words = String(text ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]$/, '')
  if (!pipelineOpener.test(words)) throw new Error(instructions)
  words = words.replace(pipelineOpener, '').trim()
  const sample = samplePipeline()
  let stages = null, target = null
  const named = /(?:^|[,;]|\band\b)\s*(?:with\s+)?stages?\s*:?\s+(.+)$/i.exec(words)
  if (named) {
    stages = named[1].split(/\s*(?:,|\band\b)\s*/i).map(stage => stage.trim()).filter(Boolean)
    words = words.slice(0, named.index).trim()
  }
  const aim = /(?:^|[,;]|\band\b)\s*(?:with\s+)?(?:a\s+)?target(?:\s+of)?\s+([^,;]+)$/i.exec(words)
  if (aim) { target = amountOf(aim[1]); words = words.slice(0, aim.index).trim() }
  const deals = words.replace(/^with\s+/i, '').split(/\s*[,;]\s*|\s+and\s+/i).map(item => item.trim()).filter(Boolean)
  if (!deals.length && !stages && !target) return validateWorkshop(sample)
  if (words && !/^with\s/i.test(words)) throw new Error(instructions)
  const ids = new Set()
  let lanes = sample.lanes
  if (stages) {
    const open = stages.filter(stage => !/^(?:won|lost)$/i.test(stage))
    if (open.length < 1 || open.length > 3) throw new Error('Name one to three stages a deal moves through; Won and Lost follow them.')
    lanes = [
      ...open.map((label, index) => ({ id: slug(label, ids), label, probability: Math.round(((index + 1) / (open.length + 1)) * 10) / 10 })),
      { id: slug('Won', ids), label: 'Won', role: 'won' },
      { id: slug('Lost', ids), label: 'Lost', role: 'lost' },
    ]
  } else for (const lane of lanes) ids.add(lane.id)
  const currency = target?.currency ?? '$'
  const cards = deals.map(item => {
    const read = readNoteNumbers(item)
    if (!read.label) throw new Error(instructions)
    return { id: slug(read.label, ids), label: read.label, laneId: lanes[0].id, ...(read.amount !== undefined && { amount: read.amount }) }
  })
  return validateWorkshop({
    version: 1, kind: 'pipeline', title: 'Sales pipeline', forecast: { target: target?.amount ?? sample.forecast.target, currency },
    lanes, cards: deals.length ? cards : stages ? [] : sample.cards,
  })
}
