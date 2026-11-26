import React, { useState } from 'react'
import PropTypes from 'prop-types'
import Popover from '@mui/material/Popover'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import ButtonBase from '@mui/material/ButtonBase'
import InputBase from '@mui/material/InputBase'
import IconButton from '@mui/material/IconButton'
import Chip from '@mui/material/Chip'
import SendIcon from '@mui/icons-material/Send'
import UndoIcon from '@mui/icons-material/Undo'
import { STYLE_CHIPS } from './presentationStyles.mjs'

/** What the chat suggests: each is a request the planner reads in plain language. */
export const REFINE_PILLS = [
  { label: 'Bolder', ask: 'Make this deck bolder: bigger headlines, stronger colour, more surprising camera moves.' },
  { label: 'Darker', ask: 'Make this deck darker and moodier: pick a dark style or a darker palette.' },
  { label: 'More playful', ask: 'Make this deck more playful: hand-drawn or kinetic, with speech bubbles and stickers.' },
  { label: 'Calmer', ask: 'Make this deck calmer: fewer camera rolls, gentle moves, plain layouts.' },
  { label: 'Add images', ask: 'Add a picture to more steps, each with a clear reason tied to its notes.' },
]

/**
 * The style sheet: one click and the slate wears a style ("Wear this style": its background, its
 * notes' look and the style's title cards, captions and art become real notes on the canvas, the
 * same steps remixed for it, no agent call; no note or word of the slate's own is removed), "Revert
 * to original" brings back the notes, layout and background from before the first style, keeping
 * notes and words added since (`onRevert`, offered while the slate
 * keeps an original: `canRevert`), and the chat refines the deck with Slatebox (`onRefine`, the
 * planner's conversation). Present plays exactly what the slate wears.
 */
export default function StyleSheet({ anchorEl, onClose, current, onPick, onRevert = null, canRevert = false, onRefine, onRemix, busy = false, pictures = [], onPicture = null }) {
  const [text, setText] = useState('')
  const send = (ask) => {
    const said = String(ask || '').trim()
    if (!said) return
    setText('')
    onRefine(said)
  }
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      slotProps={{ paper: { sx: { bgcolor: 'rgba(18,18,24,.92)', color: '#fff', backdropFilter: 'blur(14px)', borderRadius: '20px', width: 'min(980px, calc(100vw - 32px))', p: 2, boxSizing: 'border-box' } } }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 12px', mb: 1.25, mx: 0.5 }}>
        <Typography variant="overline" sx={{ letterSpacing: '.12em', opacity: 0.75, lineHeight: 1.6 }}>Wear this style</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px' }}>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>Your slate wears it, so the canvas and Present match · your notes and words stay · no agent call</Typography>
          {onRevert && (
            <Chip
              size="small"
              icon={<UndoIcon sx={{ color: 'inherit !important' }} fontSize="small" />}
              label="Revert to original"
              data-style-revert
              disabled={busy || !canRevert}
              onClick={onRevert}
              sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,.14)' }}
            />
          )}
        </Box>
      </Box>
      <Box role="radiogroup" aria-label="Slate style" sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5, scrollbarWidth: 'none' }}>
        {STYLE_CHIPS.map((chip) => {
          const on = chip.id === current
          return (
            <ButtonBase
              key={chip.id}
              role="radio"
              aria-checked={on}
              aria-label={`Wear ${chip.name}: ${chip.blurb}`}
              data-style-chip={chip.id}
              disabled={busy}
              onClick={() => onPick(chip.id)}
              sx={{ flex: '0 0 auto', width: { xs: 84, sm: 104 }, flexDirection: 'column', borderRadius: '12px', fontSize: 13, fontWeight: 600 }}
            >
              <Box sx={{ position: 'relative', width: '100%', height: { xs: 56, sm: 66 }, borderRadius: '12px', overflow: 'hidden', background: chip.bg, border: '2px solid', borderColor: on ? '#fff' : 'rgba(255,255,255,.12)', boxShadow: on ? '0 0 0 3px rgba(255,255,255,.25)' : 'none' }}>
                <svg viewBox="-10 -10 120 120" width="54" height="54" style={{ position: 'absolute', left: 8, top: 4 }} aria-hidden="true">
                  <path d={chip.path} fill={chip.fg} />
                </svg>
                <svg width="44" height="18" style={{ position: 'absolute', right: 8, bottom: 8 }} aria-hidden="true">
                  <rect width="38" height="7" rx="3" fill={chip.fg2} />
                  <rect y="11" width="24" height="5" rx="2.5" fill={chip.fg2} opacity=".6" />
                </svg>
              </Box>
              <Box component="span" sx={{ mt: 0.75, opacity: 0.9 }}>{chip.name}</Box>
            </ButtonBase>
          )
        })}
      </Box>
      {pictures.length > 0 && (
        // The deck's pictures, each with why it is there and where it came from: the person sees
        // them (and can swap one) before the deck is published.
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="overline" sx={{ letterSpacing: '.12em', opacity: 0.75, lineHeight: 1.6, mx: 0.5 }}>Pictures</Typography>
          <Box role="list" aria-label="Presentation pictures" sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5, scrollbarWidth: 'none' }}>
            {pictures.map((picture) => (
              <Box role="listitem" key={picture.slot} data-presentation-picture={picture.slot} sx={{ flex: '0 0 auto', width: { xs: 140, sm: 168 }, bgcolor: 'rgba(255,255,255,.06)', borderRadius: '12px', p: 0.75 }}>
                <Box component="img" src={picture.url} alt={picture.why || picture.query || 'Presentation picture'} loading="lazy"
                  sx={{ width: '100%', height: 84, objectFit: 'cover', borderRadius: '8px', display: 'block', bgcolor: 'rgba(255,255,255,.08)' }} />
                <Typography variant="caption" component="p" sx={{ mt: 0.5, lineHeight: 1.25, opacity: 0.9, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{picture.why}</Typography>
                <Typography variant="caption" component="p" sx={{ opacity: 0.6, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {picture.source === 'generated' ? 'Generated for this deck' : picture.credit ? `From ${picture.credit.split(' · ')[0]}` : 'Searched (licensed for reuse)'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                  <Chip size="small" label="Another" disabled={busy || !onPicture || picture.source === 'generated'} onClick={() => onPicture?.(picture.slot, 'next')} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,.14)' }} />
                  <Chip size="small" label="Drawn art" disabled={busy || !onPicture} onClick={() => onPicture?.(picture.slot, 'art')} sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,.14)' }} />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Box sx={{ flex: '1 1 260px', minWidth: 0, display: 'flex', alignItems: 'center', bgcolor: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)', borderRadius: '999px', pl: 2 }}>
          <InputBase
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') send(text) }}
            placeholder="Tell Slatebox how to change it…"
            inputProps={{ 'aria-label': 'Tell Slatebox how to change the presentation' }}
            sx={{ flex: 1, color: '#fff', py: 0.75 }}
          />
          <IconButton aria-label="Send" disabled={busy || !text.trim()} onClick={() => send(text)} sx={{ color: '#fff' }}>
            <SendIcon fontSize="small" />
          </IconButton>
        </Box>
        {REFINE_PILLS.map((pill) => (
          <Chip key={pill.label} label={pill.label} variant="outlined" disabled={busy} onClick={() => send(pill.ask)} sx={{ color: '#fff', borderColor: 'rgba(255,255,255,.3)' }} />
        ))}
        <Chip label="Remix for this style" disabled={busy} onClick={onRemix} sx={{ color: '#111', bgcolor: '#fff', '&:hover': { bgcolor: '#eee' } }} />
      </Box>
    </Popover>
  )
}

StyleSheet.propTypes = {
  anchorEl: PropTypes.any,
  onClose: PropTypes.func.isRequired,
  current: PropTypes.string,
  onPick: PropTypes.func.isRequired,
  onRevert: PropTypes.func,
  canRevert: PropTypes.bool,
  onRefine: PropTypes.func.isRequired,
  onRemix: PropTypes.func.isRequired,
  busy: PropTypes.bool,
  pictures: PropTypes.arrayOf(PropTypes.shape({ slot: PropTypes.number, url: PropTypes.string, why: PropTypes.string, query: PropTypes.string, source: PropTypes.string, credit: PropTypes.string })),
  onPicture: PropTypes.func,
}
