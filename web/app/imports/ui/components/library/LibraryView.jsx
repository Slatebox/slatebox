import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, ButtonBase, Chip, IconButton, InputBase, Typography } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ChatTurn from '../ChatTurn'
import { catalogGroups } from 'slateboxjs/catalog'
import { catalogEntry, catalogSample, entryOfBoard, listedEntries, searchEntries, startersFor } from '../../../api/common/library.mjs'

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

/** Cards in a grid, two to a row; one plays at a time (hovered or focused; on a phone, the one in the middle). */
export function LibraryCards({ entries, onOpen, onAdd, full = false, label = 'What you can add' }) {
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
    {entries.map(entry => <Card key={entry.id} entry={entry} playing={active === entry.id} onOpen={onOpen} onAdd={onAdd} onHover={setActive}
      cardRef={node => refs.current.set(entry.id, node)} full={full} />)}
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
function Detail({ entry, onAdd, onSay, hasBoard, full }) {
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
      <Button fullWidth variant="contained" onClick={() => onAdd(entry)}>{full ? 'Add on a new slate' : hasBoard ? 'Add beside the board' : 'Add to this slate'}</Button>
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
  // Ranked by how each fits: a name above a group above a synonym ("map" finds the maps, "plans" the plans).
  const entries = useMemo(() => searchEntries(query, group), [group, query])
  const here = board ? entryOfBoard(board) : null
  const back = () => (open ? setOpen(null) : onBack())
  return <Box component="section" aria-label="Add to this slate" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); back() } }} sx={{ my: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: .5 }}>
      <IconButton size="small" aria-label={open ? 'Back to the library' : 'Back to chat'} onClick={back}><ArrowBackIcon fontSize="small" /></IconButton>
      <Typography ref={heading} tabIndex={-1} variant="subtitle1" component="h2" sx={{ fontWeight: 700, outline: 'none' }}>{open ? open.name : 'Add to this slate'}</Typography>
    </Box>
    {open ? <Detail entry={open} onAdd={onAdd} onSay={onSay} hasBoard={hasBoard} full={full} /> : <>
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
      {entries.length ? <LibraryCards entries={entries} onOpen={setOpen} onAdd={onAdd} full={full} />
        : <Typography variant="body2" sx={{ my: 2 }}>Nothing by that name. Press Enter to ask Slatebox for it.</Typography>}
    </>}
  </Box>
}

/** The empty slate's first turn: "What are you working on?", four goals, four cards and "See all". */
export function FirstTurn({ onAdd, onOpen, onBrowse, onGoal }) {
  const firsts = ['retro', 'now-next-later', 'pros-cons', 'team-board'].map(catalogEntry).filter(Boolean)
  const goals = [['Plan work', () => onBrowse({ group: 'plan' })], ['Run a retro', () => onOpen(catalogEntry('retro'))],
    ['Weigh a decision', () => onBrowse({ group: 'decide' })], ['Draw a flow', () => onGoal('Intake → Review → Send a reply')]]
  return <Box component="section" aria-label="Opening message" sx={{ my: 1 }}>
    <ChatTurn who="slatebox" as="div" after={<Box role="group" aria-label="Goals" sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
      {goals.map(([label, go]) => <Chip key={label} label={label} size="small" clickable variant="outlined" onClick={go} />)}
    </Box>}><Typography variant="body2" component="span" sx={{ display: 'block', fontWeight: 600 }}>What are you working on?</Typography>
      <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary' }}>Pick a goal, start from a board, or just say it.</Typography></ChatTurn>
    <LibraryCards entries={firsts} onOpen={onOpen} onAdd={onAdd} label="Start with one of these" />
    <Button size="small" onClick={() => onBrowse({})}>See all {listedEntries().length}</Button>
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
