import React, { useEffect, useId, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { TILE_LIMITS, tileBuildWords, tileMakesLine } from '../../../api/common/personal-tiles.mjs'
import { SECTION_HEADING, SPACE } from '../../common/AccountLayout'

// The start page's "Yours": a tile for each plan the person's talks there ended with, above the
// eight stock jobs, most recently used first. Each card has its icon, title and blurb, what it
// makes, and Make another (a new slate from the boards its first build kept, at once; Build it
// before the first build), Make a fresh version (every board drafted again from the talk), Rename
// and Remove (asked once more, in place). A card is not a button itself (its buttons are), so it does
// not light up on hover. Theme tokens only; reduced motion turns the transitions off.
const still = { '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none !important' } }

function TileCard({ tile, Icon, busy, onBuild, onRebuild, onRename, onRemove }) {
  const titleId = useId()
  const fieldId = useId()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(tile.title)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const field = useRef(null)
  const renameButton = useRef(null)
  const removeButton = useRef(null)
  const was = useRef({ renaming: false, confirming: false })
  useEffect(() => {
    if (renaming) field.current?.focus()
    else if (was.current.renaming) renameButton.current?.focus()
    if (!confirming && was.current.confirming) removeButton.current?.focus()
    was.current = { renaming, confirming }
  }, [renaming, confirming])
  const built = Boolean(tile.built)
  const make = tileBuildWords(tile, { repeat: built })
  const fresh = tileBuildWords(tile, { fresh: true })
  const wait = (fn) => () => { if (!busy) fn() }
  const waitingSx = busy ? { opacity: 0.6, cursor: 'default' } : null

  const save = async (event) => {
    event.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      await onRename(tile, name.trim())
      setRenaming(false)
    } catch (err) {
      setError(err?.reason || err?.message || 'That could not be changed. Try again.')
    }
  }

  return (
    <Box component="li" data-start-tile={tile.id} aria-labelledby={titleId}
      sx={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: SPACE.tight, p: SPACE.text, minWidth: 0,
        borderRadius: 4, border: 1, borderColor: 'divider', bgcolor: 'background.paper', transition: 'border-color .15s', '&:focus-within': { borderColor: 'primary.main' }, ...still }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: SPACE.text }}>
        <Box aria-hidden="true" sx={{ flex: 'none', display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 3, bgcolor: 'action.hover', color: 'primary.main' }}><Icon /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography id={titleId} component="h3" sx={{ fontWeight: 700, fontSize: 17, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{tile.title}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{tile.blurb}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: SPACE.hair }}>{tileMakesLine(tile)}</Typography>
        </Box>
      </Box>
      {renaming ? (
        <Box component="form" onSubmit={save} aria-label={`Rename ${tile.title}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false) } }}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight, alignItems: 'flex-start' }}>
          <TextField id={fieldId} inputRef={field} size="small" label="Name" value={name} onChange={(e) => setName(e.target.value)} required
            slotProps={{ htmlInput: { maxLength: TILE_LIMITS.title } }} sx={{ flex: '1 1 160px' }} />
          <Button type="submit" size="small" variant="contained" color="secondary" disabled={!name.trim()}>Save</Button>
          <Button size="small" onClick={() => { setName(tile.title); setRenaming(false) }}>Cancel</Button>
        </Box>
      ) : confirming ? (
        <Box role="group" aria-label={`Remove ${tile.title}?`} sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight, alignItems: 'center' }}>
          <Typography variant="body2">{built ? 'Remove this tile? The boards it made stay in your library.' : 'Remove this tile? Its plan goes with it; nothing was built from it yet.'}</Typography>
          <Button size="small" color="error" variant="outlined" onClick={wait(() => onRemove(tile))} data-start-tile-remove-yes="">Remove</Button>
          <Button size="small" onClick={() => setConfirming(false)} autoFocus>Keep it</Button>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight, mt: 'auto' }}>
          <Button size="small" variant="contained" color="secondary" onClick={wait(() => onBuild(tile))} aria-disabled={busy || undefined} sx={waitingSx}
            aria-label={make.button} data-start-tile-make="">{built ? 'Make another' : 'Build it'}</Button>
          {built && <Button size="small" onClick={wait(() => onRebuild(tile))} aria-disabled={busy || undefined} sx={waitingSx} aria-label={fresh.button} data-start-tile-fresh="">Make a fresh version</Button>}
          <Button size="small" ref={renameButton} onClick={() => { setName(tile.title); setRenaming(true) }} aria-label={`Rename: ${tile.title}`} data-start-tile-rename="">Rename</Button>
          <Button size="small" ref={removeButton} onClick={() => setConfirming(true)} aria-label={`Remove: ${tile.title}`} data-start-tile-remove="">Remove</Button>
        </Box>
      )}
      {error && <Alert severity="warning" role="alert">{error}</Alert>}
    </Box>
  )
}

const tileShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  blurb: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  boards: PropTypes.arrayOf(PropTypes.shape({ kind: PropTypes.string })).isRequired,
  built: PropTypes.shape({ boards: PropTypes.number }),
})
TileCard.propTypes = {
  tile: tileShape.isRequired,
  Icon: PropTypes.elementType.isRequired,
  busy: PropTypes.bool.isRequired,
  onBuild: PropTypes.func.isRequired,
  onRebuild: PropTypes.func.isRequired,
  onRename: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}

/** The person's tiles. `icons`: the start page's icon set, by id. Nothing at all while they keep none. */
export default function YourTiles({ tiles, icons, busy, error, onBuild, onRebuild, onRename, onRemove }) {
  const headingId = useId()
  const headingRef = useRef(null)
  if (!tiles.length) return null
  return (
    <Box component="section" aria-labelledby={headingId} data-start-yours="" sx={{ mb: SPACE.block }}>
      <Typography id={headingId} ref={headingRef} tabIndex={-1} component="h2" sx={{ ...SECTION_HEADING, mb: SPACE.text, outline: 'none' }}>Yours</Typography>
      <Box component="ul" aria-label="Your tiles" sx={{ m: 0, p: 0, display: 'grid', gap: { xs: SPACE.tight, sm: SPACE.text },
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
        {tiles.map((tile, index) => <TileCard key={tile.id} tile={tile} Icon={icons[tile.icon] || icons.plan} busy={busy} onBuild={onBuild} onRebuild={onRebuild} onRename={onRename}
          onRemove={async (gone) => {
            // focus goes to the next tile's first button (or the one before, or the heading), not off to the talk's card
            const next = tiles[index + 1] || tiles[index - 1]
            await onRemove(gone)
            requestAnimationFrame(() => {
              const to = next && document.querySelector(`[data-start-tile="${next.id}"] [data-start-tile-make]`)
              ;(to || headingRef.current || document.querySelector('[data-start-talk]'))?.focus()
            })
          }} />)}
      </Box>
      {error && <Alert severity="warning" role="alert" sx={{ mt: SPACE.tight }}>{error}</Alert>}
    </Box>
  )
}

YourTiles.propTypes = {
  tiles: PropTypes.arrayOf(tileShape).isRequired,
  icons: PropTypes.objectOf(PropTypes.elementType).isRequired,
  busy: PropTypes.bool.isRequired,
  error: PropTypes.string,
  onBuild: PropTypes.func.isRequired,
  onRebuild: PropTypes.func.isRequired,
  onRename: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}
YourTiles.defaultProps = { error: '' }
