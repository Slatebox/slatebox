import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import InputBase from '@mui/material/InputBase'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import UndoIcon from '@mui/icons-material/Undo'
import CheckIcon from '@mui/icons-material/Check'
import CONSTANTS from '../../../api/common/constants'
import { STYLE_CHIPS, STYLES, textOn } from '../presentations/presentationStyles.mjs'
import { shownBackground } from '../presentations/presentationBackground.mjs'
import { GradientPicker, PicturePicker } from './StyleBackground'
import { hasStyleOriginal, playsWornStyle, revertToOriginal, revertedPresentation, setSlateBackground, takeOffStyle, wearStyle, wornStyle } from '../presentations/presentationBake.mjs'

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
  ...STYLE_CHIPS.map((chip) => ({ color: chip.bg.toLowerCase(), name: chip.name, label: `${chip.name} background` })),
  { color: '#ffffff', name: 'White', label: 'White' },
].filter((swatch, index, all) => all.findIndex((other) => other.color === swatch.color) === index)

const HEX = /^#[0-9a-f]{6}$/i
const HEX_HINT = 'Use a color like #1a2b3c.'

/**
 * "Revert to original" for the slate and for every saved presentation of it that plays a worn
 * style's deck: the slate goes back to its original (revertToOriginal, one undoable step), and each
 * such presentation gets back the deck kept with the original, or the camera over the slate as it
 * is again (revertedPresentation, the same routine Present's own Revert uses), so no saved deck
 * still points at style art the revert took away.
 */
export async function revertSlateAndPresentations(slate, { call = (...args) => Meteor.callAsync(...args) } = {}) {
  const { slate: back, presentation } = revertToOriginal(slate.exportJSON())
  await replaceSlateAsOwnStep(slate, back, 'style-revert')
  const slateShareId = slate?.shareId ?? slate?.options?.shareId
  if (!slateShareId) return back
  const saved = await call(CONSTANTS.methods.presentations.get, { slateShareId, asPublished: false })
  for (const row of saved?.presentations || []) {
    if (!playsWornStyle(row)) continue
    const revert = revertedPresentation(back, presentation, row.viewpoints)
    await call(CONSTANTS.methods.presentations.update, { presentationId: row._id, revert })
  }
  return back
}

/**
 * The slate's style, one property of the slate (options.style): one click and the slate wears a
 * style (its background, its notes' outlines, fills, fonts and colors, its lines and the style's
 * decoration, all real and editable on the canvas). No note or word of anyone's is removed: a style
 * adds its art and restyles notes, and the first time the slate wears one its original is kept, so
 * "Revert to original" brings back its notes, layout and background (keeping notes and words added
 * since). "Remove style" takes off the style's decoration and the words it wrote, and keeps every
 * note and word of the slate's own. The background below (a color, a gradient or a picture) is
 * part of the style too. A
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
  // The engine exports the slate as text (or, in some hosts, as an object).
  try {
    const exported = slate?.exportJSON?.() ?? null
    doc = typeof exported === 'string' ? JSON.parse(exported) : exported
  } catch { doc = null }
  const worn = doc ? wornStyle(doc) : null
  const original = doc ? hasStyleOriginal(doc) : false
  const background = String(doc?.options?.containerStyle?.backgroundColor || '').toLowerCase()
  // What the background is now: a color, a gradient or a picture (with the color laid over it).
  const shown = shownBackground(doc?.options?.containerStyle)
  const [mode, setMode] = useState(shown.mode)
  useEffect(() => { setMode(shown.mode) }, [shown.mode, version])
  const [hex, setHex] = useState(background)
  useEffect(() => { setHex(HEX.test(background) ? background : '') }, [background, version])

  const [hexProblem, setHexProblem] = useState('')
  const swatchRefs = useRef([])
  const act = async (work) => {
    setBusy(true)
    setProblem('')
    try {
      await work()
      setVersion((v) => v + 1)
    } catch (error) {
      setProblem(error?.reason || error?.message || 'The style could not be changed.')
    } finally {
      setBusy(false)
    }
  }
  const run = (make, action) => act(() => replaceSlateAsOwnStep(slate, make(slate.exportJSON()), action))
  const pickBackground = (color) => {
    if (busy) return
    const value = String(color || '').trim()
    if (!HEX.test(value)) {
      setHexProblem(value ? HEX_HINT : '')
      return
    }
    setHexProblem('')
    if (value.toLowerCase() === background && shown.mode === 'color') return
    run((json) => setSlateBackground(json, value), 'style-background')
  }
  // A gradient ({ gradient }) or a picture ({ color, picture }), the same one step of undo.
  const applyBackground = (value) => { if (!busy) run((json) => setSlateBackground(json, value), 'style-background') }
  // The colors to dim a picture with: the style's own background, black and white.
  const styleBg = STYLES[worn?.id]?.bg?.toLowerCase()
  const tints = [
    ...(styleBg ? [{ color: styleBg, name: STYLES[worn.id].name }] : []),
    { color: '#000000', name: 'Black' },
    { color: '#ffffff', name: 'White' },
    ...(shown.mode === 'picture' ? [{ color: shown.color, name: 'Now' }] : []),
  ].filter((tint, index, all) => all.findIndex((other) => other.color === tint.color) === index)
  // The swatches are one radio group: one tab stop (the chosen swatch, else the first), and the
  // arrow keys move between them (and choose, as radios do).
  const swatchIndex = Math.max(0, BACKGROUND_SWATCHES.findIndex((swatch) => shown.mode === 'color' && swatch.color === background))
  const onSwatchKey = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? BACKGROUND_SWATCHES.length - 1 : step ? (index + step + BACKGROUND_SWATCHES.length) % BACKGROUND_SWATCHES.length : null
    if (to === null) return
    event.preventDefault()
    swatchRefs.current[to]?.focus()
    pickBackground(BACKGROUND_SWATCHES[to].color)
  }

  return (
    <Box data-slate-style-panel>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Pick a style: the slate takes its colors, fonts, shapes and art, and Present shows exactly what the canvas shows. No note or word of yours is removed.
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
          onClick={() => act(() => revertSlateAndPresentations(slate))}
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
        {original ? 'Revert to original brings back the notes, layout and background from before the first style. Notes and words added since are kept.' : 'Once the slate wears a style, Revert to original brings back its notes, layout and background as they are now.'}
        {worn ? ' Remove style takes off the style\'s decoration and the words it wrote, and keeps every note and word of yours.' : ''}
      </Typography>

      <Typography component="h3" variant="overline" sx={{ display: 'block', mt: 2, letterSpacing: '.1em' }}>Background</Typography>
      <ToggleButtonGroup size="small" exclusive fullWidth value={mode} aria-label="Background kind" onChange={(_, next) => next && setMode(next)} sx={{ mt: 0.5, mb: 1 }}>
        <ToggleButton value="color" data-slate-background-mode="color">Color</ToggleButton>
        <ToggleButton value="gradient" data-slate-background-mode="gradient">Gradient</ToggleButton>
        <ToggleButton value="picture" data-slate-background-mode="picture">Picture</ToggleButton>
      </ToggleButtonGroup>
      {mode === 'gradient' && <GradientPicker current={shown.mode === 'gradient' ? shown.gradient : null} busy={busy} onApply={(gradient) => applyBackground({ gradient })} />}
      {mode === 'picture' && (
        <PicturePicker current={shown.mode === 'picture' ? shown.picture : null} color={shown.color} tints={tints} busy={busy}
          onApply={(picture, color) => applyBackground({ color, picture })} onRemove={() => applyBackground({ color: shown.color })} />
      )}
      {mode === 'color' && (<>
      <Box role="radiogroup" aria-label="Background color" sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 0.75, mt: 0.5 }}>
        {BACKGROUND_SWATCHES.map((swatch, index) => {
          const on = shown.mode === 'color' && swatch.color === background
          return (
            <ButtonBase
              key={swatch.color}
              ref={(el) => { swatchRefs.current[index] = el }}
              role="radio"
              aria-checked={on}
              aria-label={swatch.label}
              tabIndex={index === swatchIndex ? 0 : -1}
              data-slate-background={swatch.color}
              // Never disabled while a change saves: a disabled swatch drops the keyboard's focus.
              aria-disabled={busy || undefined}
              onClick={() => pickBackground(swatch.color)}
              onKeyDown={(event) => onSwatchKey(event, index)}
              sx={{ flexDirection: 'column', gap: 0.25, borderRadius: '8px', p: 0.25, fontSize: 11, fontWeight: on ? 700 : 500 }}
            >
              <Box component="span" aria-hidden="true" sx={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: '50%', bgcolor: swatch.color, color: textOn(swatch.color), border: '2px solid', borderColor: on ? 'primary.main' : 'divider' }}>
                {on && <CheckIcon sx={{ fontSize: 16 }} />}
              </Box>
              <Box component="span">{swatch.name}</Box>
            </ButtonBase>
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
          onChange={(event) => { setHex(event.target.value); if (hexProblem) setHexProblem('') }}
          onBlur={() => pickBackground(hex.trim())}
          placeholder="#1a2b3c"
          error={Boolean(hexProblem)}
          inputProps={{ 'aria-label': 'Background color (hex)', 'aria-invalid': Boolean(hexProblem), 'aria-describedby': hexProblem ? 'slate-background-hex-problem' : undefined, spellCheck: false, maxLength: 7, 'data-slate-background-hex': true }}
          sx={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 13, px: 1, py: 0.25, border: 1, borderColor: hexProblem ? 'error.main' : 'divider', borderRadius: '8px' }}
        />
      </Box>
      {hexProblem && <Typography id="slate-background-hex-problem" role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }} data-slate-background-hex-problem>{hexProblem}</Typography>}
      </>)}
      {problem && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{problem}</Typography>}
    </Box>
  )
}

SlateStyle.propTypes = {
  slate: PropTypes.shape({ exportJSON: PropTypes.func, shareId: PropTypes.string }),
}
