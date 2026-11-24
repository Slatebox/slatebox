import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useNavigate } from 'react-router-dom'
import { Box, Button, ButtonBase, Chip, IconButton, InputBase, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AddIcon from '@mui/icons-material/Add'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import ChatTurn from '../ChatTurn'
import { catalogGroups } from 'slateboxjs/catalog'
import { catalogEntry, catalogSample, entryOfBoard, listedEntries, ownEntries, searchEntries, setLibraryItems, startersFor } from '../../../api/common/library.mjs'
import libraryApi from '../../../api/client/library'
import { buildLink, BUILD_SHAPES } from './build/buildTurns.mjs'
import { categoryLabel } from '../../../api/common/library-model.mjs'

// The library (library final.md §2.3): a view inside Ask Slatebox's conversation, in the panel's
// 344px column and in the phone's sheet. Cards two to a row with a looping picture, a detail view
// with "Say it like this", and Add, which sends a plain chat message: preview, then Keep. Loaded on
// demand (the library chunk), with the catalogue and its phrases.

const css = `.sb-loop{line-height:0;border-radius:6px;overflow:hidden;background:#faf8f2}.sb-loop svg{width:100%;height:auto;display:block}
.sb-loop.paused *{animation-play-state:paused!important;animation-delay:-2.2s!important}
@media (prefers-reduced-motion: reduce){.sb-loop:not(.once) *{animation-play-state:paused!important;animation-delay:-2.2s!important}}`
let styled = false
const svgs = new Map()
/** A loop's SVG text, fetched once (our own static files) and kept. */
function useSvg(src) {
  const [text, setText] = useState(svgs.get(src) ?? '')
  useEffect(() => {
    if (svgs.has(src)) { setText(svgs.get(src)); return undefined }
    let gone = false
    fetch(src).then(res => res.ok ? res.text() : '').then(body => {
      if (!/^<svg[\s>]/.test(body.trim()) || /<script/i.test(body)) return
      svgs.set(src, body)
      if (!gone) setText(body)
    }).catch(() => { /* The card shows its name and words without the picture. */ })
    return () => { gone = true }
  }, [src])
  return text
}

const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A looping picture: it plays while `playing`, and otherwise holds a mid-drag frame. Reduced motion: a still with ▶ Play once. */
export function Loop({ entry, playing, large = false }) {
  const text = useSvg(entry.loop.src)
  const [once, setOnce] = useState(false)
  useEffect(() => { if (!styled) { styled = true; const tag = document.createElement('style'); tag.textContent = css; document.head.appendChild(tag) } }, [])
  useEffect(() => { if (!once) return undefined; const timer = setTimeout(() => setOnce(false), 5000); return () => clearTimeout(timer) }, [once])
  return <Box sx={{ position: 'relative' }}>
    <div role="img" aria-label={entry.loop.alt} className={'sb-loop' + (playing || once ? '' : ' paused') + (once ? ' once' : '')}
      style={{ aspectRatio: '16 / 9', width: '100%' }} dangerouslySetInnerHTML={{ __html: text }} />
    {large && reduced() && <Button size="small" onClick={() => setOnce(true)} sx={{ position: 'absolute', right: 4, bottom: 4 }}>▶ Play once</Button>}
  </Box>
}

// `full`: the slate holds 8 boards, the most for now, so an entry added here opens on a new slate.
function Card({ entry, playing, onOpen, onAdd, onHover, cardRef, full }) {
  // A list item with two buttons: the card itself (opens its detail) and Add. No control sits inside another.
  return <Box component="li" ref={cardRef} data-entry={entry.id} onMouseEnter={() => onHover(entry.id)} onFocus={() => onHover(entry.id)}
    sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: .75, display: 'flex', flexDirection: 'column', gap: .5, minWidth: 0 }}>
    <ButtonBase component="div" onClick={() => onOpen(entry)} aria-label={entry.name + ': ' + entry.line}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', gap: .5, borderRadius: 1, flex: '1 1 auto',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      <Loop entry={entry} playing={playing} />
      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{entry.name}</Typography>
      <Typography variant="caption" sx={{ lineHeight: 1.25, color: 'text.secondary' }}>{entry.line}</Typography>
    </ButtonBase>
    <Button size="small" variant="outlined" onClick={() => onAdd(entry)} aria-label={(full ? 'Add on a new slate: ' : 'Add ') + entry.name}
      sx={{ alignSelf: 'flex-start', minWidth: 0, py: 0 }}>{full ? 'Add on a new slate' : 'Add'}</Button>
  </Box>
}

// The shared library's components: read when the library opens (cached for the session, read again each time it
// opens, so a draft saved a moment ago is under Yours). Published community components, and the person's own.
let itemsRead = null
// Every published community component, page by page (48 a page), up to 480: the list never stops at one page.
async function communityComponents() {
  const items = []
  let cursor
  for (let page = 0; page < 10; page++) {
    const answer = await libraryApi.list({ kind: 'component', origin: 'user', limit: 48, ...(cursor && { cursor }) })
    items.push(...(answer.items ?? []))
    if (!answer.next) break
    cursor = answer.next
  }
  return { items }
}
function useLibraryItems() {
  const [, redraw] = useState(0)
  useEffect(() => {
    let gone = false
    const signedIn = Boolean(Meteor.userId())
    itemsRead = Promise.all([
      communityComponents().catch(() => ({ items: [] })),
      signedIn ? libraryApi.mine({}).catch(() => ({ items: [] })) : { items: [] },
    ]).then(([community, own]) => { setLibraryItems({ community: community.items ?? [], own: own.items ?? [] }) })
    itemsRead.then(() => { if (!gone) redraw(n => n + 1) })
    return () => { gone = true }
  }, [])
}

// A board's shape, as a small drawing for an item that has no looping picture: columns, piles, a tree, a square or a timeline.
function ShapeGlyph({ kind, layout }) {
  const ink = 'currentColor'
  const shape = kind === 'launch-plan' || kind === 'hiring-plan' ? 'timeline' : kind === 'nest' ? (layout ?? 'tree') : kind === 'map' ? 'map' : 'columns'
  return <Box aria-hidden="true" sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '6px', bgcolor: '#faf8f2', color: '#5b6b63', display: 'grid', placeItems: 'center' }}>
    <svg viewBox="0 0 64 36" width="70%" height="70%" fill="none" stroke={ink} strokeWidth="1.6" strokeLinecap="round">
      {shape === 'columns' && <><rect x="4" y="4" width="16" height="28" rx="2" /><rect x="24" y="4" width="16" height="28" rx="2" /><rect x="44" y="4" width="16" height="28" rx="2" />
        <rect x="7" y="10" width="10" height="5" rx="1" fill={ink} opacity=".35" /><rect x="27" y="10" width="10" height="5" rx="1" fill={ink} opacity=".35" /></>}
      {shape === 'clusters' && <><rect x="4" y="6" width="24" height="24" rx="4" /><rect x="36" y="6" width="24" height="24" rx="4" />
        <rect x="8" y="11" width="16" height="5" rx="1" fill={ink} opacity=".35" /><rect x="8" y="19" width="16" height="5" rx="1" fill={ink} opacity=".35" /><rect x="40" y="11" width="16" height="5" rx="1" fill={ink} opacity=".35" /></>}
      {shape === 'tree' && <><rect x="24" y="3" width="16" height="7" rx="1.5" /><rect x="6" y="26" width="16" height="7" rx="1.5" /><rect x="42" y="26" width="16" height="7" rx="1.5" /><path d="M32 10 V18 H14 V26 M32 18 H50 V26" /></>}
      {shape === 'matrix' && <><path d="M32 3 V33 M6 18 H58" /><rect x="10" y="7" width="10" height="5" rx="1" fill={ink} opacity=".35" /><rect x="42" y="22" width="10" height="5" rx="1" fill={ink} opacity=".35" /></>}
      {shape === 'timeline' && <><path d="M4 30 H60" /><rect x="6" y="6" width="22" height="6" rx="2" fill={ink} opacity=".35" /><rect x="22" y="16" width="26" height="6" rx="2" fill={ink} opacity=".35" /><path d="M52 4 V30" strokeDasharray="2 2" /></>}
      {shape === 'map' && <><circle cx="10" cy="18" r="5" /><circle cx="32" cy="8" r="5" /><circle cx="32" cy="28" r="5" /><circle cx="54" cy="18" r="5" /><path d="M15 16 L27 10 M15 20 L27 26 M37 8 L49 16 M37 28 L49 20" /></>}
    </svg>
  </Box>
}

// What an item's card says under its line: who made it, and where it stands when it is the person's own.
const STATUS = { draft: 'Draft', submitted: 'Waiting for review', in_review: 'Being reviewed', changes_requested: 'Changes asked for', rejected: 'Not accepted', unpublished: 'Unpublished', published: 'Published' }
const byline = entry => entry.own ? STATUS[entry.status] ?? 'Yours' : entry.authorName ? 'by ' + entry.authorName : ''

/** "Build your own": the last card of the list, and the first when a search finds nothing. */
function BuildCard({ onBuild }) {
  return <Box component="li" sx={{ border: 1, borderStyle: 'dashed', borderColor: 'primary.main', borderRadius: 1.5, p: .75, display: 'flex', minWidth: 0 }}>
    <ButtonBase component="div" onClick={onBuild} aria-label="Build your own smart component" data-build-your-own=""
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', gap: .5, borderRadius: 1, flex: '1 1 auto',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      <Box sx={{ aspectRatio: '16 / 9', width: '100%', borderRadius: '6px', bgcolor: 'action.hover', display: 'grid', placeItems: 'center', color: 'primary.main' }}><AddIcon /></Box>
      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>Build your own</Typography>
      <Typography variant="caption" sx={{ lineHeight: 1.25, color: 'text.secondary' }}>Chat a board into shape on a new slate, and set how it behaves.</Typography>
    </ButtonBase>
  </Box>
}

/** A library item's card: its shape, name, line and byline, and Add. */
function ItemCard({ entry, onOpen, onAdd }) {
  return <Box component="li" data-entry={entry.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: .75, display: 'flex', flexDirection: 'column', gap: .5, minWidth: 0 }}>
    <ButtonBase component="div" onClick={() => onOpen(entry)} aria-label={entry.name + ': ' + entry.line}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', gap: .5, borderRadius: 1, flex: '1 1 auto',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      <ShapeGlyph kind={entry.preview?.boardKind} layout={entry.preview?.layout} />
      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>{entry.name}</Typography>
      <Typography variant="caption" sx={{ lineHeight: 1.25, color: 'text.secondary' }}>{entry.line}</Typography>
      {byline(entry) && <Typography variant="caption" sx={{ lineHeight: 1.2, color: 'text.secondary', fontStyle: 'italic' }}>{byline(entry)}</Typography>}
    </ButtonBase>
    <Button size="small" variant="outlined" onClick={() => onAdd(entry)} aria-label={'Add ' + entry.name} sx={{ alignSelf: 'flex-start', minWidth: 0, py: 0 }}>Add</Button>
  </Box>
}

/** The canvas this library is open on (/canvas/<shareId>), for an item added beside its boards. */
const canvasShareId = () => /\/canvas\/([A-Za-z0-9_-]+)/.exec(window.location.pathname)?.[1] ?? null

/**
 * A library item added to this slate (library spec §4.5): library.fork with the slate, as a preview (it checks the
 * board fits: at most 8 to a slate), then Keep saves it beside the boards. The page draws a board added this way
 * as it draws one a teammate added.
 */
function useItemAdd() {
  const [state, setState] = useState(null)
  const preview = async (entry) => {
    const shareId = canvasShareId()
    setState({ entry, busy: 'preview' })
    try {
      const shown = await libraryApi.fork({ itemId: entry.itemId, ...(shareId && { targetShareId: shareId }), mode: 'preview' })
      setState({ entry, shown, shareId })
    } catch (err) { setState({ entry, error: err.reason || 'It could not be added.' }) }
  }
  const keep = async () => {
    if (!state?.shown) return
    setState({ ...state, busy: 'keep' })
    try {
      const made = await libraryApi.fork({ itemId: state.entry.itemId, ...(state.shareId && { targetShareId: state.shareId, expectedRevision: state.shown.revision }), mode: 'save' })
      setState({ ...state, busy: null, kept: made })
      if (!state.shareId && made.shareId) window.location.assign('/canvas/' + made.shareId)
    } catch (err) { setState({ ...state, busy: null, error: err.reason || 'It could not be added.' }) }
  }
  return { state, preview, keep, clear: () => setState(null) }
}

/** An item's detail: its shape, line, who made it and what it came from, with Add (preview, then Keep) and Branch off. */
function ItemDetail({ entry, adding, onBranch }) {
  const mine = adding.state?.entry?.id === entry.id ? adding.state : null
  const lanes = mine?.shown?.canvas?.workshop?.lanes?.map(lane => lane.label) ?? []
  return <Box component="section" aria-label={entry.name} sx={{ display: 'flex', flexDirection: 'column', gap: 1, pb: 1 }}>
    <ShapeGlyph kind={entry.preview?.boardKind} layout={entry.preview?.layout} />
    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{entry.name}</Typography>
    <Typography variant="body2">{entry.line}</Typography>
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {[entry.group && categoryLabel(entry.group), byline(entry), entry.branchedFrom && 'Branched from ' + entry.branchedFrom].filter(Boolean).join(' · ')}
    </Typography>
    {mine?.shown && !mine.kept && <Box role="status" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Keep to add it {mine.shareId ? 'beside your boards' : 'on a new slate'}.</Typography>
      {lanes.length > 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{lanes.join(' · ')}</Typography>}
    </Box>}
    {mine?.kept && <Typography role="status" variant="body2" sx={{ color: 'success.main', fontWeight: 600 }}>Added {entry.name} to this slate.</Typography>}
    {mine?.error && <Typography role="alert" variant="body2" color="error">{mine.error}</Typography>}
    <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', pt: 1, display: 'flex', gap: 1 }}>
      {mine?.shown && !mine.kept
        ? <><Button fullWidth variant="contained" disabled={Boolean(mine.busy)} onClick={adding.keep}>{mine.busy === 'keep' ? 'Adding…' : 'Keep'}</Button>
          <Button onClick={adding.clear} disabled={Boolean(mine.busy)}>Discard</Button></>
        : <Button fullWidth variant="contained" disabled={mine?.busy === 'preview'} onClick={() => adding.preview(entry)}>Add to this slate</Button>}
      <Button variant="outlined" startIcon={<CallSplitIcon />} onClick={() => onBranch(entry)} sx={{ whiteSpace: 'nowrap' }}>Branch off</Button>
    </Box>
  </Box>
}

/** Cards in a grid, two to a row; one plays at a time (hovered or focused; on a phone, the one in the middle). */
export function LibraryCards({ entries, onOpen, onAdd, full = false, label = 'What you can add', onBuild = null, buildFirst = false }) {
  const [active, setActive] = useState(entries[0]?.id ?? null)
  const refs = useRef(new Map())
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function' || !window.matchMedia?.('(hover: none)').matches) return undefined
    const seen = new Map()
    const observer = new IntersectionObserver(items => {
      for (const item of items) seen.set(item.target.dataset.entry, item.intersectionRatio)
      const best = [...seen].sort((a, b) => b[1] - a[1])[0]
      if (best && best[1] > 0.6) setActive(best[0])
    }, { threshold: [0, 0.6, 1] })
    for (const node of refs.current.values()) if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [entries])
  return <Box component="ul" aria-label={label}
    sx={{ listStyle: 'none', p: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, my: 1 }}>
    {onBuild && buildFirst && <BuildCard onBuild={onBuild} />}
    {entries.map(entry => entry.item ? <ItemCard key={entry.id} entry={entry} onOpen={onOpen} onAdd={onAdd} />
      : <Card key={entry.id} entry={entry} playing={active === entry.id} onOpen={onOpen} onAdd={onAdd} onHover={setActive}
        cardRef={node => refs.current.set(entry.id, node)} full={full} />)}
    {onBuild && !buildFirst && <BuildCard onBuild={onBuild} />}
  </Box>
}

/** "Say it like this": three phrases, each checked against the parser on the entry's sample. */
function usePhrases(entry) {
  const [phrases, setPhrases] = useState([])
  useEffect(() => {
    let gone = false
    const business = entry.build.sample
    // A business entry's sample board is its own chunk (it loads the rules with it).
    Promise.all([import('slateboxjs/workshops/behaviour'), business ? import('slateboxjs/workshops/samples') : null]).then(([, loaded]) => {
      if (gone) return
      const samples = loaded ? loaded.catalogSamples : {}
      try { setPhrases(startersFor(entry, catalogSample(entry.id, samples)).slice(0, 3)) } catch { setPhrases([]) }
    }).catch(() => {})
    return () => { gone = true }
  }, [entry.id])
  return phrases
}

// `hasBoard`: the slate holds a board already, so this one goes beside it; `full`: it holds 8, the most for now.
function Detail({ entry, onAdd, onSay, hasBoard, full, onBranch }) {
  const phrases = usePhrases(entry)
  return <Box component="section" aria-label={entry.name} sx={{ display: 'flex', flexDirection: 'column', gap: 1, pb: 1 }}>
    <Loop entry={entry} playing large />
    <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>{entry.name}</Typography>
    <Typography variant="body2">{entry.line}</Typography>
    <Box component="ol" sx={{ m: 0, pl: 2.5 }}>{entry.loop.steps.map(step => <Typography component="li" variant="body2" key={step}>{step}</Typography>)}</Box>
    {phrases.length > 0 && <Box component="section" aria-label="Say it like this">
      <Typography variant="caption" sx={{ fontWeight: 700 }}>Say it like this</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: .5, mt: .5 }}>
        {phrases.map(phrase => <Button key={phrase.text} size="small" variant="text" onClick={() => onSay(phrase.text)}
          sx={{ textTransform: 'none', textAlign: 'left' }}>“{phrase.text}”</Button>)}
      </Box>
    </Box>}
    <Box component="section" aria-label="Limits">
      <Typography variant="caption" sx={{ fontWeight: 700 }}>Limits</Typography>
      {(full ? ['This slate holds 8 boards, the most for now, so this opens on a new slate.', ...entry.limits.slice(0, 1)] : entry.limits).map(limit =>
        <Typography key={limit} variant="body2" sx={{ color: 'text.secondary' }}>{limit}</Typography>)}
    </Box>
    <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', pt: 1 }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button fullWidth variant="contained" onClick={() => onAdd(entry)}>{full ? 'Add on a new slate' : hasBoard ? 'Add beside the board' : 'Add to this slate'}</Button>
        {/* A copy of this board on a new slate, to change and save as your own (library spec §4.1). */}
        <Button variant="outlined" startIcon={<CallSplitIcon />} onClick={() => onBranch(entry)} sx={{ whiteSpace: 'nowrap' }}>Branch off</Button>
      </Box>
    </Box>
  </Box>
}

/**
 * The library view: ‹ Back, a search ("Search or describe it": Enter with no match sends it to the
 * chat), the groups, what is on this slate, the cards, and a card's detail in place of the list.
 */
export default function LibraryView({ onBack, onAdd, onSay, onSend, onWhatCanItDo, board = null, hasBoard = false, full = false, start = {} }) {
  const [group, setGroup] = useState(start.group ?? 'all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(start.entry ? catalogEntry(start.entry) : null)
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus() }, [open])
  useLibraryItems()
  const navigate = useNavigate()
  const adding = useItemAdd()
  // Ranked by how each fits: a name above a group above a synonym ("map" finds the maps, "plans" the plans).
  // Community components follow the built-ins (listedEntries); the person's own are under "Yours".
  const entries = searchEntries(query, group)
  const yours = query.trim() ? [] : ownEntries(group)
  const build = () => navigate(buildLink())
  // A built-in branches as its library item (builtin-<id>); a community or own item as itself.
  const branch = entry => navigate(buildLink(entry.item ? entry.itemId : 'builtin-' + entry.id))
  // An item is added through library.fork (preview, then Keep); a catalogue entry by its own add message.
  const add = entry => (entry.item ? (setOpen(entry), adding.preview(entry)) : onAdd(entry))
  const here = board ? entryOfBoard(board) : null
  const back = () => (open ? setOpen(null) : onBack())
  return <Box component="section" aria-label="Add to this slate" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); back() } }} sx={{ my: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }}>
      <IconButton size="small" aria-label={open ? 'Back to the library' : 'Back to chat'} onClick={back}><ArrowBackIcon fontSize="small" /></IconButton>
      <Typography ref={heading} tabIndex={-1} variant="subtitle1" component="h2" sx={{ fontWeight: 700, outline: 'none' }}>{open ? open.name : 'Add to this slate'}</Typography>
    </Box>
    {open ? (open.item ? <ItemDetail entry={open} adding={adding} onBranch={branch} />
      : <Detail entry={open} onAdd={onAdd} onSay={onSay} hasBoard={hasBoard} full={full} onBranch={branch} />) : <>
      <InputBase value={query} onChange={event => setQuery(event.target.value)} placeholder="Search or describe it" fullWidth
        inputProps={{ 'aria-label': 'Search the library or describe what you need' }}
        onKeyDown={event => { if (event.key === 'Enter' && query.trim() && !entries.length) { event.preventDefault(); onSend(query.trim()) } }}
        sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1, py: .25, my: 1, fontSize: 14 }} />
      {/* The chips wrap to a second row rather than run off the panel's edge. */}
      <Box role="group" aria-label="Groups" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5, pb: .5 }}>
        {catalogGroups.map(item => <Chip key={item.id} label={item.label} size="small" clickable color={group === item.id ? 'primary' : 'default'}
          variant={group === item.id ? 'filled' : 'outlined'} aria-pressed={group === item.id} onClick={() => setGroup(item.id)} />)}
      </Box>
      {here && <Box component="section" aria-label="On this slate" sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>On this slate</Typography>
        <Typography variant="body2" sx={{ flex: '1 1 auto' }}>{here.name}</Typography>
        <Button size="small" onClick={onWhatCanItDo}>What can it do?</Button>
      </Box>}
      {yours.length > 0 && <Box component="section" aria-label="Yours" sx={{ mt: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>Yours</Typography>
        <LibraryCards entries={yours} onOpen={setOpen} onAdd={add} label="Your smart components" />
      </Box>}
      {entries.length ? <LibraryCards entries={entries} onOpen={setOpen} onAdd={add} full={full} onBuild={build} />
        : <><Typography variant="body2" sx={{ my: 2 }}>Nothing by that name. Press Enter to ask Slatebox for it, or build your own.</Typography>
          <LibraryCards entries={[]} onOpen={setOpen} onAdd={add} onBuild={build} buildFirst label="Build your own" /></>}
    </>}
  </Box>
}

/** The empty slate's first turn: "What are you working on?", four goals, four cards and "See all". */
export function FirstTurn({ onAdd, onOpen, onBrowse, onGoal, onSend = null, build = null }) {
  const navigate = useNavigate()
  if (build) return <BuildFirstTurn onSend={onSend ?? onGoal} />
  const firsts = ['retro', 'now-next-later', 'pros-cons', 'team-board'].map(catalogEntry).filter(Boolean)
  const goals = [['Plan work', () => onBrowse({ group: 'plan' })], ['Run a retro', () => onOpen(catalogEntry('retro'))],
    ['Weigh a decision', () => onBrowse({ group: 'decide' })], ['Draw a flow', () => onGoal('Intake → Review → Send a reply')],
    ['Build a board of my own', () => navigate(buildLink())]]
  return <Box component="section" aria-label="Opening message" sx={{ my: 1 }}>
    <ChatTurn who="slatebox" as="div" after={<Box role="group" aria-label="Goals" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
      {goals.map(([label, go]) => <Chip key={label} label={label} size="small" clickable variant="outlined" onClick={go} />)}
    </Box>}><Typography variant="body2" component="span" sx={{ display: 'block', fontWeight: 600 }}>What are you working on?</Typography>
      <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary' }}>Pick a goal, start from a board, or just say it.</Typography></ChatTurn>
    <LibraryCards entries={firsts} onOpen={onOpen} onAdd={onAdd} label="Start with one of these" />
    <Button size="small" onClick={() => onBrowse({})}>See all {listedEntries().length}</Button>
  </Box>
}

/**
 * A builder slate's first turn (library spec §4.2): "What should this board do?" and five shapes, each a plain chat
 * message, previewed and kept like any other. Typing a description works too.
 */
function BuildFirstTurn({ onSend }) {
  return <Box component="section" aria-label="Opening message" data-build-first-turn="" sx={{ my: 1 }}>
    <ChatTurn who="slatebox" as="div" after={<Box role="group" aria-label="Shapes" sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: .75, mt: .5 }}>
      {BUILD_SHAPES.map(shape => <ButtonBase key={shape.id} onClick={() => onSend(shape.message)} aria-label={shape.label + ': ' + shape.message} data-shape={shape.id}
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: .5, p: .75, border: 1, borderColor: 'divider', borderRadius: 1.5, textAlign: 'left', minHeight: 44,
          transition: 'border-color .15s, transform .15s', '&:hover': { borderColor: 'primary.main', transform: 'translateY(-1px)' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
        <ShapeGlyph kind={shape.makes} layout={shape.layout} />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{shape.label}</Typography>
      </ButtonBase>)}
    </Box>}><Typography variant="body2" component="span" sx={{ display: 'block', fontWeight: 600 }}>What should this board do?</Typography>
      <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary' }}>Pick a shape to start from, or describe it. Every change shows first, and you keep what you like. Then drag the controls on the board to set how it behaves.</Typography></ChatTurn>
  </Box>
}

/** "What can this do?" for the board on this slate: what it does, each with its phrase (tap fills the message box). */
export function BoardMoves({ moves, onSay }) {
  return <Box component="ul" aria-label="What this board can do" sx={{ listStyle: 'none', p: 0, m: 0 }}>
    {moves.map(move => <Box component="li" key={move.text} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, py: .25 }}>
      <Typography variant="body2" sx={{ flex: '0 0 auto', fontWeight: 600 }}>{move.words}</Typography>
      <Button size="small" sx={{ textTransform: 'none', textAlign: 'left' }} onClick={() => onSay(move.text)}>“{move.text}”</Button>
    </Box>)}
  </Box>
}
