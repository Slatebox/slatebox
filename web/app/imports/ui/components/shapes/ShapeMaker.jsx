// The custom shape pane. Typing searches The Noun Project's icons (shapes.searchIcons: each one a
// checked outline, normalised to a 0..100 box, with its credit); a picked icon goes on the selected
// notes (one undo step) or on a new note, and into "Your shapes". "Create a custom shape with AI"
// draws exactly one outline from the same words (the AI feature `shape`, counted like other AI
// use), shown first so it can be kept or drawn again. The library tabs reuse what you or your team
// kept. Previews draw the outline as a `d` attribute only, never markup.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSetAtom } from 'jotai'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Link from '@mui/material/Link'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import TextField from '@mui/material/TextField'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import SearchIcon from '@mui/icons-material/Search'
import { globalMessage } from '../../jotai/atoms'

const viewBoxOf = (aspect = 1) => {
  const w = aspect >= 1 ? 100 : 100 * aspect
  const h = aspect >= 1 ? 100 / aspect : 100
  return { w, h, box: `-4 -4 ${(w + 8).toFixed(1)} ${(h + 8).toFixed(1)}` }
}

/** One outline, filled with the target note's colours, with a sample label where text sits. */
export function ShapePreview({ shape, fill = '#c9d8f0', stroke = '#3c5a8a', label = true, size = 88 }) {
  const { w, h, box } = viewBoxOf(shape.aspect)
  const tb = shape.textBox
  return (
    <svg viewBox={box} width={size} height={size} aria-hidden style={{ display: 'block' }}>
      <path d={shape.d} fill={fill} fillRule={shape.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'} stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {label && tb && (
        <rect x={tb.x * w + tb.w * w * 0.15} y={tb.y * h + tb.h * h * 0.4} width={tb.w * w * 0.7} height={Math.max(3, tb.h * h * 0.2)} rx={2} fill="#000" fillOpacity={0.18} />
      )}
    </svg>
  )
}

ShapePreview.propTypes = {
  shape: PropTypes.shape({ d: PropTypes.string, aspect: PropTypes.number, fillRule: PropTypes.string, textBox: PropTypes.object }).isRequired,
  fill: PropTypes.string,
  stroke: PropTypes.string,
  label: PropTypes.bool,
  size: PropTypes.number,
}

const call = (name, input) => Meteor.callAsync(name, input)
const COLUMNS = 4
// Each search is a paid Noun Project call: wait for three characters and a real pause in typing.
const SEARCH_DELAY_MS = 500
const MIN_SEARCH = 3
const ICONS_PER_SEARCH = 24

// Arrow keys move between the tiles of a grid (four to a row); Home and End go to its ends.
function moveInGrid(event) {
  const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }
  if (!(event.key in keys) && event.key !== 'Home' && event.key !== 'End') return
  const tiles = [...event.currentTarget.querySelectorAll('[data-grid-tile]')]
  const at = tiles.indexOf(document.activeElement)
  if (at < 0) return
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : at + keys[event.key]
  if (next < 0 || next >= tiles.length) return
  event.preventDefault()
  tiles[next].focus()
}

// On phones an icon's credit sits in its tile: "by <creator>" from "<icon> by <creator> from Noun Project".
const creditLine = (icon) => {
  const text = icon.credit?.text || ''
  const by = text.match(/\bby (.+?)(?: from Noun Project)?$/i)?.[1]
  return by ? `${icon.name} by ${by}` : text || icon.name
}

const gridSx = { display: 'grid', gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`, gap: 1 }

function Tile({ shape, onPick, fill, stroke, busy, children, named = true, title, caption, tileId, size = 56 }) {
  const tile = (
    <ButtonBase
      onClick={() => onPick(shape)}
      disabled={busy}
      aria-label={caption || title ? `Use ${shape.name}, ${caption || title}` : `Use ${shape.name}`}
      data-grid-tile=""
      data-shape-tile={tileId}
      focusRipple
      sx={{
        width: '100%',
        minHeight: 88,
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0.5,
        p: 1,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        bgcolor: 'background.paper',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 1 },
      }}
    >
      <ShapePreview shape={shape} fill={fill} stroke={stroke} size={size} />
      {named && <Typography variant="caption" noWrap sx={{ maxWidth: '100%', color: 'text.secondary' }}>{shape.name}</Typography>}
      {caption && <Typography variant="caption" sx={{ maxWidth: '100%', color: 'text.secondary', fontSize: '0.65rem', lineHeight: 1.2, overflowWrap: 'anywhere' }}>{caption}</Typography>}
    </ButtonBase>
  )
  return (
    <Box sx={{ position: 'relative', minWidth: 0 }}>
      {title && !caption ? <Tooltip title={title} placement="top" enterDelay={500}>{tile}</Tooltip> : tile}
      {children}
    </Box>
  )
}

Tile.propTypes = {
  shape: PropTypes.object.isRequired,
  onPick: PropTypes.func.isRequired,
  fill: PropTypes.string,
  stroke: PropTypes.string,
  busy: PropTypes.bool,
  children: PropTypes.node,
  named: PropTypes.bool,
  title: PropTypes.string,
  caption: PropTypes.string,
  tileId: PropTypes.string,
  size: PropTypes.number,
}

function SectionLabel({ children, id }) {
  return <Typography id={id} variant="subtitle2" component="h3" sx={{ fontWeight: 600, color: 'text.primary' }}>{children}</Typography>
}

SectionLabel.propTypes = { children: PropTypes.node, id: PropTypes.string }

/**
 * open, onClose; onApply(shape) puts { name, d, fillRule, aspect, textBox, id? } on the target;
 * target: 'new' (a new note) or the number of selected notes; fill / stroke colour the previews.
 */
export default function ShapeMaker({ open, onClose, onApply, target = 'new', fill, stroke, initialDescribe = '' }) {
  const phone = useMediaQuery('(max-width:600px)')
  const setMessage = useSetAtom(globalMessage)
  const user = useTracker(() => Meteor.user(), [])
  const signedIn = Boolean(user && !user.isAnonymous)
  const hasTeam = Boolean(user?.orgId)
  const [words, setWords] = React.useState(initialDescribe)
  // Icon search: idle | loading | done | error, for the words in `searched`.
  const [search, setSearch] = React.useState({ state: 'idle', q: '', icons: [], credit: null, problem: '' })
  // The one shape drawn with AI.
  const [drawing, setDrawing] = React.useState({ busy: false, shape: null, problem: '' })
  const [problem, setProblem] = React.useState('')
  const [tab, setTab] = React.useState('mine')
  const [library, setLibrary] = React.useState([])
  const [applying, setApplying] = React.useState(false)
  const input = React.useRef(null)
  const results = React.useRef(null)
  const latest = React.useRef(0)
  const cache = React.useRef(new Map())

  const loadLibrary = React.useCallback(async (scope = tab) => {
    if (!signedIn) return
    try {
      const { shapes } = await call('shapes.list', { scope, limit: 24 })
      setLibrary(shapes)
    } catch {
      setLibrary([])
    }
  }, [signedIn, tab])

  // Each opening starts clean: no drawing, results or problem left from the last shape.
  React.useEffect(() => {
    if (open) {
      setDrawing({ busy: false, shape: null, problem: '' })
      setProblem('')
    }
  }, [open])

  React.useEffect(() => {
    if (open) {
      loadLibrary(tab)
      setTimeout(() => input.current?.focus(), 50)
    }
  }, [open, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (open && initialDescribe) setWords(initialDescribe) }, [open, initialDescribe])

  const runSearch = React.useCallback(async (raw) => {
    const q = raw.trim()
    const ticket = ++latest.current
    if (q.length < MIN_SEARCH) {
      setSearch({ state: 'idle', q: '', icons: [], credit: null, problem: '' })
      return
    }
    const key = q.toLowerCase()
    const kept = cache.current.get(key)
    if (kept) {
      setSearch({ state: 'done', q, icons: kept.icons, credit: kept.credit, problem: '' })
      return
    }
    setSearch((s) => ({ ...s, state: 'loading', q, problem: '' }))
    try {
      const answer = await call('shapes.searchIcons', { q, limit: ICONS_PER_SEARCH })
      if (ticket !== latest.current) return
      cache.current.set(key, answer)
      setSearch({ state: 'done', q, icons: answer.icons || [], credit: answer.credit || null, problem: '' })
    } catch (error) {
      if (ticket !== latest.current) return
      setSearch({ state: 'error', q, icons: [], credit: null, problem: error.reason || error.message || 'Icon search is not answering just now.' })
    }
  }, [])

  // Typing searches icons, a moment after the last key.
  React.useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => runSearch(words), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [open, words, runSearch])

  async function draw(fresh = false) {
    const describe = words.trim()
    if (!describe || drawing.busy) return
    if (!signedIn) { setDrawing({ busy: false, shape: null, problem: 'Sign in to create shapes with AI.' }); return }
    setDrawing({ busy: true, shape: null, problem: '' })
    try {
      const result = await call('shapes.generate', { describe, count: 1, fresh })
      setDrawing({ busy: false, shape: result.candidates?.[0] ?? null, problem: result.candidates?.length ? '' : 'Could not draw that shape. Try describing it more simply.' })
    } catch (error) {
      setDrawing({ busy: false, shape: null, problem: error.reason || error.message || 'Could not draw that shape. Try describing it more simply.' })
    }
  }

  // Put a shape on the target. A drawn shape or an icon is kept in "Your shapes" first (signed in);
  // every value applied is the stored, normalised outline.
  async function pick(shape, { icon = false } = {}) {
    if (applying) return
    setApplying(true)
    setProblem('')
    try {
      let saved = shape
      if (!shape.id && signedIn) {
        saved = await call('shapes.save', icon
          ? { name: shape.name, d: shape.d, fillRule: shape.fillRule, source: 'imported', credit: shape.credit }
          : { name: shape.name, d: shape.d, fillRule: shape.fillRule, describe: words.trim() || undefined })
      }
      await onApply({ ...saved, aspect: saved.aspect ?? shape.aspect, textBox: saved.textBox ?? shape.textBox })
      if (saved.id) call('shapes.used', { id: saved.id, count: typeof target === 'number' ? target : 1 }).catch(() => {})
      onClose()
    } catch (error) {
      setProblem(error.reason || error.message || 'The shape could not be used just now.')
    } finally {
      setApplying(false)
    }
  }

  async function toggleShare(shape) {
    try {
      const next = await call('shapes.update', { id: shape.id, visibility: shape.visibility === 'team' ? 'private' : 'team' })
      setLibrary((rows) => rows.map((row) => (row.id === shape.id ? { ...row, ...next } : row)))
    } catch (error) {
      setProblem(error.reason || error.message)
    }
  }

  async function remove(shape) {
    try {
      await call('shapes.remove', { id: shape.id })
      setLibrary((rows) => rows.filter((row) => row.id !== shape.id))
      setMessage({ visible: true, text: `${shape.name} removed from your shapes. Notes that use it keep it.`, severity: 'info', autoHide: 5000 })
    } catch (error) {
      setProblem(error.reason || error.message)
    }
  }

  async function rename(shape, name) {
    const clean = name.trim()
    if (!clean || clean === shape.name) return
    try {
      const next = await call('shapes.update', { id: shape.id, name: clean })
      setLibrary((rows) => rows.map((row) => (row.id === shape.id ? { ...row, ...next } : row)))
    } catch (error) {
      setProblem(error.reason || error.message)
    }
  }

  const where = target === 'new' ? 'a new note' : target === 1 ? 'the selected note' : `the ${target} selected notes`
  const hasWords = words.trim().length > 0
  // Words typed but not searched yet (the search waits for a pause in typing) show as loading.
  const typed = words.trim()
  const searchState = typed.length < MIN_SEARCH ? 'idle' : typed !== search.q ? 'loading' : search.state
  const focusFirstResult = (event) => {
    if (event.key !== 'ArrowDown') return
    const first = results.current?.querySelector('[data-grid-tile]')
    if (first) { event.preventDefault(); first.focus() }
  }

  return (
    <Drawer
      anchor={phone ? 'bottom' : 'right'}
      open={open}
      onClose={onClose}
      PaperProps={{
        'data-shape-maker': '',
        role: 'dialog',
        'aria-labelledby': 'shape-maker-title',
        sx: phone
          ? { width: '100%', maxHeight: '88dvh', borderTopLeftRadius: 16, borderTopRightRadius: 16, boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
          : { width: 'min(400px, 100vw)', maxWidth: '100vw', height: '100dvh', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
      }}
    >
      {phone && <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} />}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 2.5,
          pr: 'max(12px, env(safe-area-inset-right))',
          pt: phone ? 1 : 'max(12px, env(safe-area-inset-top))',
          pb: 1,
          flexShrink: 0,
        }}
      >
        <Typography id="shape-maker-title" variant="h6" component="h2" sx={{ flex: 1, fontSize: '1.0625rem', fontWeight: 600 }}>Custom shape</Typography>
        <IconButton aria-label="Close" onClick={onClose} sx={{ width: 40, height: 40 }}><CloseIcon /></IconButton>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: 2.5,
          pl: 'max(20px, env(safe-area-inset-left))',
          pr: 'max(20px, env(safe-area-inset-right))',
          pt: 0.5,
          pb: 'max(20px, env(safe-area-inset-bottom))',
        }}
      >
        <Box component="section" aria-labelledby="shape-maker-icons" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box component="form" role="search" onSubmit={(e) => { e.preventDefault(); runSearch(words) }}>
            <TextField
              inputRef={input}
              fullWidth
              size="small"
              type="search"
              label="Search icons"
              placeholder="songbird, rocket, speech bubble…"
              value={words}
              onChange={(e) => setWords(e.target.value)}
              onKeyDown={focusFirstResult}
              inputProps={{ maxLength: 100, 'aria-controls': 'shape-maker-results', style: { fontSize: 16 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
          </Box>
          <Typography id="shape-maker-icons" variant="body2" color="text.secondary">
            Pick an icon to put it on {where}.
          </Typography>
          {problem && <Typography variant="body2" color="error" role="alert">{problem}</Typography>}
          <Box id="shape-maker-results" ref={results} aria-live="polite" aria-busy={searchState === 'loading'}>
            {searchState === 'idle' && (
              <Typography variant="body2" color="text.secondary">Type a word or two to see icons.</Typography>
            )}
            {searchState === 'loading' && (
              <Box sx={gridSx} aria-label="Searching icons">
                {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} variant="rounded" height={88} />)}
              </Box>
            )}
            {searchState === 'error' && (
              <Box role="alert" sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                <Typography variant="body2" color="error">{search.problem}</Typography>
                <Button size="small" onClick={() => { cache.current.delete(search.q.toLowerCase()); runSearch(words) }}>Try again</Button>
              </Box>
            )}
            {searchState === 'done' && search.icons.length === 0 && (
              <Typography variant="body2" color="text.secondary">No icons for “{search.q}”. Try other words, or create one with AI below.</Typography>
            )}
            {searchState === 'done' && search.icons.length > 0 && (
              <>
                <Box sx={gridSx} role="group" aria-label={`Icons for ${search.q}`} onKeyDown={moveInGrid}>
                  {search.icons.map((icon) => (
                    <Tile key={icon.iconId} tileId={`icon-${icon.iconId}`} shape={icon} onPick={(s) => pick(s, { icon: true })} fill={fill} stroke={stroke} busy={applying} title={icon.credit?.text} caption={phone ? creditLine(icon) : undefined} named={!phone} />
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  <Link href={search.credit?.url || 'https://thenounproject.com'} target="_blank" rel="noopener noreferrer" color="inherit">
                    {search.credit?.text || 'Icons from Noun Project'}
                  </Link>
                  {phone ? '.' : '. Hover an icon for its creator.'}
                </Typography>
              </>
            )}
          </Box>
        </Box>

        <Divider />

        <Box component="section" aria-labelledby="shape-maker-ai" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <SectionLabel id="shape-maker-ai">Or draw your own</SectionLabel>
          <Button
            variant="outlined"
            startIcon={<AutoAwesomeIcon />}
            onClick={() => draw(false)}
            disabled={!hasWords || drawing.busy}
            sx={{ alignSelf: 'flex-start', minHeight: 40, textTransform: 'none' }}
          >
            Create a custom shape with AI
          </Button>
          <Typography variant="body2" color="text.secondary">
            {hasWords ? `Draws one shape of “${words.trim()}”.` : 'Type what you want above.'} Counted like your other AI use.
          </Typography>
          {drawing.problem && <Typography variant="body2" color="error" role="alert">{drawing.problem}</Typography>}
          {(drawing.busy || drawing.shape) && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }} role="group" aria-label="Shape drawn">
              <Box sx={{ width: 112, flexShrink: 0 }}>
                {drawing.busy
                  ? <Skeleton variant="rounded" height={112} aria-label="Drawing" />
                  : <Tile shape={drawing.shape} tileId={drawing.shape.candidateId} onPick={(s) => pick(s)} fill={fill} stroke={stroke} busy={applying} size={80} />}
              </Box>
              {drawing.shape && !drawing.busy && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <Button variant="contained" size="small" onClick={() => pick(drawing.shape)} disabled={applying} sx={{ textTransform: 'none' }}>Use this shape</Button>
                  <Button size="small" onClick={() => draw(true)} disabled={applying || drawing.busy} sx={{ textTransform: 'none' }}>Draw again</Button>
                </Box>
              )}
            </Box>
          )}
        </Box>

        {signedIn && (
          <>
            <Divider />
            <Box component="section" aria-label="Kept shapes" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Tabs value={tab} onChange={(_e, next) => setTab(next)} variant="fullWidth" sx={{ minHeight: 40 }}>
                <Tab value="mine" label="Your shapes" sx={{ minHeight: 40, textTransform: 'none' }} />
                {hasTeam && <Tab value="team" label="Team" sx={{ minHeight: 40, textTransform: 'none' }} />}
              </Tabs>
              {library.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {tab === 'team' ? 'Shapes shared with your team show here.' : 'Icons and shapes you use are kept here.'}
                </Typography>
              ) : (
                <Box sx={gridSx} role="group" aria-label={tab === 'team' ? 'Team shapes' : 'Your shapes'} onKeyDown={moveInGrid}>
                  {library.map((shape) => (
                    <Tile key={shape.id} tileId={shape.id} shape={shape} onPick={pick} fill={fill} stroke={stroke} busy={applying} named={!shape.mine} title={shape.credit?.text}>
                      {shape.mine && (
                        <Box sx={{ position: 'absolute', top: 2, right: 2, display: 'flex' }}>
                          {hasTeam && (
                            <Tooltip title={shape.visibility === 'team' ? 'Shared with your team: make private' : 'Share with your team'}>
                              <IconButton size="small" aria-label={shape.visibility === 'team' ? `Make ${shape.name} private` : `Share ${shape.name} with your team`} onClick={() => toggleShare(shape)}>
                                {shape.visibility === 'team' ? <GroupsOutlinedIcon fontSize="inherit" /> : <LockOutlinedIcon fontSize="inherit" />}
                              </IconButton>
                            </Tooltip>
                          )}
                          <Tooltip title="Remove from your shapes">
                            <IconButton size="small" aria-label={`Remove ${shape.name}`} onClick={() => remove(shape)}><DeleteOutlineIcon fontSize="inherit" /></IconButton>
                          </Tooltip>
                        </Box>
                      )}
                      {shape.mine && (
                        <input
                          aria-label={`Rename ${shape.name}`}
                          defaultValue={shape.name}
                          maxLength={60}
                          onBlur={(e) => rename(shape, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                          style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, font: 'inherit', fontSize: 12, border: '1px solid transparent', borderRadius: 4, padding: '2px 4px', background: 'transparent', color: 'inherit' }}
                        />
                      )}
                    </Tile>
                  ))}
                </Box>
              )}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  )
}

ShapeMaker.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onApply: PropTypes.func.isRequired,
  target: PropTypes.oneOfType([PropTypes.oneOf(['new']), PropTypes.number]),
  fill: PropTypes.string,
  stroke: PropTypes.string,
  initialDescribe: PropTypes.string,
}
