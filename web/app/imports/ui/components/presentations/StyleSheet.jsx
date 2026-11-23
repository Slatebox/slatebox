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
 * The style sheet: one click restyles the deck (the same steps composed in another style, no AI),
 * and the chat refines it with Slatebox (`onRefine`, the planner's conversation).
 */
export default function StyleSheet({ anchorEl, onClose, current, onPick, onRefine, onRemix, busy = false }) {
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', mb: 1.25, mx: 0.5 }}>
        <Typography variant="overline" sx={{ letterSpacing: '.12em', opacity: 0.75, lineHeight: 1.6 }}>Style</Typography>
        <Typography variant="caption" sx={{ opacity: 0.7 }}>Switching keeps your steps · no AI call</Typography>
      </Box>
      <Box role="radiogroup" aria-label="Presentation style" sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5, scrollbarWidth: 'none' }}>
        {STYLE_CHIPS.map((chip) => {
          const on = chip.id === current
          return (
            <ButtonBase
              key={chip.id}
              role="radio"
              aria-checked={on}
              aria-label={`${chip.name}: ${chip.blurb}`}
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
  onRefine: PropTypes.func.isRequired,
  onRemix: PropTypes.func.isRequired,
  busy: PropTypes.bool,
}
