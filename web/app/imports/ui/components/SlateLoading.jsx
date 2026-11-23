// The moment while a slate opens: the Slatebox tile mark in the middle of the page, its tiles
// settling into place one after another, and "Opening your slate…" under it. Calm, centred, and
// still for reduced motion (the tiles are simply there). Theme tokens only.
import React from 'react'
import { Box, Typography } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { TILES, AMBER } from './EmptyState'

// Each tile fades in amber in turn, holds, and the loop starts again.
const settle = keyframes`0%, 8% { fill-opacity: 0 } 22%, 78% { fill-opacity: 1 } 92%, 100% { fill-opacity: 0 }`
const breathe = keyframes`0%, 100% { opacity: .65 } 50% { opacity: 1 }`

// Once: each tile settles in and stays, so the mark is whole (a new slate's welcome).
const placed = keyframes`from { fill-opacity: 0; transform: translateY(-4px) } to { fill-opacity: 1; transform: none }`

/** The tile mark, its tiles settling in turn: on a loop while something loads, or `once` to arrive and stay. */
export function TileLoader({ size = 96, once = false }) {
  return <Box component="svg" viewBox="-34 -42 84 70" width={size} height={size * 70 / 84} aria-hidden="true" focusable="false"
    sx={{ color: 'text.secondary', overflow: 'visible', display: 'block',
      '& rect': { fill: AMBER, stroke: 'currentColor', strokeWidth: .9, strokeOpacity: once ? 0 : .45, vectorEffect: 'non-scaling-stroke' },
      '@media (prefers-reduced-motion: reduce)': { '& rect': { animation: 'none !important', fillOpacity: 1 } } }}>
    {TILES.map((t, i) => <Box component="rect" key={`${t.x},${t.y}`} x={t.x} y={t.y} width={t.w} height={t.h} rx={1.2}
      sx={once ? { fillOpacity: 0, animation: `${placed} .45s ${.15 + i * .09}s ease-out forwards` }
        : { fillOpacity: 0, animation: `${settle} 2.4s ${i * .18}s infinite ease-in-out` }} />)}
  </Box>
}

/** The whole page, or (`fill={false}`) the area it is placed in. */
export default function SlateLoading({ label = 'Opening your slate…', fill = true }) {
  return <Box role="status" aria-live="polite" sx={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2.5, textAlign: 'center',
    ...(fill ? { minHeight: '100svh' } : { position: 'absolute', inset: 0 }),
    bgcolor: fill ? 'background.default' : 'transparent', color: 'text.primary', p: 3, boxSizing: 'border-box',
  }}>
    <TileLoader />
    <Typography sx={{ color: 'text.secondary', fontSize: 16, fontWeight: 500, letterSpacing: '.01em',
      animation: `${breathe} 2.4s ease-in-out infinite`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}>{label}</Typography>
  </Box>
}
