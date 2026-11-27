// The small marks the corner's presence pill stacks: a person's round avatar, an agent's hexagon, and
// the "+N" for the rest. People and agents differ by shape, not only by colour.
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import { initialsOf } from '../../../api/common/corner-model.mjs'

export const MARK = 26

/** The pill's colours, light or dark, from the theme's shell palette. */
export function pillColors(theme) {
  const shell = theme.palette.shell || {}
  const dark = theme.palette.mode === 'dark'
  return {
    surface: shell.surface || '#fffef8',
    ink: shell.ink || '#193c2f',
    ink2: shell.secondaryInk || '#486351',
    border: shell.border || '#c6d1bf',
    offset: shell.offset || '#edf0e5',
    focus: dark ? '#f2ce8b' : '#223e32',
    warn: dark ? '#f0a35e' : '#b5651d',
    warnInk: dark ? '#17251f' : '#fff',
    speaking: dark ? '#7fd1a3' : '#2f8f6b',
    shadow: dark ? '0 2px 12px rgb(0 0 0 / 40%)' : '0 2px 10px rgb(25 53 41 / 12%)',
  }
}

/** A person: a round avatar in their colour with their initials ("Y" for you), ringed while speaking. */
export function PersonMark({ person, colors, z = 0, size = MARK }) {
  const ring = `0 0 0 2px ${colors.surface}`
  return (
    <Box component="span" aria-hidden="true" data-person-mark={person.you ? 'you' : ''} data-speaking={person.speaking ? '' : undefined}
      sx={{
        position: 'relative', zIndex: z, width: size, height: size, borderRadius: '50%', flex: 'none',
        display: 'grid', placeItems: 'center', bgcolor: person.color || '#486351', color: '#fff',
        fontSize: size * 0.42, fontWeight: 700, letterSpacing: '.02em', lineHeight: 1,
        boxShadow: person.speaking ? `${ring}, 0 0 0 4px ${colors.speaking}` : ring,
      }}>
      {initialsOf(person.name, person.you)}
    </Box>
  )
}
PersonMark.propTypes = {
  person: PropTypes.shape({ name: PropTypes.string, color: PropTypes.string, you: PropTypes.bool, speaking: PropTypes.bool }).isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
  z: PropTypes.number,
  size: PropTypes.number,
}

/** An agent: a hexagon in its colour with its first letter; grey while agents are paused. */
export function AgentMark({ name, color, colors, z = 0, paused = false, size = MARK }) {
  return (
    <Box component="span" aria-hidden="true" data-agent-mark=""
      sx={{ position: 'relative', zIndex: z, width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center',
        ...(paused && { filter: 'grayscale(1)', opacity: 0.55 }) }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ position: 'absolute', inset: 0 }}>
        <path d="M12 1.6l9 5.2v10.4L12 22.4 3 17.2V6.8z" fill={color} stroke={colors.surface} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <Box component="span" sx={{ position: 'relative', color: '#fff', fontSize: size * 0.42, fontWeight: 700, lineHeight: 1 }}>
        {String(name || '?').trim().charAt(0).toUpperCase()}
      </Box>
    </Box>
  )
}
AgentMark.propTypes = {
  name: PropTypes.string,
  color: PropTypes.string.isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
  z: PropTypes.number,
  paused: PropTypes.bool,
  size: PropTypes.number,
}

/** "+3": how many more than the stack shows. */
export function MoreMark({ count, colors }) {
  return (
    <Box component="span" aria-hidden="true" data-more-mark=""
      sx={{ position: 'relative', minWidth: MARK, height: MARK, px: '5px', boxSizing: 'border-box', borderRadius: MARK / 2,
        display: 'grid', placeItems: 'center', bgcolor: colors.offset, color: colors.ink, fontSize: 11, fontWeight: 700,
        boxShadow: `0 0 0 2px ${colors.surface}` }}>
      +{count}
    </Box>
  )
}
MoreMark.propTypes = { count: PropTypes.number.isRequired, colors: PropTypes.objectOf(PropTypes.string).isRequired }

/** Overlapping marks: each one slightly under the one before it. */
export function Stack({ children }) {
  return <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', '& > * + *': { ml: '-6px' } }}>{children}</Box>
}
Stack.propTypes = { children: PropTypes.node }

/** The pill's own button look: a soft round hover, a visible focus ring. */
export const triggerSx = (colors) => ({
  position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px', height: 30, px: '6px', borderRadius: '15px',
  color: colors.ink, font: 'inherit', fontSize: 13, cursor: 'pointer',
  '&:hover, &[aria-expanded="true"]': { bgcolor: colors.offset },
  '&.Mui-focusVisible, &:focus-visible': { outline: `2px solid ${colors.focus}`, outlineOffset: 2 },
})
