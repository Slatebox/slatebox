// Everyone on the slate, read-only: opened from the people group on the corner's pill (and its "+N").
// On a phone viewing the slate it lists the agents too, each with who added it and what it is doing.
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Popover from '@mui/material/Popover'
import { agentColor } from '../AgentPresenceListener'
import { AgentMark, PersonMark } from './marks'

const headSx = (colors) => ({ m: 0, px: 1, pt: 0.75, pb: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: colors.ink2 })
const rowSx = { display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.625, fontSize: 13.5 }

export default function PeopleList({ anchorEl, open, onClose, people, rows = [], agents = [], paused = false, colors }) {
  const byKey = new Map(agents.map((agent) => [agent.key, agent]))
  return (
    <Popover open={open} anchorEl={anchorEl} onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{ paper: { 'data-people-list': '', role: 'dialog', 'aria-label': 'On this slate',
        sx: { mt: -1, p: 0.75, width: 280, maxWidth: 'calc(100vw - 24px)', maxHeight: '60vh', overflow: 'auto', borderRadius: 3.5,
          bgcolor: colors.surface, color: colors.ink, border: `1px solid ${colors.border}`, boxShadow: '0 8px 28px rgb(0 0 0 / 22%)' } } }}>
      <Box component="h2" sx={headSx(colors)}>People here · {people.length}</Box>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {people.map((person) => (
          <Box component="li" key={person.key} sx={rowSx} data-person={person.you ? 'you' : person.name}>
            <PersonMark person={person} colors={colors} size={24} />
            <Box component="span" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{person.name}</Box>
            {person.speaking && <Box component="span" sx={{ ml: 'auto', fontSize: 12, color: colors.ink2 }}>speaking</Box>}
          </Box>
        ))}
      </Box>
      {rows.length > 0 && (
        <>
          <Box component="h2" sx={{ ...headSx(colors), mt: 0.5, borderTop: `1px solid ${colors.border}`, pt: 1 }}>Agents here · {rows.length}</Box>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {rows.map((row) => (
              <Box component="li" key={row.key} sx={rowSx} data-agent-row={row.agentId} aria-label={row.label}>
                <AgentMark name={row.name} color={agentColor(byKey.get(row.key)?.colorIndex)} colors={colors} paused={paused} size={24} />
                <Box sx={{ minWidth: 0 }} aria-hidden="true">
                  <Box sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</Box>
                  {(row.byline || row.status || row.waiting) && (
                    <Box sx={{ fontSize: 12, color: colors.ink2 }}>{[row.byline, row.status, row.waiting].filter(Boolean).join(' · ')}</Box>
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </>
      )}
    </Popover>
  )
}
PeopleList.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  anchorEl: PropTypes.object,
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  people: PropTypes.array.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  rows: PropTypes.array,
  // eslint-disable-next-line react/forbid-prop-types
  agents: PropTypes.array,
  paused: PropTypes.bool,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
}
