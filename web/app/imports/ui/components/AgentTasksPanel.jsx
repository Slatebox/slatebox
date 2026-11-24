// Agent tasks on this slate: what people and agents asked agents to do, who is on each, what is
// waiting for a person, and each task's shared log (agentTasks.forSlate). Anyone who can edit asks
// the Slatebox agent here, and approves or cancels what it held. The same tasks are on the API,
// the CLI, exec and every MCP client (agentTasks.*), so outside agents see and take them too.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
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

export default function AgentTasksPanel({ shareId, canEdit }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  // Task text and logs are for people who can edit the slate; the server publishes nothing to others.
  const tasks = useTracker(() => {
    if (!shareId || !canEdit) return []
    Meteor.subscribe('agentTasks.forSlate', shareId)
    return AgentTasks.find({ shareId }, { sort: { createdAt: -1 } }).fetch()
  }, [shareId, canEdit])
  const waiting = tasks.filter((task) => task.status === 'input-required').length
  const active = tasks.filter((task) => ['submitted', 'working', 'input-required'].includes(task.status)).length
  if (!canEdit) return null

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
    // Right of the canvas's Undo and Redo when they sit in the same corner (UndoRedoControls sets the variable).
    <Box data-agent-tasks sx={{ position: 'fixed', left: 'calc(var(--sb-undo-redo-end, 8px) + 8px)', bottom: 16, zIndex: 1200, maxWidth: 'calc(100vw - var(--sb-undo-redo-end, 8px) - 24px)' }}>
      {!open ? (
        <Button variant="contained" size="small" data-agent-tasks-open onClick={() => setOpen(true)}>
          Agent tasks{active ? ` · ${active}` : ''}{waiting ? ' · needs you' : ''}
        </Button>
      ) : (
        <Paper elevation={6} sx={{ width: 360, maxWidth: '100%', maxHeight: '60vh', overflow: 'auto', p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="subtitle2">Agent tasks</Typography>
            <Button size="small" onClick={() => setOpen(false)}>Close</Button>
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
      )}
    </Box>
  )
}

AgentTasksPanel.propTypes = {
  shareId: PropTypes.string,
  canEdit: PropTypes.bool,
}
