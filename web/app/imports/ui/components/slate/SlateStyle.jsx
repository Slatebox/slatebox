import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { useAtomValue } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Typography from '@mui/material/Typography'
import { STYLE_CHIPS } from '../presentations/presentationStyles.mjs'
import { takeOffStyle, wearStyle, wornStyle } from '../presentations/presentationBake.mjs'
import { currentSlate } from '../../jotai/atoms'

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

/**
 * The slate's style, one property of the slate (options.style) that replaces the old themes: one
 * click and the slate wears a style (its background, its notes' outlines, fills, fonts and colors,
 * its lines and the style's decoration, all real and editable on the canvas); Undo takes it back.
 * A presentation's title cards and captions come from Present's style picker, which wears the same
 * style with the deck's words. The Custom colors below set the background by hand.
 */
export default function SlateStyle({ children = null }) {
  const slate = useAtomValue(currentSlate)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  let worn = null
  try { worn = wornStyle(slate?.exportJSON?.() ?? null) } catch { worn = null }
  const run = async (make, action) => {
    setBusy(true)
    setProblem('')
    try {
      const doc = make(slate.exportJSON())
      await replaceSlateAsOwnStep(slate, doc, action)
    } catch (error) {
      setProblem(error?.message || 'The style could not be worn.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box data-slate-style-panel>
      <Typography variant="body2" sx={{ mb: 1 }}>
        Wear this style: the slate takes its colors, fonts, shapes and art, and Present shows exactly what the canvas shows.
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
      {worn && (
        <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={() => run((json) => takeOffStyle(json), 'style-off')} data-slate-style-off>
          Take off style
        </Button>
      )}
      {problem && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>{problem}</Typography>}
      {children && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="overline" sx={{ letterSpacing: '.1em' }}>Custom</Typography>
          {children}
        </Box>
      )}
    </Box>
  )
}

SlateStyle.propTypes = {
  children: PropTypes.node,
}
