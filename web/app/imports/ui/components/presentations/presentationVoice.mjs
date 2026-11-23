// How each style talks. Without the AI, a deck's captions and kickers are written from the slate's
// own words (its root, a step's head note, the notes under it, how many there are), in the voice
// of the style: a keynote is terse, a magazine reads in chapters, a road trip counts stops. Every
// caption names what is on the slate; none is a fixed line that would fit any slate. A caption
// that would only repeat a note, or run past twelve words, gives way to the next way of saying it.
// Pure: shared by the presenter and the server.

const words = (text) => String(text || '').trim().split(/\s+/).filter(Boolean)
const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || ''

/** A note's words as a phrase inside a sentence: its first line, at most `n` words, no end stop. */
const TRAILING = /^(a|an|and|the|of|to|in|on|for|from|with|your|our|their|its|by|or|at|as|into|that|which|is|are)$/i
export function phraseOf(text, n = 5) {
  const list = words(firstLine(text).replace(/[.!?;:,]+$/, ''))
  if (!list.length) return ''
  if (list.length <= n) return list.join(' ')
  // Cut at a word, and never on a dangling "from your".
  const cut = list.slice(0, n)
  while (cut.length > 2 && TRAILING.test(cut.at(-1))) cut.pop()
  return cut.join(' ').replace(/[,;:]+$/, '')
}

const pad2 = (n) => String(n).padStart(2, '0')
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV']
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Each voice: per layout, ways to say it (tried in turn from the step's index). `c` is the step's
// context: { head, kid, next, root, count, notes, k, number, i }.
const VOICES = {
  voyage: {
    finale: [(c) => `Every world here leads back to ${c.root}. Your move.`],
    overview: [(c) => `${c.root}: ${plural(c.count, 'world', 'worlds')} on one map.`, (c) => `One map, ${plural(c.count, 'world', 'worlds')} to visit.`],
    dive: [(c) => `Touchdown on ${c.head}.`, (c) => `Closer: ${c.head}, in ${plural(c.k + 1, 'part', 'parts')}.`, (c) => `Into the orbit of ${c.head}.`],
    treeBuild: [(c) => `${c.head} grows ${plural(c.k, 'way', 'ways')}.`, (c) => `Watch ${c.head} branch out.`],
    hero: [(c) => `Hold here: ${c.kid}.`, (c) => `Hold on ${c.head}.`],
    sweep: [(c) => `${c.head} and ${c.next}, one orbit.`, (c) => `Two worlds side by side: ${c.head}, ${c.next}.`],
    compare: [(c) => `${c.head} or ${c.next}?`],
    trace: [(c) => `From ${c.head}, back to ${c.root}.`, (c) => `Every path ends at ${c.root}.`],
    bigNumber: [(c) => `${c.number}: that is ${c.head}.`],
    quote: [(c) => `${c.head}, in its own words.`],
    split: [(c) => `${c.head}, and what is behind it.`],
    group: [(c) => `${c.head}, all together.`],
    deep: [(c) => `Look closer at ${c.head}.`, (c) => `Hidden in ${c.head}.`],
  },
  stage: {
    finale: [(c) => `That's ${c.root}. Now it's yours.`],
    overview: [(c) => `${plural(c.count, 'idea', 'ideas')}. One ${c.root}.`, (c) => `${c.root}. ${plural(c.notes, 'note', 'notes')}.`],
    dive: [(c) => `${c.head}. Up close.`, (c) => `Now: ${c.head}.`],
    treeBuild: [(c) => `${c.head}, step by step.`],
    hero: [(c) => `${c.kid}. That's the point.`, (c) => `${c.head}. Remember it.`],
    sweep: [(c) => `${c.head}. ${c.next}. Together.`],
    compare: [(c) => `${c.head} versus ${c.next}.`],
    trace: [(c) => `Everything returns to ${c.root}.`],
    bigNumber: [(c) => `${c.number}. ${c.head}.`, (c) => `${c.number}. Say it again.`],
    quote: [(c) => `${c.head}, unfiltered.`],
    split: [(c) => `${c.head}, explained.`],
    group: [(c) => `${c.head}: ${c.kid}.`, (c) => `${c.head}. Next.`],
    deep: [(c) => `The fine print of ${c.head}.`],
  },
  editorial: {
    finale: [(c) => `End of issue: ${c.root} is yours to edit.`],
    overview: [(c) => `The story of ${c.root}, in ${plural(c.count, 'part', 'parts')}.`, (c) => `In this issue: ${c.root}.`],
    dive: [(c) => `Chapter ${ROMAN[c.i] || c.i}: ${c.head}.`, (c) => `A closer reading of ${c.head}.`],
    treeBuild: [(c) => `How ${c.head} is built.`],
    hero: [(c) => `A line worth framing: ${c.kid}.`, (c) => `Worth framing: ${c.head}.`],
    sweep: [(c) => `${c.head}, read beside ${c.next}.`],
    compare: [(c) => `${c.head}, read against ${c.next}.`, (c) => `Two views: ${c.head} and ${c.next}.`],
    trace: [(c) => `Every chapter returns to ${c.root}.`],
    bigNumber: [(c) => `By the numbers: ${c.number} for ${c.head}.`],
    quote: [(c) => `On ${c.head}, the slate says it best.`, (c) => `${c.head}, in the slate's words.`],
    split: [(c) => `Behind ${c.head}, the details.`, (c) => `The case for ${c.head}.`],
    group: [(c) => `Notes on ${c.head}.`],
    deep: [(c) => `The footnote to ${c.head}.`],
  },
  neon: {
    finale: [(c) => `${c.root}. Your turn. Go.`],
    overview: [(c) => `${plural(c.count, 'reason', 'reasons')}. ${c.root}. Go.`, (c) => `All of ${c.root}, at once.`],
    dive: [(c) => `Zoom: ${c.head}!`, (c) => `Straight into ${c.head}.`],
    treeBuild: [(c) => `${c.head}, ${c.k} ways, fast.`],
    hero: [(c) => `${c.kid}. Turned up.`, (c) => `${c.head}, turned up.`],
    sweep: [(c) => `${c.head} + ${c.next} = momentum.`, (c) => `${c.head}, then ${c.next}. Faster.`],
    compare: [(c) => `${c.head} vs ${c.next}. Pick one.`],
    trace: [(c) => `All roads: ${c.root}.`],
    bigNumber: [(c) => `${c.number}! ${c.head}!`],
    quote: [(c) => `${c.head}, loud and clear.`],
    split: [(c) => `${c.head}, unpacked.`],
    group: [(c) => `${c.head}. Boom.`],
    deep: [(c) => `Wait: look inside ${c.head}.`],
  },
  sketch: {
    finale: [() => 'Every doodle here is a note you can move.'],
    overview: [(c) => `Sketching ${c.root}: ${plural(c.count, 'bubble', 'bubbles')}.`, (c) => `The whole page of ${c.root}.`],
    dive: [(c) => `Zooming into ${c.head}.`],
    treeBuild: [(c) => `${c.head}, doodled ${plural(c.k, 'way', 'ways')}.`, (c) => `${c.head} → ${c.kid}.`],
    hero: [(c) => `Circle this: ${c.kid}.`, (c) => `Circle this: ${c.head}.`],
    sweep: [(c) => `Snapshots: ${c.head} & ${c.next}.`],
    compare: [(c) => `${c.head} on one side, ${c.next} on the other.`],
    trace: [(c) => `Draw the line back to ${c.root}.`],
    bigNumber: [(c) => `Big scribble: ${c.number}, ${c.head}.`],
    quote: [(c) => `Scribbled on ${c.head}.`],
    split: [(c) => `${c.head}, in the margins.`],
    group: [(c) => `Jotted down: ${c.head}.`],
    deep: [(c) => `Tiny note on ${c.head}.`],
  },
  blueprint: {
    finale: [(c) => `Spec complete: every part of ${c.root} is editable.`],
    overview: [(c) => `${c.root}: ${plural(c.count, 'module', 'modules')}, one system.`, (c) => `Plan view of ${c.root}.`],
    dive: [(c) => `Section ${c.i}: ${c.head}.`, (c) => `Detail drawing: ${c.head}.`],
    treeBuild: [(c) => `${c.head}: ${plural(c.k, 'component', 'components')}.`, (c) => `Assembling ${c.head}.`],
    hero: [(c) => `Key part: ${c.kid}.`, (c) => `Key part: ${c.head}.`],
    sweep: [(c) => `${c.head} wired to ${c.next}.`],
    compare: [(c) => `Spec: ${c.head} against ${c.next}.`],
    trace: [(c) => `Wiring ${c.head} into ${c.root}.`, (c) => `Trace it home to ${c.root}.`],
    bigNumber: [(c) => `Measured: ${c.number} for ${c.head}.`],
    quote: [(c) => `Spec note on ${c.head}.`],
    split: [(c) => `Spec sheet: ${c.head}.`],
    group: [(c) => `Module: ${c.head}.`],
    deep: [(c) => `Tolerance check: ${c.head}.`],
  },
  journey: {
    finale: [(c) => `Journey's end: ${c.root}, ready for your own route.`],
    overview: [(c) => `The route through ${c.root}: ${plural(c.count, 'stop', 'stops')}.`, (c) => `Map out: ${c.root}.`],
    dive: [(c) => `Next stop: ${c.head}.`, (c) => `Pulling in at ${c.head}.`],
    treeBuild: [(c) => `${c.head}, mile by mile.`],
    hero: [(c) => `Postcard from ${c.head}: ${c.kid}.`, (c) => `Postcard from ${c.head}.`],
    sweep: [(c) => `${c.head}, then on to ${c.next}.`],
    compare: [(c) => `A fork: ${c.head} or ${c.next}.`],
    trace: [(c) => `Stop ${c.i}: ${c.head}, on the road to ${c.root}.`, (c) => `From ${c.head}, the road home.`],
    bigNumber: [(c) => `Mile marker ${c.number}: ${c.head}.`],
    quote: [(c) => `Overheard at ${c.head}.`],
    split: [(c) => `Field notes from ${c.head}.`],
    group: [(c) => `Passing through ${c.head}.`],
    deep: [(c) => `A detour into ${c.head}.`],
  },
  calm: {
    finale: [(c) => `${c.root}: every note here is yours to change.`],
    overview: [(c) => `${c.root}, in ${plural(c.count, 'part', 'parts')}.`],
    dive: [(c) => `${c.head}, closer.`],
    treeBuild: [(c) => `${c.head} and what follows from it.`],
    hero: [(c) => `${c.head}: ${c.kid}.`, (c) => `${c.head}.`],
    sweep: [(c) => `${c.head} and ${c.next}.`],
    compare: [(c) => `${c.head} compared with ${c.next}.`],
    trace: [(c) => `${c.head} connects to ${c.root}.`],
    bigNumber: [(c) => `${c.number}: ${c.head}.`],
    quote: [(c) => `${c.head}, in the slate's words.`],
    split: [(c) => `${c.head}, in detail.`],
    group: [(c) => `${c.head}: ${c.kid}.`, (c) => `About ${c.head}.`],
    deep: [(c) => `A detail of ${c.head}.`],
  },
}

// Kickers (the small label over a caption), by style: (index, head, total) → text.
const KICKERS = {
  voyage: { overview: 'The map', step: (i, head) => `${pad2(i)} · ${head}` },
  stage: { overview: 'Overview', step: (i, head) => head },
  editorial: { overview: 'Contents', step: (i) => `Chapter ${ROMAN[i] || i}` },
  neon: { overview: 'All in', step: (i, head) => `#${pad2(i)} ${head}` },
  sketch: { overview: 'The whole page', step: (i, head) => `p. ${i} — ${head}` },
  blueprint: { overview: 'Plan view', step: (i, head) => `§${i} ${head}` },
  journey: { overview: 'The route', step: (i, head, total) => `Stop ${i} of ${total}` },
  calm: { overview: 'Overview', step: (i, head, total) => `Part ${i} of ${total}` },
}

/** The style's kicker for its overview, or for step `i` (from 1) headed by `head`. */
export function voiceKicker(styleId, i, head, total) {
  const k = KICKERS[styleId] || KICKERS.voyage
  if (i === 0) return k.overview
  return String(k.step(i, phraseOf(head, 4), total)).slice(0, 48)
}

const CAPTION_WORDS = 12

/**
 * A caption for a step of `layout` in the style's voice, from the slate's words in `ctx`. Tries the
 * voice's ways of saying it from `index` on; a way whose words are missing, too long or only a
 * note repeated (`repeats(text)`) gives way to the next. → text, or '' when none fits.
 */
export function voiceCaption(styleId, layout, ctx, index = 0, repeats = () => false) {
  const voice = VOICES[styleId] || VOICES.voyage
  // The layout's own ways first (turned by the step's index, so neighbours vary), then the
  // plain group ways.
  const own = voice[layout] || voice.group
  const ways = [...own.map((_, k) => own[(index + k) % own.length]), ...(layout === 'group' ? [] : voice.group)]
  // A way that needs a part the step does not have (no second group, no note under the head)
  // is skipped: a caption never has a hole in it.
  const say = (way) => {
    const used = []
    const probe = new Proxy(ctx, { get: (target, key) => { used.push(key); return target[key] } })
    let text = ''
    try {
      text = way(probe)
    } catch {
      return ''
    }
    const hole = used.some((key) => ctx[key] === '' || ctx[key] == null || (typeof ctx[key] === 'number' && !Number.isFinite(ctx[key])))
    return !text || hole || words(text).length > CAPTION_WORDS || repeats(text) ? '' : text
  }
  return ways.map(say).find(Boolean) || ''
}

export const VOICE_IDS = Object.keys(VOICES)
