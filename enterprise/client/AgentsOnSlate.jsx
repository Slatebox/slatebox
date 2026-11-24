// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Invited agents on this slate. Each is one chip on the app's roster, like every agent: this file
// puts them there (rosterExtrasAtom) and fills the chip's popover (the agents.chip slot) with what
// only an invited agent has: the ask box (the inviter's only), Sign in again, Renew Pro and Remove.
// Keep all / Discard all, the activity with Undo and Edit directly are the roster's own, and the
// ghosts with Keep and Discard on each are the app's live suggestions (AgentPresenceListener).
// The canvas.agents slot holds "+ Invite agent" and the walkthrough.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { McpConnections } from './collections'
import InviteWalkthrough from './InviteWalkthrough'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import { agentColor, openAgentAtom, rosterExtrasAtom } from '/imports/ui/components/AgentPresenceListener.jsx'
import { askableAgentsAtom } from '/imports/ui/jotai/atoms'
import { agentChatReply } from '/imports/api/common/agent-mention.mjs'

// What a chip says about an agent that can't be asked right now (everyone sees it; its ghosts stay
// keepable either way).
export const STATE_WORDS = { paused: 'paused: its tools changed', needs_sign_in: 'needs sign-in', pro_ended: 'Pro ended' }

const errorText = (error) => error?.reason || error?.message || 'That did not work. Try again.'

// The canvas's readers (selection, visible area) and a reconnect request, shared between the
// canvas.agents slot and each chip's popover.
const readersAtom = atom({ readSelection: null, readView: null })
const reconnectAtom = atom(null) // { connectionId, address, name }

/** The roster entries for the invited agents on this slate. */
export function rosterEntries(connections) {
  return connections
    .filter((c) => c.agentId)
    .map((c) => ({ agentId: c.agentId, label: c.name, colorIndex: c.colorIndex ?? 1, invitedBy: c.mine ? 'you' : c.inviterName, state: STATE_WORDS[c.status] || null }))
}

/** Why an agent can't be asked from this screen now, in the words Ask Slatebox answers "@its name" with. */
export function cannotAskText(c) {
  if (!c.mine) return `Only ${c.inviterName || 'the person who invited it'} can ask ${c.name}.`
  if (c.status === 'needs_sign_in') return `${c.name} needs you to sign in again. Open its chip below the canvas to sign in.`
  if (c.status === 'pro_ended') return `Asking ${c.name} is part of Slatebox Pro. Open its chip below the canvas to renew Pro.`
  if (c.status === 'paused') return `${c.name}'s tools changed. Open its chip below the canvas to look at them again.`
  return ''
}

/** The agents Ask Slatebox can reach by "@name": each one's name, colour and how to ask it. */
export function askableEntries(connections, { readSelection, readView } = {}) {
  return connections
    .filter((c) => c.agentId)
    .map((c) => ({
      agentId: c.agentId,
      name: c.name,
      color: agentColor(c.colorIndex ?? 1),
      mine: Boolean(c.mine),
      inviterName: c.inviterName || '',
      canAsk: Boolean(c.mine) && c.status === 'active',
      why: cannotAskText(c),
      ask: (request) => {
        const view = readView?.() || null
        return Meteor.callAsync('connectors.call', { connectionId: c._id, request, selection: readSelection?.() || [], ...(view && { view }) })
      },
    }))
}

/** What the ask box says it may see. */
export const seesText = (level) => (level === 'selection' ? 'It sees what you type and the notes you select.' : level === 'slate' ? 'It sees what you type and the notes on this slate.' : 'It sees only what you type.')

function useConnections(shareId) {
  const userId = useTracker(() => Meteor.userId(), [])
  return useTracker(() => {
    if (!shareId || !userId) return []
    Meteor.subscribe('connectors.forSlate', shareId)
    return McpConnections.find({}, { sort: { createdAt: 1 } }).fetch()
  }, [shareId, userId])
}

/** canvas.agents: puts invited agents on the roster; "+ Invite agent" and the walkthrough. */
export default function AgentsOnSlate({ slate, canEdit, readSelection, readView, chatOpen = false }) {
  const shareId = slate?.shareId
  const userId = useTracker(() => Meteor.userId(), [])
  const guest = useTracker(() => Boolean(Meteor.user()?.isAnonymous), [])
  const connections = useConnections(shareId)
  const setExtras = useSetAtom(rosterExtrasAtom)
  const setReaders = useSetAtom(readersAtom)
  const setAskable = useSetAtom(askableAgentsAtom)
  const openAgent = useSetAtom(openAgentAtom)
  const [reconnect, setReconnect] = useAtom(reconnectAtom)
  const [inviting, setInviting] = useState(false)
  const entries = JSON.stringify(rosterEntries(connections))
  useEffect(() => {
    setExtras(JSON.parse(entries))
    return () => setExtras([])
  }, [entries, setExtras])
  useEffect(() => { setReaders({ readSelection, readView }) }, [readSelection, readView, setReaders])
  // "@name" in Ask Slatebox: the same call as the chip's ask box, with the same readers.
  const askable = JSON.stringify(connections.map((c) => [c._id, c.agentId, c.name, c.colorIndex, c.mine, c.status, c.inviterName]))
  useEffect(() => {
    setAskable(askableEntries(connections, { readSelection, readView }))
    return () => setAskable([])
  }, [askable, readSelection, readView, setAskable])
  useEffect(() => { if (reconnect) setInviting(true) }, [reconnect])

  if (!shareId || !userId || !canEdit || guest) return null
  return (
    <Box data-agents-on-slate=""
      sx={{
        position: 'fixed', left: 16, bottom: 'calc(var(--sb-canvas-bottom, 0px) + 140px)', zIndex: 1200,
        // On a phone, Ask Slatebox's sheet has the foot of the screen: the button steps aside while it is open.
        display: { xs: chatOpen ? 'none' : 'block', md: 'block' },
      }}>
      <Button size="small" variant="outlined" data-invite-agent-open="" onClick={() => setInviting(true)} sx={{ bgcolor: 'background.paper' }}>+ Invite agent</Button>
      <InviteWalkthrough open={inviting} onClose={() => { setInviting(false); setReconnect(null) }} shareId={shareId} slateName={slate?.options?.name} reconnect={reconnect}
        onInvited={(connection) => connection?.agentId && openAgent(connection.agentId)} />
    </Box>
  )
}

AgentsOnSlate.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object.isRequired,
  canEdit: PropTypes.bool,
  readSelection: PropTypes.func,
  readView: PropTypes.func,
  chatOpen: PropTypes.bool,
}

/** agents.chip: an invited agent's own controls, inside its roster chip's popover. */
export function InvitedAgentControls({ agentId, shareId, canEdit = false, paused = false, waiting = 0 }) {
  const connections = useConnections(shareId)
  const c = connections.find((doc) => doc.agentId === agentId)
  const { readSelection, readView } = useAtomValue(readersAtom)
  const setReconnect = useSetAtom(reconnectAtom)
  const { open: openPay } = usePaySheet()
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const removeButton = useRef(null)
  if (!c) return null

  const ask = async (event) => {
    event.preventDefault()
    if (!request.trim() || paused) return
    setBusy(true)
    setNote('')
    try {
      const view = readView?.() || null
      const result = await Meteor.callAsync('connectors.call', { connectionId: c._id, request: request.trim(), selection: readSelection?.() || [], ...(view && { view }) })
      setRequest('')
      // The same words its turn says in Ask Slatebox ("@name"), so the two places agree.
      setNote(agentChatReply(c.name, result))
    } catch (e) {
      setNote(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  // Sign in again: only the inviter sees the agent's address (connectors.list), so ask for it.
  const signInAgain = async () => {
    setNote('')
    try {
      const { connections: mine } = await Meteor.callAsync('connectors.list', { shareId })
      const own = mine.find((m) => m.connectionId === c._id)
      if (!own?.address) return setNote('That agent is not on this slate any more.')
      setReconnect({ connectionId: c._id, address: own.address, name: c.name })
    } catch (e) {
      setNote(errorText(e))
    }
  }
  const renewPro = () => openPay({ action: 'pro', from: 'agents', reason: 'Invite outside agents onto your slates.', retry: () => Meteor.callAsync('connectors.list', { shareId }).catch(() => {}) })
  const remove = () => Meteor.callAsync('connectors.disconnect', { connectionId: c._id }).catch((e) => setNote(errorText(e)))

  return (
    <Box sx={{ mt: 1.5 }} data-agent-invited-controls={c.name}>
      {c.mine && c.status === 'active' && (
        <Box data-agent-ask={c.name}>
          <Typography variant="caption" color="text.secondary" component="div">{seesText(c.contextLevel)} You can also ask it in Ask Slatebox: @{c.name}.</Typography>
          <Box component="form" onSubmit={ask} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.5 }}>
            <TextField size="small" sx={{ flex: '1 1 180px' }} autoFocus value={request} onChange={(e) => setRequest(e.target.value)} placeholder={`Ask ${c.name}`}
              inputProps={{ maxLength: 1000, 'data-agent-request': '', 'aria-label': `Ask ${c.name}` }} disabled={busy || paused} />
            <Button type="submit" variant="contained" disabled={busy || paused || !request.trim()}>{busy ? 'Working…' : 'Ask'}</Button>
          </Box>
          {paused && (
            <Typography variant="caption" component="div" sx={{ mt: 0.5 }} data-agent-ask-paused="">
              Agents are paused on this slate. Resume agents to ask {c.name}.
            </Typography>
          )}
        </Box>
      )}
      {!c.mine && <Typography variant="body2" color="text.secondary">Only {c.inviterName || 'the person who invited it'} can ask {c.name}.</Typography>}
      {note && <Typography role="status" variant="body2" sx={{ mt: 1 }}>{note}</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {c.mine && c.status === 'needs_sign_in' && <Button size="small" variant="outlined" data-agent-sign-in-again="" onClick={signInAgain}>Sign in again</Button>}
        {c.mine && c.status === 'pro_ended' && <Button size="small" variant="outlined" data-agent-renew-pro="" onClick={renewPro}>Renew Pro</Button>}
        {c.removable && canEdit && !confirming && <Button size="small" ref={removeButton} data-agent-remove="" onClick={() => setConfirming(true)}>Remove</Button>}
      </Box>
      {confirming && (
        <Box sx={{ mt: 1 }} role="alertdialog" aria-label={`Remove ${c.name}?`} data-agent-remove-confirm="">
          <Typography variant="body2">
            Remove {c.name}?{waiting ? ` Its ${waiting} waiting suggestion${waiting === 1 ? '' : 's'} will be discarded.` : ''}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Button size="small" color="error" variant="contained" data-agent-remove-yes="" onClick={() => { setConfirming(false); remove() }}>Remove</Button>
            <Button size="small" data-agent-remove-cancel="" onClick={() => { setConfirming(false); setTimeout(() => removeButton.current?.focus(), 0) }}>Cancel</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}

InvitedAgentControls.propTypes = {
  agentId: PropTypes.string,
  shareId: PropTypes.string,
  canEdit: PropTypes.bool,
  paused: PropTypes.bool,
  waiting: PropTypes.number,
}
