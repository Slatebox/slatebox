import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import InputBase from '@mui/material/InputBase'
import Typography from '@mui/material/Typography'
import UndoIcon from '@mui/icons-material/Undo'
import { STYLE_CHIPS } from '../presentations/presentationStyles.mjs'
import { hasStyleOriginal, revertToOriginal, setSlateBackground, takeOffStyle, wearStyle, wornStyle } from '../presentations/presentationBake.mjs'

/**
 * Draw a styled (or unstyled) slate as one step of this person's own undo: the engine replaces the
 * slate with it, and the room and the save path take the same replacement.
 */
export async function replaceSlateAsOwnStep(slate, doc, action) {
  const engine = slate?.v2 ?? slate
  if (!engine?.ownStep || !engine?.invoker?.onSlateReplaced) throw new Error('This slate cannot change its style here.')
  const snapshot = JSON.stringify(doc)
  await engine.ownStep(() => engine.invoker.onSlateReplaced({ type: 'onSlateReplaced', data: { snapshot } }))
  engine.broadcast?.('onSlateReplaced', { action, snapshot })
  return snapshot
}

/** Background colors to pick from: each style's own background, and white. */
export const BACKGROUND_SWATCHES = [
  ...STYLE_CHIPS.map((chip) => ({ color: chip.bg.toLowerCase(), name: `${chip.name} background` })),
  { color: '#ffffff', name: 'White' },
].filter((swatch, index, all) => all.findIndex((other) => other.color === swatch.color) === index)

const HEX = /^#[0-9a-f]{6}$/i

/**
 * The slate's style, one property of the slate (options.style): one click and the slate wears a
 * style (its background, its notes' outlines, fills, fonts and colors, its lines and the style's
 * decoration, all real and editable on the canvas). Nothing on the slate is lost: a style only adds
 * its art and restyles notes, and the first time the slate wears one its original is kept, so
 * "Revert to original" always brings it back exactly. "Remove style" takes off the style's
 * decoration and keeps every note and word. The background below is part of the style too. A
 * presentation's title cards and captions come from Present's style picker, which wears the same
 * style with the deck's words. `slate` is the live engine the drawer holds (the shared slate atom
 * keeps only a JSON copy, which cannot wear anything).
 */
export default function SlateStyle({ slate = null }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  // Bumped after each change, so the panel reads the slate again.
  const [version, setVersion] = useState(0)
  let doc = null
  try { doc = slate?.exportJSON?.() ?? null } catch { doc = null }
  const worn = doc ? wornStyle(doc) : null
  const original = doc ? hasStyleOriginal(doc) : false
  const background = String(doc?.options?.containerStyle?.backgroundColor || '').toLowerCase()
  const [hex, setHex] = useState(background)
  useEffect(() => { setHex(HEX.test(background) ? background : '') }, [background, version])

  const run = async (make, action) => {
    setBusy(true)
    setProblem('')
    try {
      await replaceSlateAsOwnStep(slate, make(slate.exportJSON()), action)
      setVersion((v) => v + 1)
    } catch (error) {
      setProblem(error?.message || 'The style could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  const pickBackground = (color) => {
    if (!HEX.test(color) || color.toLowerCase() === background) return
    run((json) => setSlateBackground(json, color), 'style-background')
  }

  return (
    <Box data-slate-style-panel>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Pick a style: the slate takes its colors, fonts, shapes and art, and Present shows exactly what the canvas shows. Nothing on your slate is lost.
      </Typography>
      <Box role="radiogroup" aria-label="Slate style" sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
        {STYLE_CHIPS.map((chip) => {
          const on = worn?.id === chip.id
          return (
            <ButtonBase
              key={chip.id}
              role="radio"
              aria-checked={on}
              aria-label={`Wear ${chip.name}: ${chip.blurb}`}
              data-slate-style-chip={chip.id}
              disabled={busy}
              onClick={() => run((json) => wearStyle(json, { id: chip.id }, { ambient: true }).slate, 'style')}
              sx={{ flexDirection: 'column', borderRadius: '10px', fontSize: 12, fontWeight: 600 }}
            >
              <Box sx={{ position: 'relative', width: '100%', height: 44, borderRadius: '10px', overflow: 'hidden', background: chip.bg, border: '2px solid', borderColor: on ? 'primary.main' : 'divider' }}>
                <svg viewBox="-10 -10 120 120" width="36" height="36" style={{ position: 'absolute', left: 6, top: 3 }} aria-hidden="true">
                  <path d={chip.path} fill={chip.fg} />
                </svg>
              </Box>
              <Box component="span" sx={{ mt: 0.5 }}>{chip.name}</Box>
            </ButtonBase>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mt: 1.5 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<UndoIcon />}
          disabled={busy || !original}
          onClick={() => run((json) => revertToOriginal(json).slate, 'style-revert')}
          data-slate-style-revert
        >
          Revert to original
        </Button>
        {worn && (
          <Button size="small" disabled={busy} onClick={() => run((json) => takeOffStyle(json), 'style-off')} data-slate-style-off>
            Remove style
          </Button>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
        {original ? 'Revert to original brings back the slate exactly as it was before its first style.' : 'Once the slate wears a style, Revert to original brings it back as it is now.'}
        {worn ? ' Remove style takes off the decoration and keeps every note and word.' : ''}
      </Typography>

      <Typography component="h3" variant="overline" sx={{ display: 'block', mt: 2, letterSpacing: '.1em' }}>Background</Typography>
      <Box role="radiogroup" aria-label="Background color" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
        {BACKGROUND_SWATCHES.map((swatch) => {
          const on = swatch.color === background
          return (
            <ButtonBase
              key={swatch.color}
              role="radio"
              aria-checked={on}
              aria-label={swatch.name}
              title={swatch.name}
              data-slate-background={swatch.color}
              disabled={busy}
              onClick={() => pickBackground(swatch.color)}
              sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: swatch.color, border: '2px solid', borderColor: on ? 'primary.main' : 'divider', boxShadow: on ? (theme) => `0 0 0 2px ${theme.palette.background.paper} inset` : 'none' }}
            />
          )
        })}
      </Box>
      <Box
        component="form"
        onSubmit={(event) => { event.preventDefault(); pickBackground(hex.trim()) }}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}
      >
        <Box aria-hidden="true" sx={{ width: 20, height: 20, borderRadius: '6px', border: 1, borderColor: 'divider', bgcolor: HEX.test(hex.trim()) ? hex.trim() : 'transparent' }} />
        <InputBase
          value={hex}
          disabled={busy}
          onChange={(event) => setHex(event.target.value)}
          onBlur={() => pickBackground(hex.trim())}
          placeholder="#1a2b3c"
          inputProps={{ 'aria-label': 'Background color (hex)', spellCheck: false, maxLength: 7, 'data-slate-background-hex': true }}
          sx={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 13, px: 1, py: 0.25, border: 1, borderColor: 'divider', borderRadius: '8px' }}
        />
      </Box>
      {problem && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{problem}</Typography>}
    </Box>
  )
}

SlateStyle.propTypes = {
  slate: PropTypes.shape({ exportJSON: PropTypes.func }),
}
