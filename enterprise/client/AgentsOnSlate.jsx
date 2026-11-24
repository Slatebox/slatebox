// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Invited agents on this slate (the canvas.agents slot): their chips, each with Keep all and
// Discard all while ghosts wait; the ask box (the inviter's only); "+ Invite agent"; and the
// ghosts themselves, drawn on the canvas for everyone (ghosts.js). The agent's named cursor is the
// existing agent presence (the server moves it to each ghost as it appears).
import React, { useMemo, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Paper from '@mui/material/Paper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AgentSuggestions, McpConnections } from './collections'
import { colorOf, useAgentGhosts } from './ghosts'
import InviteWalkthrough from './InviteWalkthrough'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'

// What a chip says about an agent that can't be asked right now (everyone sees it; the cursor's
// ghosts stay keepable either way).
const STATE_WORDS = { paused: 'paused: its tools changed', needs_sign_in: 'needs sign-in', pro_ended: 'Pro ended' }

function Hexagon({ color }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ marginLeft: 6 }}>
      <polygon points="21.5,12 16.75,20.23 7.25,20.23 2.5,12 7.25,3.77 16.75,3.77" fill={color} stroke="#fff" strokeWidth="1.5" />
    </svg>
  )
}
Hexagon.propTypes = { color: PropTypes.string.isRequired }

const errorText = (error) => error?.reason || error?.message || 'That did not work. Try again.'

export default function AgentsOnSlate({ slate, canEdit, readSelection }) {
  const shareId = slate?.shareId
  const userId = useTracker(() => Meteor.userId(), [])
  const guest = useTracker(() => Boolean(Meteor.user()?.isAnonymous), [])
  const { connections, suggestions } = useTracker(() => {
    if (!shareId) return { connections: [], suggestions: [] }
    Meteor.subscribe('connectors.forSlate', shareId)
    return {
      connections: McpConnections.find({}, { sort: { createdAt: 1 } }).fetch(),
      suggestions: AgentSuggestions.find({}, { sort: { createdAt: 1 } }).fetch(),
    }
  }, [shareId, userId])
  const [inviting, setInviting] = useState(false)
  const [reconnect, setReconnect] = useState(null)
  const { open: openPay } = usePaySheet()
  const [asking, setAsking] = useState(null) // connectionId
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const colors = useMemo(() => new Map(connections.map((c) => [c._id, colorOf(c.colorIndex)])), [connections])
  const colorFor = (connectionId) => colors.get(connectionId) || colorOf(1)

  const decide = async (suggestionId, n, keep) => {
    setNote('')
    try {
      await Meteor.callAsync(keep ? 'connectors.keep' : 'connectors.discard', { suggestionId, ...(n ? { n } : {}) })
    } catch (e) {
      setNote(errorText(e))
    }
  }
  useAgentGhosts(slate?.v2 ?? null, suggestions, { canEdit: Boolean(userId) && canEdit && !guest, colorFor, onDecide: decide, viewerId: userId })

  // Signed out: the ghosts and the cursor only.
  if (!shareId || !userId) return null
  const pendingFor = (connectionId) => suggestions.filter((s) => s.connectionId === connectionId).flatMap((s) => (s.items || []).filter((i) => i.status === 'pending').map((i) => ({ s, i })))
  const working = (connectionId) => suggestions.find((s) => s.connectionId === connectionId && s.status === 'working')
  const latest = (connectionId) => suggestions.filter((s) => s.connectionId === connectionId).at(-1)

  const ask = async (event) => {
    event.preventDefault()
    if (!request.trim() || !asking) return
    setBusy(true)
    setNote('')
    try {
      const result = await Meteor.callAsync('connectors.call', { connectionId: asking, request: request.trim(), selection: readSelection?.() || [] })
      setRequest('')
      setNote(result.items ? '' : result.say || 'It had nothing to suggest for that.')
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const decideAll = async (connectionId, keep) => {
    for (const s of suggestions.filter((doc) => doc.connectionId === connectionId && (doc.items || []).some((i) => i.status === 'pending')))
      await decide(s._id, null, keep)
  }
  const askingConnection = connections.find((c) => c._id === asking)
  // Sign in again: only the inviter sees the agent's address (connectors.list), so ask for it.
  const signInAgain = async (c) => {
    setNote('')
    try {
      const { connections: mine } = await Meteor.callAsync('connectors.list', { shareId })
      const own = mine.find((m) => m.connectionId === c._id)
      if (!own?.address) return setNote('That agent is not on this slate any more.')
      setReconnect({ connectionId: c._id, address: own.address, name: c.name })
      setInviting(true)
    } catch (e) {
      setNote(errorText(e))
    }
  }
  const renewPro = () => openPay({ action: 'pro', from: 'agents', reason: 'Invite outside agents onto your slates.', retry: () => Meteor.callAsync('connectors.list', { shareId }).catch(() => {}) })

  return (
    <Box data-agents-on-slate="" sx={{ position: 'fixed', left: 16, bottom: 128, zIndex: 1200, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start', maxWidth: 'calc(100vw - 32px)' }}>
      {askingConnection && (
        <Paper elevation={4} sx={{ p: 1.5, width: 360, maxWidth: '100%' }} data-agent-ask={askingConnection.name}>
          <Typography variant="subtitle2">Ask {askingConnection.name}</Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {askingConnection.contextLevel === 'selection' ? 'It sees what you type and the notes you select.' : askingConnection.contextLevel === 'slate' ? 'It sees what you type and the notes on this slate.' : 'It sees only what you type.'}
          </Typography>
          <Box component="form" onSubmit={ask} sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <TextField size="small" fullWidth autoFocus value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Draw how a card payment is retried" inputProps={{ maxLength: 1000, 'data-agent-request': '' }} disabled={busy} />
            <Button type="submit" variant="contained" disabled={busy || !request.trim()}>{busy ? 'Working…' : 'Ask'}</Button>
          </Box>
          {latest(asking)?.left?.length > 0 && <Typography variant="caption" component="div" sx={{ mt: 1 }}>{latest(asking).left.join(' ')}</Typography>}
          <Button size="small" onClick={() => setAsking(null)} sx={{ mt: 0.5 }}>Close</Button>
        </Paper>
      )}
      {note && <Paper role="status" sx={{ p: 1, maxWidth: 360 }}><Typography variant="body2">{note}</Typography></Paper>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {connections.map((c) => {
          const color = colorFor(c._id)
          const pending = pendingFor(c._id)
          const mine = c.ownerId === userId
          const run = working(c._id)
          return (
            <Paper key={c._id} variant="outlined" data-agent-chip-invited={c.name} data-agent-state={c.status} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, borderColor: color, borderStyle: 'dashed', ...(STATE_WORDS[c.status] && { opacity: 0.85 }) }}>
              <Chip size="small" variant="outlined" icon={<Hexagon color={STATE_WORDS[c.status] ? '#9aa1ad' : color} />} sx={{ border: 0 }}
                label={`${c.name} · added by ${mine ? 'you' : c.inviterName}${run ? ' · working…' : ''}${STATE_WORDS[c.status] ? ` · ${STATE_WORDS[c.status]}` : ''}${pending.length ? ` · ${pending.length} waiting` : ''}`}
                onClick={mine && c.status === 'active' ? () => setAsking(c._id) : undefined}
                aria-label={`${c.name}, an agent added by ${mine ? 'you' : c.inviterName}`} />
              {canEdit && !guest && pending.length > 0 && (
                <>
                  <Button size="small" variant="contained" data-agent-keep-all="" onClick={() => decideAll(c._id, true)} sx={{ bgcolor: color }}>Keep all</Button>
                  <Button size="small" data-agent-discard-all="" onClick={() => decideAll(c._id, false)}>Discard all</Button>
                </>
              )}
              {mine && c.status === 'needs_sign_in' && <Button size="small" variant="outlined" data-agent-sign-in-again="" onClick={() => signInAgain(c)}>Sign in again</Button>}
              {mine && c.status === 'pro_ended' && <Button size="small" variant="outlined" data-agent-renew-pro="" onClick={renewPro}>Renew Pro</Button>}
              {mine && <Button size="small" onClick={() => Meteor.callAsync('connectors.disconnect', { connectionId: c._id }).catch((e) => setNote(errorText(e)))}>Remove</Button>}
            </Paper>
          )
        })}
        {canEdit && !guest && (
          <Button size="small" variant="outlined" data-invite-agent-open="" onClick={() => setInviting(true)}>+ Invite agent</Button>
        )}
      </Box>
      <InviteWalkthrough open={inviting} onClose={() => { setInviting(false); setReconnect(null) }} shareId={shareId} slateName={slate?.options?.name} reconnect={reconnect}
        onInvited={(connection) => setAsking(connection.connectionId)} />
    </Box>
  )
}

AgentsOnSlate.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object.isRequired,
  canEdit: PropTypes.bool,
  readSelection: PropTypes.func,
}
