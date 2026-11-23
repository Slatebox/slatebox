// A calm full-width message for a page or a list with nothing to show: the Slatebox tile mark
// drawn as the moment (a tile gone missing, or tiles waiting to be filled), a title, a line, and
// the way on. Theme tokens only, so it reads the same in light and dark.
import React from 'react'
import PropTypes from 'prop-types'
import { Link } from 'react-router-dom'
import { Box, Button, Typography } from '@mui/material'

// The mark's five tiles (public/brand/slatebox.svg), as rectangles.
const TILES = [
  { x: 1.596, y: 15.372, w: 14.893, h: 7.447 },
  { x: -16.489, y: -18.032, w: 14.893, h: 7.447 },
  { x: 1.596, y: -2.606, w: 14.893, h: 14.893 },
  { x: -25, y: -7.394, w: 23.404, h: 21.277 },
  { x: 1.596, y: -22.819, w: 23.404, h: 17.021 },
]
const AMBER = '#fbcc88'

// 'lost': one tile has wandered off and left its outline behind. 'empty': outlines waiting for
// their tiles, the first one placed.
export function TileArt({ variant = 'empty', size = 132 }) {
  const outline = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.9, strokeDasharray: '2.4 1.8', vectorEffect: 'non-scaling-stroke' }
  return (
    <Box component="svg" viewBox="-34 -42 84 70" width={size} height={size * 70 / 84} aria-hidden="true" focusable="false"
      sx={{ color: 'text.secondary', overflow: 'visible', display: 'block' }}>
      {TILES.map((t, i) => {
        const last = i === TILES.length - 1
        const filled = variant === 'lost' ? !last : i === 0
        return <rect key={`${t.x},${t.y}`} x={t.x} y={t.y} width={t.w} height={t.h} rx={1.2} style={filled ? { fill: AMBER } : outline} />
      })}
      {variant === 'lost' && (
        <g transform="translate(14 -14) rotate(14)">
          <rect x={4} y={-24} width={23.404} height={17.021} rx={1.2} style={{ fill: AMBER }} />
        </g>
      )}
    </Box>
  )
}

TileArt.propTypes = { variant: PropTypes.oneOf(['lost', 'empty']), size: PropTypes.number }

const linkButton = (item, variant) => (
  <Button key={item.label} component={Link} to={item.to} variant={variant} color="primary" disableElevation size="large"
    sx={{ borderRadius: 6, px: 3 }}>{item.label}</Button>
)

export default function EmptyState({ variant = 'empty', title, body, action, secondary, onClear, headingLevel = 'h2', fill = false }) {
  return (
    <Box role={fill ? undefined : 'status'} sx={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1.5,
      mx: 'auto', px: 2, py: { xs: 5, md: 8 }, maxWidth: 520, width: '100%', boxSizing: 'border-box',
      ...(fill && { minHeight: 'calc(100svh - 160px)', justifyContent: 'center' }),
    }}>
      <Box sx={{ mb: 1.5 }}><TileArt variant={variant} size={fill ? 164 : 128} /></Box>
      <Typography component={headingLevel} sx={{ fontWeight: 750, letterSpacing: '-.02em', fontSize: fill ? { xs: 28, md: 34 } : { xs: 22, md: 24 }, lineHeight: 1.15, color: 'text.primary' }}>
        {title}
      </Typography>
      {body && <Typography sx={{ color: 'text.secondary', fontSize: 16, lineHeight: 1.5, maxWidth: 440 }}>{body}</Typography>}
      {(action || secondary || onClear) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 1.25, mt: 1.5 }}>
          {action && linkButton(action, 'contained')}
          {secondary && linkButton(secondary, 'outlined')}
          {onClear && <Button variant="outlined" color="primary" size="large" sx={{ borderRadius: 6, px: 3 }} onClick={onClear}>Clear the filter</Button>}
        </Box>
      )}
    </Box>
  )
}

const destination = PropTypes.shape({ label: PropTypes.string.isRequired, to: PropTypes.string.isRequired })
EmptyState.propTypes = {
  variant: PropTypes.oneOf(['lost', 'empty']),
  title: PropTypes.string.isRequired,
  body: PropTypes.string,
  action: destination,
  secondary: destination,
  onClear: PropTypes.func,
  headingLevel: PropTypes.string,
  fill: PropTypes.bool,
}
