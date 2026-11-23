// Describe a shape, get three outlines drawn by the AI feature `shape`, pick one: it goes on the
// selected notes (one undo step) or on a new note, and into "Your shapes". The library tabs reuse
// what you or your team kept. Previews draw the outline as a `d` attribute only, never markup.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useSetAtom } from 'jotai'
import Drawer from '@mui/material/Drawer'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import useMediaQuery from '@mui/material/useMediaQuery'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
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

function Tile({ shape, onPick, fill, stroke, busy, children, named = true }) {
  return (
    <Box sx={{ position: 'relative' }}>
      <Button
        onClick={() => onPick(shape)}
        disabled={busy}
        aria-label={`Use ${shape.name}`}
        data-shape-tile={shape.candidateId || shape.id}
        sx={{ width: '100%', minHeight: 112, flexDirection: 'column', gap: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, textTransform: 'none', p: 1 }}
      >
        <ShapePreview shape={shape} fill={fill} stroke={stroke} />
        {named && <Typography variant="caption" noWrap sx={{ maxWidth: '100%' }}>{shape.name}</Typography>}
      </Button>
      {children}
    </Box>
  )
}

Tile.propTypes = { shape: PropTypes.object.isRequired, onPick: PropTypes.func.isRequired, fill: PropTypes.string, stroke: PropTypes.string, busy: PropTypes.bool, children: PropTypes.node, named: PropTypes.bool }

/**
 * open, onClose; onApply(shape) puts { name, d, fillRule, aspect, textBox, id? } on the target;
 * target: 'new' (a new note) or the number of selected notes; fill / stroke colour the previews.
 */
export default function ShapeMaker({ open, onClose, onApply, onSearchIcons, target = 'new', fill, stroke, initialDescribe = '' }) {
  const phone = useMediaQuery('(max-width:600px)')
  const setMessage = useSetAtom(globalMessage)
  const user = useTracker(() => Meteor.user(), [])
  const signedIn = Boolean(user && !user.isAnonymous)
  const hasTeam = Boolean(user?.orgId)
  const [describe, setDescribe] = React.useState(initialDescribe)
  const [busy, setBusy] = React.useState(false)
  const [candidates, setCandidates] = React.useState([])
  const [problem, setProblem] = React.useState('')
  const [tab, setTab] = React.useState('mine')
  const [library, setLibrary] = React.useState([])
  const [applying, setApplying] = React.useState(false)
  const input = React.useRef(null)

  const loadLibrary = React.useCallback(async (scope = tab) => {
    if (!signedIn) return
    try {
      const { shapes } = await call('shapes.list', { scope, limit: 24 })
      setLibrary(shapes)
    } catch {
      setLibrary([])
    }
  }, [signedIn, tab])

  // Each opening starts clean: no candidates or problem left from the last shape.
  React.useEffect(() => {
    if (open) {
      setCandidates([])
      setProblem('')
    }
  }, [open])

  React.useEffect(() => {
    if (open) {
      loadLibrary(tab)
      setTimeout(() => input.current?.focus(), 50)
    }
  }, [open, tab]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => { if (open && initialDescribe) setDescribe(initialDescribe) }, [open, initialDescribe])

  async function make(fresh = false) {
    const words = describe.trim()
    if (!words || busy) return
    if (!signedIn) { setProblem('Sign in to draw shapes with AI.'); return }
    setBusy(true)
    setProblem('')
    if (fresh) setCandidates([])
    try {
      const result = await call('shapes.generate', { describe: words, count: 3, fresh })
      setCandidates(result.candidates)
    } catch (error) {
      setCandidates([])
      setProblem(error.reason || error.message || 'Could not draw that shape. Try describing it more simply.')
    } finally {
      setBusy(false)
    }
  }

  async function pick(shape) {
    if (applying) return
    setApplying(true)
    try {
      let saved = shape
      if (!shape.id) {
        // A candidate picked goes into "Your shapes".
        saved = await call('shapes.save', { name: shape.name, d: shape.d, fillRule: shape.fillRule, describe: describe.trim() || undefined })
      }
      await onApply({ ...saved, aspect: saved.aspect ?? shape.aspect, textBox: saved.textBox ?? shape.textBox })
      call('shapes.used', { id: saved.id, count: typeof target === 'number' ? target : 1 }).catch(() => {})
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
  const columns = phone ? 3 : 3

  return (
    <Drawer
      anchor={phone ? 'bottom' : 'right'}
      open={open}
      onClose={onClose}
      PaperProps={{ 'data-shape-maker': '', sx: phone ? { maxHeight: '82vh', borderTopLeftRadius: 12, borderTopRightRadius: 12 } : { width: 344 } }}
    >
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, boxSizing: 'border-box', width: '100%', overflowX: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="subtitle1" component="h2" sx={{ flex: 1, fontWeight: 600 }}>Custom shape</Typography>
          <IconButton aria-label="Close" onClick={onClose} size="small"><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box component="form" sx={{ display: 'flex', gap: 1 }} onSubmit={(e) => { e.preventDefault(); make(false) }}>
          <input
            ref={input}
            aria-label="Describe a shape"
            placeholder="a rocket, a speech bubble with the tail on the left…"
            value={describe}
            maxLength={200}
            onChange={(e) => setDescribe(e.target.value)}
            style={{ flex: 1, minWidth: 0, height: 40, padding: '0 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.25)', font: 'inherit', fontSize: 16 }}
          />
          <Button type="submit" variant="contained" disabled={busy || !describe.trim()} sx={{ minHeight: 40 }}>Make</Button>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Puts the shape on {where}. Drawing uses AI, counted like your other AI use.
        </Typography>
        {problem && <Typography variant="body2" color="error" role="alert">{problem}</Typography>}
        {(busy || candidates.length > 0) && (
          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1 }} role="group" aria-label="Shapes drawn">
            {busy
              ? [0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={112} />)
              : candidates.map((shape) => <Tile key={shape.candidateId} shape={shape} onPick={pick} fill={fill} stroke={stroke} busy={applying} />)}
          </Box>
        )}
        {(candidates.length > 0 && !busy) || onSearchIcons ? (
          <Box sx={{ display: 'flex', gap: 1 }}>
            {candidates.length > 0 && !busy && <Button size="small" onClick={() => make(true)}>Try again</Button>}
            {onSearchIcons && <Button size="small" onClick={onSearchIcons}>Search icons</Button>}
          </Box>
        ) : null}
        {signedIn && (
          <>
            <Tabs value={tab} onChange={(_e, next) => setTab(next)} variant="fullWidth" sx={{ minHeight: 40 }}>
              <Tab value="mine" label="Your shapes" sx={{ minHeight: 40 }} />
              {hasTeam && <Tab value="team" label="Team" sx={{ minHeight: 40 }} />}
            </Tabs>
            {library.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {tab === 'team' ? 'Shapes shared with your team show here.' : 'Shapes you pick are kept here.'}
              </Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1 }} role="group" aria-label="Your shapes">
                {library.map((shape) => (
                  <Tile key={shape.id} shape={shape} onPick={pick} fill={fill} stroke={stroke} busy={applying} named={!shape.mine}>
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
                        style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, font: 'inherit', fontSize: 12, border: '1px solid transparent', borderRadius: 4, padding: '2px 4px', background: 'transparent' }}
                      />
                    )}
                  </Tile>
                ))}
              </Box>
            )}
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
  onSearchIcons: PropTypes.func,
  target: PropTypes.oneOfType([PropTypes.oneOf(['new']), PropTypes.number]),
  fill: PropTypes.string,
  stroke: PropTypes.string,
  initialDescribe: PropTypes.string,
}
