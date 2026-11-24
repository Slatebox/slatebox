// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Invited agents on this slate. Each is one chip on the app's roster, like every agent: this file
// puts them there (rosterExtrasAtom) and fills the chip's popover (the agents.chip slot) with what
// only an invited agent has: a summary (what it adds, what it sees), Ask in chat, Sign in again,
// Renew Pro and Remove. People talk to an invited agent only in Ask Slatebox ("@its name"; owner,
// 2026-11-24): the chip has no ask box of its own. Keep all / Discard all, the activity with Undo
// and Edit directly are the roster's own, and each answer's ghosts (one framed group, Keep all /
// Discard all on it) are the app's live suggestions (AgentPresenceListener).
// The canvas.agents slot holds "+ Invite agent" and the walkthrough.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtom, useSetAtom } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { McpConnections } from './collections'
import InviteWalkthrough from './InviteWalkthrough'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import { agentColor, openAgentAtom, rosterExtrasAtom } from '/imports/ui/components/AgentPresenceListener.jsx'
import { askableAgentsAtom, conversationOpen, openChatWithAtom } from '/imports/ui/jotai/atoms'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { GALLERY } from '../common/gallery.mjs'

// What a chip says about an agent that can't be asked right now (everyone sees it; its ghosts stay
// keepable either way).
export const STATE_WORDS = { paused: 'paused: its tools changed', needs_sign_in: 'needs sign-in', pro_ended: 'Pro ended' }

// A refusal because the server's key ended (enterprise_locked) also empties the app's enterprise slots.
const errorText = (error) => {
  enterpriseSlots.lockIfRefused(error)
  return error?.reason || error?.message || 'That did not work. Try again.'
}

// A reconnect request, shared between the canvas.agents slot and each chip's popover.
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
  if (c.status === 'needs_sign_in') return `${c.name} needs you to sign in again. Open its chip under the canvas and choose Sign in again.`
  if (c.status === 'pro_ended') return `Asking ${c.name} is part of Slatebox Pro and Slatebox Business. Open its chip under the canvas to renew Pro.`
  if (c.status === 'paused') return `${c.name}'s tools changed. Open its chip under the canvas to look at them again.`
  return ''
}

/** The gallery card an invited agent came from (null for a pasted address). */
export const cardOf = (c) => (c?.galleryId ? GALLERY.find((card) => card.id === c.galleryId) || null : null)

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
      galleryId: c.galleryId || null,
      canAsk: Boolean(c.mine) && c.status === 'active',
      why: cannotAskText(c),
      // history: its last turns in Ask Slatebox, so a follow-up has context (sent as data).
      ask: (request, history = []) => {
        const view = readView?.() || null
        return Meteor.callAsync('connectors.call', { connectionId: c._id, request, selection: readSelection?.() || [], ...(view && { view }), ...(history.length && { history: history.slice(-3) }) })
          .catch((error) => {
            enterpriseSlots.lockIfRefused(error)
            throw error
          })
      },
    }))
}

/** What the chip says it may see. */
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
  const setAskable = useSetAtom(askableAgentsAtom)
  const openAgent = useSetAtom(openAgentAtom)
  const [reconnect, setReconnect] = useAtom(reconnectAtom)
  const [inviting, setInviting] = useState(false)
  const entries = JSON.stringify(rosterEntries(connections))
  useEffect(() => {
    setExtras(JSON.parse(entries))
    return () => setExtras([])
  }, [entries, setExtras])
  // "@name" in Ask Slatebox: the one place an invited agent is asked, with the canvas's readers.
  const askable = JSON.stringify(connections.map((c) => [c._id, c.agentId, c.name, c.colorIndex, c.mine, c.status, c.inviterName, c.galleryId]))
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
      {/* invited: the agents already on this slate, so the gallery marks them (✓ On this slate) and offers Manage. */}
      <InviteWalkthrough open={inviting} onClose={() => { setInviting(false); setReconnect(null) }} shareId={shareId} slateName={slate?.options?.name} reconnect={reconnect}
        invited={connections.map((c) => ({ connectionId: c._id, agentId: c.agentId, name: c.name, galleryId: c.galleryId || null, mine: Boolean(c.mine), status: c.status }))}
        onManage={(agentId) => { setInviting(false); if (agentId) openAgent(agentId) }}
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

/**
 * agents.chip: an invited agent's own part of its roster chip's popover: what it adds and sees, how to
 * ask it (Ask in chat opens Ask Slatebox replying to it), and Sign in again, Renew Pro, Remove.
 */
export function InvitedAgentControls({ agentId, shareId, canEdit = false, paused = false, waiting = 0 }) {
  const connections = useConnections(shareId)
  const c = connections.find((doc) => doc.agentId === agentId)
  const setReconnect = useSetAtom(reconnectAtom)
  const setChatWith = useSetAtom(openChatWithAtom)
  const setChatOpen = useSetAtom(conversationOpen)
  const { open: openPay } = usePaySheet()
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const removeButton = useRef(null)
  if (!c) return null
  const card = cardOf(c)

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
  const askInChat = () => {
    setChatOpen(true)
    setChatWith({ agentId: c.agentId, nonce: Date.now() })
  }

  return (
    <Box sx={{ mt: 1.5 }} data-agent-invited-controls={c.name}>
      <Box data-agent-summary={c.name}>
        {card?.lands && <Typography variant="body2">{card.lands}</Typography>}
        {c.mine && <Typography variant="caption" color="text.secondary" component="div">{seesText(c.contextLevel)}</Typography>}
        {c.mine && c.status === 'active' && (
          <>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              Ask it in Ask Slatebox: @{c.name}{card?.try ? `, for example “@${c.name} ${card.try}”` : ''}.
            </Typography>
            <Button size="small" variant="contained" sx={{ mt: 1 }} data-agent-ask-in-chat="" onClick={askInChat} disabled={paused}>Ask in chat</Button>
          </>
        )}
        {c.mine && paused && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5 }} data-agent-ask-paused="">
            Agents are paused on this slate. Resume agents to ask {c.name}.
          </Typography>
        )}
      </Box>
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
