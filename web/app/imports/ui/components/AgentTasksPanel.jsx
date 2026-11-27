// Agent tasks on this slate: what people and agents asked agents to do, who is on each, what is
// waiting for a person, and each task's shared log (agentTasks.forSlate). Anyone who can edit asks
// the Slatebox agent here, and approves or cancels what it held. The same tasks are on the API,
// the CLI, exec and every MCP client (agentTasks.*), so outside agents see and take them too.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtom } from 'jotai'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import Popper from '@mui/material/Popper'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AgentTasks } from '../../api/common/models'

const STATUS = {
  submitted: 'Waiting for an agent',
  working: 'Working',
  'input-required': 'Waiting for you',
  completed: 'Done',
  failed: 'Could not finish',
  canceled: 'Canceled',
}

// Open the tasks panel (true) or close it (false). The corner's agents menu opens it; it sits above the
// corner's presence pill (CornerPresence passes the pill as its anchor).
export const agentTasksOpenAtom = atom(false)

/**
 * This slate's agent tasks for someone who may see them (signed in, may edit; the server publishes
 * nothing to others): the list, how many are open, how many wait for this person.
 */
export function useAgentTasks(shareId, canEdit) {
  const tasks = useTracker(() => {
    if (!shareId || !canEdit) return []
    Meteor.subscribe('agentTasks.forSlate', shareId)
    return AgentTasks.find({ shareId }, { sort: { createdAt: -1 } }).fetch()
  }, [shareId, canEdit])
  const waiting = tasks.filter((task) => task.status === 'input-required').length
  const active = tasks.filter((task) => ['submitted', 'working', 'input-required'].includes(task.status)).length
  return { tasks, waiting, active }
}

export default function AgentTasksPanel({ shareId, canEdit, tasks = [], anchorEl = null }) {
  const [open, setOpen] = useAtom(agentTasksOpenAtom)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // Opened from the menu: focus moves into the panel, and back to the agents trigger when it closes.
  const paper = useRef(null)
  const shown = Boolean(canEdit && open && anchorEl)
  useEffect(() => { if (shown) setTimeout(() => paper.current?.focus(), 0) }, [shown])
  if (!shown) return null
  const close = () => {
    setOpen(false)
    anchorEl.querySelector?.('[data-agents-menu-open]')?.focus?.()
  }

  const call = async (method, input) => {
    setError('')
    try {
      await Meteor.callAsync(method, { shareId, ...input })
      return true
    } catch (e) {
      setError(e.reason || e.message || 'That did not work.')
      return false
    }
  }
  const ask = async (event) => {
    event.preventDefault()
    if (!text.trim()) return
    if (await call('agentTasks.create', { text: text.trim(), assignee: 'slatebox' })) setText('')
  }

  return (
    // Above the corner's presence pill, where Agent tasks was opened from (the agents menu).
    <Popper open anchorEl={anchorEl} placement="top-start" sx={{ zIndex: 1300 }} modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}>
      <ClickAwayListener onClickAway={(event) => { if (!anchorEl.contains(event.target)) setOpen(false) }}>
        <Paper elevation={6} ref={paper} tabIndex={-1} data-agent-tasks="" role="region" aria-label="Agent tasks" onKeyDown={(e) => { if (e.key === 'Escape') close() }}
          sx={{ width: 360, maxWidth: 'calc(100vw - 32px)', maxHeight: '60vh', overflow: 'auto', p: 1.5, borderRadius: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2" component="h2">Agent tasks</Typography>
            <Button size="small" onClick={close} data-agent-tasks-close="">Close</Button>
          </Box>
          {canEdit && (
            <Box component="form" onSubmit={ask} sx={{ display: 'flex', gap: 1, mb: 1 }}>
              <TextField size="small" fullWidth value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the Slatebox agent…" inputProps={{ maxLength: 500, 'data-agent-tasks-input': true }} />
              <Button type="submit" size="small" variant="contained" data-agent-tasks-ask>Ask</Button>
            </Box>
          )}
          {error && <Typography variant="caption" color="error" role="alert">{error}</Typography>}
          {!tasks.length && <Typography variant="body2" color="text.secondary">No tasks yet. Ask here, @Slatebox in a comment, or from any MCP client.</Typography>}
          {tasks.map((task) => (
            <Box key={task._id} data-agent-task={task._id} data-status={task.status} sx={{ borderTop: 1, borderColor: 'divider', py: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip size="small" label={STATUS[task.status] || task.status} color={task.status === 'input-required' ? 'warning' : task.status === 'completed' ? 'success' : 'default'} />
                <Typography variant="caption" color="text.secondary">
                  {task.askedBy} → {task.claimedBy || (task.assignee === 'slatebox' ? 'Slatebox agent' : 'any agent')}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{task.text}</Typography>
              {task.waiting && <Typography variant="body2" sx={{ mt: 0.5 }} data-agent-task-waiting>{task.waiting}</Typography>}
              {task.status === 'failed' && task.assignee === 'slatebox' && (
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                  <Button size="small" data-agent-task-replan onClick={() => call('agentTasks.create', { text: task.text, assignee: 'slatebox', ...(task.nodeId && { nodeId: task.nodeId }) })}>Plan again</Button>
                </Box>
              )}
              {canEdit && task.status === 'input-required' && (
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                  <Button size="small" variant="contained" data-agent-task-approve onClick={() => call('agentTasks.update', { taskId: task._id, action: 'approve' })}>Approve</Button>
                  <Button size="small" data-agent-task-cancel onClick={() => call('agentTasks.update', { taskId: task._id, action: 'cancel' })}>Cancel</Button>
                </Box>
              )}
              <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {(task.log || []).map((entry, index) => (
                  <Typography component="li" variant="caption" key={index} sx={{ display: 'list-item', overflowWrap: 'anywhere' }} data-agent-task-log={entry.kind}>
                    <b>{entry.by}</b>: {entry.text}
                  </Typography>
                ))}
              </Box>
            </Box>
          ))}
        </Paper>
      </ClickAwayListener>
    </Popper>
  )
}

AgentTasksPanel.propTypes = {
  shareId: PropTypes.string,
  canEdit: PropTypes.bool,
  // eslint-disable-next-line react/forbid-prop-types
  tasks: PropTypes.array,
  // eslint-disable-next-line react/forbid-prop-types
  anchorEl: PropTypes.object,
}
