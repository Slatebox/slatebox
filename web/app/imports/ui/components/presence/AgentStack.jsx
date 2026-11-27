// The agents on the slate in the corner's pill: up to three hexagons, then "+N", a "Paused" tag and a
// caret. As a button it opens the agents menu and carries the tasks badge; with no agents yet it reads
// "+ Agents" in words.
import React, { forwardRef } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Tooltip from '@mui/material/Tooltip'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { agentColor } from '../AgentPresenceListener'
import { AgentMark, MARK, MoreMark, Stack, triggerSx } from './marks'

/** The hexagons alone (also inside a phone's read-only button). */
export function AgentMarks({ agents, colors }) {
  return (
    <Stack>
      {agents.shown.map((agent, index) => (
        <AgentMark key={agent.key} name={agent.name} color={agentColor(agent.colorIndex)} colors={colors} z={10 - index} paused={agents.paused} />
      ))}
      {agents.more > 0 && <MoreMark count={agents.more} colors={colors} />}
    </Stack>
  )
}
AgentMarks.propTypes = {
  agents: PropTypes.shape({ shown: PropTypes.arrayOf(PropTypes.object).isRequired, more: PropTypes.number.isRequired, paused: PropTypes.bool }).isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
}

/** The tasks badge: how many need you, or a small dot while some are open. Its words are in the trigger's label. */
function Badge({ badge, colors }) {
  if (!badge) return null
  if (badge.kind === 'dot')
    return <Box component="span" aria-hidden="true" data-agent-tasks-badge="dot"
      sx={{ position: 'absolute', top: 1, right: 1, width: 8, height: 8, borderRadius: '50%', bgcolor: colors.ink2, boxShadow: `0 0 0 2px ${colors.surface}` }} />
  return (
    <Box component="span" aria-hidden="true" data-agent-tasks-badge={badge.count}
      sx={{ position: 'absolute', top: -7, right: -7, minWidth: 18, height: 18, px: '5px', boxSizing: 'border-box', borderRadius: '9px',
        display: 'grid', placeItems: 'center', bgcolor: colors.warn, color: colors.warnInk, fontSize: 11, fontWeight: 700,
        boxShadow: `0 0 0 2px ${colors.surface}` }}>
      {badge.count > 99 ? '99+' : badge.count}
    </Box>
  )
}
Badge.propTypes = { badge: PropTypes.shape({ kind: PropTypes.string, count: PropTypes.number }), colors: PropTypes.objectOf(PropTypes.string).isRequired }

/** The agents menu's trigger. */
const AgentStack = forwardRef(function AgentStack({ agents, colors, open, menuId, onOpen }, ref) {
  return (
    <Tooltip title="Agents on this slate" placement="top" disableHoverListener={open} describeChild>
      <ButtonBase ref={ref} data-agents-menu-open="" aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined} aria-label={agents.label} onClick={onOpen} sx={triggerSx(colors)}>
        {agents.empty ? (
          <>
            <Box component="span" aria-hidden="true"
              sx={{ width: MARK, height: MARK, boxSizing: 'border-box', display: 'grid', placeItems: 'center', color: colors.ink2,
                border: `1.5px dashed ${colors.border}`, borderRadius: '7px', fontSize: 15, lineHeight: 1 }}>+</Box>
            <Box component="span" sx={{ fontSize: 12.5, fontWeight: 600 }}>Agents</Box>
          </>
        ) : <AgentMarks agents={agents} colors={colors} />}
        {agents.paused && <Box component="span" aria-hidden="true" data-agents-paused="" sx={{ fontSize: 11, fontWeight: 700, color: colors.warn }}>Paused</Box>}
        <ArrowDropDownIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2, mx: '-5px' }} />
        <Badge badge={agents.badge} colors={colors} />
      </ButtonBase>
    </Tooltip>
  )
})
AgentStack.propTypes = {
  agents: PropTypes.shape({ label: PropTypes.string, empty: PropTypes.bool, paused: PropTypes.bool, badge: PropTypes.object }).isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
  open: PropTypes.bool,
  menuId: PropTypes.string,
  onOpen: PropTypes.func.isRequired,
}
export default AgentStack
