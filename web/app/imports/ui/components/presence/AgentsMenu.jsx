// The agents menu, opened from the agent group on the corner's pill: one row per agent on the slate
// (its details: plan, Keep all / Discard all, activity with Undo, Edit directly, an invited agent's own
// controls), then Agent tasks, + Invite agent and Pause all agents for people who may use them. A real
// menu: arrow keys move, Escape closes, focus goes back to the trigger.
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import ListSubheader from '@mui/material/ListSubheader'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import AddIcon from '@mui/icons-material/Add'
import ChecklistIcon from '@mui/icons-material/Checklist'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { agentColor } from '../AgentPresenceListener'
import { AgentMark } from './marks'

const itemSx = { borderRadius: 2, mx: 0.75, px: 1, minHeight: 36, gap: 1, fontSize: 13.5 }

export default function AgentsMenu({ id, anchorEl, open, onClose, model, agents, colors, busy = false, onAgent, onTasks, onInvite, onPause }) {
  const byKey = new Map(agents.map((agent) => [agent.key, agent]))
  const items = []
  if (model.rows.length) {
    items.push(
      <ListSubheader key="head" disableSticky
        sx={{ bgcolor: 'transparent', color: colors.ink2, fontSize: 12, fontWeight: 600, lineHeight: '28px', px: 1.75 }}>
        Agents on this slate · {model.rows.length}
      </ListSubheader>,
    )
    for (const row of model.rows) {
      const agent = byKey.get(row.key)
      items.push(
        <MenuItem key={'agent-' + row.key} data-agent-chip="" data-agent-id={row.agentId} aria-label={row.label + '. Open details'}
          onClick={() => onAgent(row.key)} sx={{ ...itemSx, py: 0.75 }}>
          <AgentMark name={row.name} color={agentColor(agent?.colorIndex)} colors={colors} paused={model.agents.paused} size={24} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</Box>
            {(row.byline || row.status) && (
              <Box sx={{ fontSize: 12, color: colors.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[row.byline, row.status].filter(Boolean).join(' · ')}
              </Box>
            )}
          </Box>
          {row.waiting && <Box component="span" sx={{ fontSize: 11.5, fontWeight: 700, color: colors.warn, whiteSpace: 'nowrap' }}>{row.waiting}</Box>}
          <ChevronRightIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2 }} />
        </MenuItem>,
      )
    }
  }
  const actions = []
  if (model.menu.tasks)
    actions.push(
      <MenuItem key="tasks" data-agent-tasks-open="" onClick={onTasks} sx={itemSx}>
        <ChecklistIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2 }} />
        <Box component="span" sx={{ fontWeight: 600 }}>Agent tasks</Box>
        <Box component="span" sx={{ ml: 'auto', pl: 2, fontSize: 12, color: colors.ink2 }}>{model.menu.tasksSummary}</Box>
      </MenuItem>,
    )
  if (model.menu.invite)
    actions.push(
      <MenuItem key="invite" data-invite-agent-open="" onClick={onInvite} sx={itemSx}>
        <AddIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2 }} />
        <Box component="span" sx={{ fontWeight: 600 }}>Invite agent</Box>
      </MenuItem>,
    )
  if (model.menu.pause)
    actions.push(
      <MenuItem key="pause" data-agents-pause="" disabled={busy} onClick={onPause} sx={itemSx}>
        {model.agents.paused || model.menu.pauseLabel === 'Resume agents'
          ? <PlayArrowIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2 }} />
          : <PauseIcon aria-hidden="true" sx={{ fontSize: 18, color: colors.ink2 }} />}
        <Box component="span" sx={{ fontWeight: 600 }}>{model.menu.pauseLabel}</Box>
      </MenuItem>,
    )
  if (items.length && actions.length) items.push(<Divider key="rule" sx={{ my: '4px !important', borderColor: colors.border }} />)
  return (
    <Menu id={id} anchorEl={anchorEl} open={open} onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      MenuListProps={{ 'aria-label': 'Agents', dense: true, sx: { py: 0.75 } }}
      slotProps={{ paper: { 'data-agents-menu': '', sx: { mt: -1, width: 300, maxWidth: 'calc(100vw - 24px)', borderRadius: 3.5, bgcolor: colors.surface, color: colors.ink, border: `1px solid ${colors.border}`, boxShadow: '0 8px 28px rgb(0 0 0 / 22%)' } } }}>
      {[...items, ...actions]}
    </Menu>
  )
}
AgentsMenu.propTypes = {
  id: PropTypes.string.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  anchorEl: PropTypes.object,
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  model: PropTypes.object.isRequired,
  // eslint-disable-next-line react/forbid-prop-types
  agents: PropTypes.array.isRequired,
  colors: PropTypes.objectOf(PropTypes.string).isRequired,
  busy: PropTypes.bool,
  onAgent: PropTypes.func.isRequired,
  onTasks: PropTypes.func.isRequired,
  onInvite: PropTypes.func.isRequired,
  onPause: PropTypes.func.isRequired,
}
