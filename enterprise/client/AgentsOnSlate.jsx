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
// Its changes outside Slatebox (agents read and write, owner 2026-11-24): each lands in its answer as
// an action card (a ghost note: Keep approves, Discard declines); the chip lists them too, with
// Approve and Decline, their links once done, and, for its inviter (or the slate's owner, to narrow
// it), whether it acts without asking here and who may approve.
// The canvas.agents slot holds "+ Invite agent" and the walkthrough.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { atom, useAtom, useSetAtom } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { McpConnections } from './collections'
import InviteWalkthrough from './InviteWalkthrough'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import { agentColor, openAgentAtom, rosterExtrasAtom } from '/imports/ui/components/AgentPresenceListener.jsx'
import { askableAgentsAtom, conversationOpen, openChatWithAtom } from '/imports/ui/jotai/atoms'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { GALLERY, NATIVE_CARDS } from '../common/gallery.mjs'
import { DriveFiles } from './GoogleIntegration'

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
    .map((c) => ({ agentId: c.agentId, label: c.name, colorIndex: c.colorIndex ?? 1, invitedBy: c.mine ? 'you' : c.inviterName, ...(c.joinedBy === 'rule' && { joinedBy: 'rule' }), state: STATE_WORDS[c.status] || null }))
}

/** Why an agent can't be asked from this screen now, in the words Ask Slatebox answers "@its name" with. */
export function cannotAskText(c) {
  if (!c.mine) return `Only ${c.inviterName || 'the person who invited it'} can ask ${c.name}.`
  if (c.status === 'needs_sign_in') return `${c.name} needs you to sign in again. Open its chip under the canvas and choose Sign in again.`
  if (c.status === 'pro_ended') return `Asking ${c.name} is part of Slatebox Pro and Slatebox Business. Open its chip under the canvas to renew Pro.`
  if (c.status === 'paused') return `${c.name}'s tools changed. Invite it again from + Invite agent to look at them.`
  return ''
}

/** The gallery card an invited agent came from (null for a pasted address). */
export const cardOf = (c) => (c?.galleryId ? [...GALLERY, ...NATIVE_CARDS].find((card) => card.id === c.galleryId) || null : null)

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
      // askId: the conversation turn's id. The same turn sent again (Meteor after a reconnect, or Try
      // again) is the same ask, answered once: the server keeps the first answer under that key.
      ask: async (request, history = [], { askId = null } = {}) => {
        const view = readView?.() || null
        const input = { connectionId: c._id, request, selection: readSelection?.() || [], ...(view && { view }), ...(history.length && { history: history.slice(-3) }) }
        const key = askId ? ('ask-' + c._id + '-' + askId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120) : undefined
        for (let waited = 0; ; waited++) {
          try {
            return await Meteor.callAsync('connectors.call', input, ...(key ? [{ idempotencyKey: key }] : []))
          } catch (error) {
            // The first send of this ask is still running (the page reconnected meanwhile): wait for its answer.
            if (error?.error === 'request_in_progress' && waited < 30) {
              await new Promise((resolve) => setTimeout(resolve, 2000))
              continue
            }
            enterpriseSlots.lockIfRefused(error)
            throw error
          }
        }
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
  // This person's integrations, for "Invite to this slate" (asked when the walkthrough opens).
  const [integrations, setIntegrations] = useState([])
  useEffect(() => {
    if (!inviting || !userId || guest) return
    Meteor.callAsync('integrations.list', {}).then((answer) => setIntegrations(Array.isArray(answer?.integrations) ? answer.integrations : [])).catch((e) => { enterpriseSlots.lockIfRefused(e) })
  }, [inviting, userId, guest])
  // Standing rules: the owner's own integrations that join every slate they own arrive when it opens
  // (idempotent on the server; one removed from this slate before stays away).
  const ownSlate = Boolean(userId && slate?.userId === userId)
  useEffect(() => {
    if (!shareId || !canEdit || !ownSlate || guest) return
    Meteor.callAsync('integrations.applyRules', { shareId }).catch((e) => { enterpriseSlots.lockIfRefused(e) })
  }, [shareId, canEdit, ownSlate, guest])
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
        invited={connections.map((c) => ({ connectionId: c._id, agentId: c.agentId, name: c.name, galleryId: c.galleryId || null, mine: Boolean(c.mine), status: c.status, integrationId: c.integrationId || null }))}
        integrations={integrations}
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
const CARD_WORDS = { waiting: 'Waiting', running: 'Sending', done: 'Done', failed: 'Failed', unclear: 'Not sure it was made', declined: 'Declined' }

/** An invited agent's changes outside Slatebox on this slate, and how they are approved. */
export function AgentChanges({ c, shareId, canEdit, waiting }) {
  const [state, setState] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const load = () => Meteor.callAsync('connectors.outsideActions', { shareId, connectionId: c._id })
    .then((answer) => live.current && setState(answer)).catch((e) => live.current && setNote(errorText(e)))
  // Read again whenever its waiting suggestions change (a card kept or discarded on the canvas).
  useEffect(() => { load() }, [c._id, waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn) => async () => {
    setBusy(true)
    setNote('')
    try {
      const answer = await fn()
      if (answer?.say) setNote(answer.say)
    } catch (e) {
      setNote(errorText(e))
    }
    await load()
    if (live.current) setBusy(false)
  }
  const agent = state?.agents?.find((a) => a.connectionId === c._id)
  const cards = (state?.cards || []).slice(0, 6)
  const owner = c.removable && !c.mine // the slate's owner, who may narrow how it acts here
  const mayApprove = c.mine || (agent?.approvers === 'editors' && canEdit)
  if (!state || (!cards.length && !c.mine && !owner)) return null
  return (
    <Box sx={{ mt: 1.25 }} data-agent-changes={c.name}>
      {cards.length > 0 && <Typography variant="overline" component="div">Changes outside Slatebox</Typography>}
      {cards.map((card) => (
        <Box key={card.cardId} sx={{ py: 0.5, borderTop: '1px solid', borderColor: 'divider' }} data-agent-change={card.state}>
          <Typography variant="body2"><b>{CARD_WORDS[card.state] || card.state}</b> · {card.label}{card.preview?.item ? ` ${card.preview.item}` : ''}{card.preview?.title ? `: ${card.preview.title}` : ''}</Typography>
          {card.preview?.target && <Typography variant="caption" color="text.secondary" component="div">{card.preview.target}</Typography>}
          {/* Everything approving it sends, in full, while it waits. */}
          {(card.state === 'waiting' || card.state === 'failed') && card.preview?.body && <Typography variant="caption" component="div" sx={{ whiteSpace: 'pre-wrap' }} data-agent-change-body="">{card.preview.body}</Typography>}
          {(card.state === 'waiting' || card.state === 'failed') && (card.preview?.more || []).map((line) => <Typography key={line} variant="caption" color="text.secondary" component="div" data-agent-change-more="">{line}</Typography>)}
          {card.destructive && card.state === 'waiting' && <Typography variant="caption" color="error" component="div">Deletes, closes or merges something; Slatebox cannot undo it.</Typography>}
          {(card.state === 'failed' || card.state === 'unclear') && <Typography variant="caption" component="div">{card.error}</Typography>}
          {card.state === 'unclear' && <Typography variant="caption" color="text.secondary" component="div">Look in {card.system} first: it may already be there.</Typography>}
          {card.link && <Typography variant="caption" component="div"><a href={card.link} target="_blank" rel="noopener noreferrer">{card.link}</a></Typography>}
          {card.actedWithoutAsking && <Typography variant="caption" color="text.secondary" component="div">Done without asking.</Typography>}
          {['waiting', 'failed', 'unclear'].includes(card.state) && canEdit && (
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
              {mayApprove && <Button size="small" variant={card.state === 'unclear' ? 'outlined' : 'contained'} disabled={busy} data-agent-change-approve="" onClick={run(() => Meteor.callAsync('connectors.approve', { cardId: card.cardId, ...(card.state === 'unclear' && { again: true }) }))}>{card.state === 'unclear' ? 'Try again anyway' : card.state === 'failed' ? 'Try again' : 'Approve'}</Button>}
              <Button size="small" disabled={busy} data-agent-change-decline="" onClick={run(() => Meteor.callAsync('connectors.decline', { cardId: card.cardId }))}>{card.state === 'unclear' ? 'Dismiss' : 'Decline'}</Button>
            </Box>
          )}
          {['waiting', 'failed', 'unclear'].includes(card.state) && !mayApprove && <Typography variant="caption" color="text.secondary" component="div">Only {c.inviterName || 'the person who invited it'} can approve it.</Typography>}
        </Box>
      ))}
      {(c.mine || owner) && agent && (
        <Box sx={{ display: 'grid', gap: 1, mt: 1 }} data-agent-acting-settings="">
          <TextField select size="small" label="Changes outside Slatebox" value={c.mine ? (agent.actWithoutAsking ? 'on' : 'off') : agent.actWithoutAsking ? 'on' : 'off'}
            inputProps={{ 'data-agent-acting': '' }}
            onChange={(e) => run(() => Meteor.callAsync('connectors.setActing', { connectionId: c._id, actWithoutAsking: e.target.value }))()}>
            <MenuItem value="off">Ask first: each waits on a card</MenuItem>
            <MenuItem value="on" disabled={!c.mine || agent.lockedByOwner}>Act without asking (not deleting, closing or merging)</MenuItem>
            {owner && agent.lockedByOwner && <MenuItem value="inherit">Let {c.inviterName || 'its inviter'} choose again</MenuItem>}
          </TextField>
          {agent.lockedByOwner && <Typography variant="caption" color="text.secondary" component="div" data-agent-acting-locked="">{owner ? `You turned acting without asking off here; ${c.inviterName || 'its inviter'} cannot turn it back on until you let them.` : 'This slate\'s owner turned acting without asking off here.'}</Typography>}
          <TextField select size="small" label="Who approves" value={agent.approvers} inputProps={{ 'data-agent-approvers': '' }}
            onChange={(e) => run(() => Meteor.callAsync('connectors.setActing', { connectionId: c._id, approvers: e.target.value }))()}>
            <MenuItem value="inviter">{c.mine ? 'Only me' : `Only ${c.inviterName || 'its inviter'}`}</MenuItem>
            <MenuItem value="editors">Anyone who can edit</MenuItem>
          </TextField>
        </Box>
      )}
      {(state.activity || []).slice(0, 3).map((row) => (
        <Typography key={row.at + row.text} variant="caption" color="text.secondary" component="div">{row.by}: {row.text}</Typography>
      ))}
      {note && <Typography role="status" variant="body2" sx={{ mt: 0.5 }}>{note}</Typography>}
    </Box>
  )
}
AgentChanges.propTypes = { c: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, mine: PropTypes.bool, removable: PropTypes.bool, inviterName: PropTypes.string }).isRequired, shareId: PropTypes.string, canEdit: PropTypes.bool, waiting: PropTypes.number }

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
        {/* Invited before it left the gallery: it still works; the chip says why it is not listed. */}
        {!card && c.retired && <Typography variant="body2" data-agent-retired="">No longer in the gallery: {c.retired}</Typography>}
        {c.mine && <Typography variant="caption" color="text.secondary" component="div">{seesText(c.contextLevel)}</Typography>}
        {c.mine && c.status === 'active' && (
          <>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
              Ask it in Ask Slatebox: @{c.name}{card?.try ? `, for example “@${c.name} ${card.try}”` : ''}.
            </Typography>
            <Button size="small" variant="contained" sx={{ mt: 1 }} data-agent-ask-in-chat="" onClick={askInChat} disabled={paused}>Ask in chat</Button>
          </>
        )}
        {c.mine && c.galleryId === 'googledrive' && <DriveFiles shareId={shareId} />}
        {c.mine && paused && (
          <Typography variant="caption" component="div" sx={{ mt: 0.5 }} data-agent-ask-paused="">
            Agents are paused on this slate. Resume agents to ask {c.name}.
          </Typography>
        )}
      </Box>
      <AgentChanges c={c} shareId={shareId} canEdit={canEdit} waiting={waiting} />
      {c.joinedBy === 'rule' && <Typography variant="caption" color="text.secondary" component="div" data-agent-joined-by-rule="">{c.mine ? 'Joined by your standing rule (Integrations).' : `Joined by ${c.inviterName || 'its owner'}'s rule.`}</Typography>}
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
