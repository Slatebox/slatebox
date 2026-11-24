// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "Invite an agent": pick from the gallery or paste an address → (free account: the in-app Pro
// sheet, then straight on) → discovery → (a server that needs sign-in: a popup on its own page,
// a pasted client id, or a pasted key or token) → what it can do, in plain words → which lookups
// it may use → what it may see, and what leaves Slatebox → it arrives as a named cursor.
// With `reconnect` (an agent that needs sign-in again) it stops after the sign-in.
// `invited`: the agents already on this slate. A gallery card for one of yours says ✓ On this slate
// and offers Manage (its chip) instead of inviting it again; a pasted address of one says so too.
// `integrations`: the person's connected integrations, invited onto this slate in one step (no
// sign-in, no consent again); a server they already connected says so and offers the same.
// Without a shareId it is "Connect an integration" (the Integrations page): the same steps, ending
// in integrations.connect, with when it joins slates in place of what it may see on one.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link } from 'react-router-dom'
import MenuItem from '@mui/material/MenuItem'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import Hexagon from '/imports/ui/components/AgentMark.jsx'
import { enterpriseState } from '/imports/api/common/edition.mjs'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { GALLERY, cardFor } from '../common/gallery.mjs'
import { followSignIn, openSignInWindow } from './signin'

// The walkthrough's look, light and dark (the app's palette: greens on warm neutrals, sticky
// yellow only for the "Try" suggestion). Text on every surface here meets WCAG AA.
const MARK = '#3f7d58' // the hexagon before an agent has its own colour (chosen when it arrives)
const surface = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px',
  boxShadow: '0 1px 2px rgba(32,61,50,0.06), 0 6px 18px rgba(32,61,50,0.06)',
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 8px 22px rgba(0,0,0,0.28)' }),
})
const section = (theme) => ({ ...surface(theme), p: { xs: 1.75, sm: 2 } })
const heading = (theme) => ({
  display: 'block', textTransform: 'uppercase', fontSize: 11.5, fontWeight: 750, letterSpacing: '0.09em', lineHeight: 1.6, mb: 1, color: '#3b6a50',
  ...theme.applyStyles('dark', { color: '#bed7b5' }),
})
const success = (theme) => ({
  bgcolor: '#ebf3e4', border: '1px solid #c8dcbb', borderRadius: '14px', p: { xs: 1.5, sm: 1.75 }, display: 'grid', gap: 0.75,
  ...theme.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.10)', borderColor: 'rgba(190,215,181,0.28)' }),
})
const checkIcon = (theme) => ({ fontSize: 19, mt: '1px', flexShrink: 0, color: '#2f6b45', ...theme.applyStyles('dark', { color: '#bed7b5' }) })
const option = (theme, on, disabled) => ({
  m: 0, width: '100%', alignItems: 'flex-start', gap: 0.5, py: 1, pl: 0.75, pr: 1.5, borderRadius: '12px', border: '1px solid',
  transition: 'border-color 120ms, background-color 120ms, box-shadow 120ms',
  borderColor: on ? '#3f7d58' : '#dfe2d4', bgcolor: on ? '#eef5e7' : '#fffef8',
  boxShadow: on ? 'inset 0 0 0 1px #3f7d58' : 'none',
  ...(!disabled && { cursor: 'pointer', '&:hover': { borderColor: on ? '#3f7d58' : '#a9bfa6' } }),
  ...(disabled && { bgcolor: '#f4f3ec', borderStyle: 'dashed' }),
  '&:has(.Mui-focusVisible)': { outline: '2px solid #254b3b', outlineOffset: 2 },
  '& .MuiFormControlLabel-label': { pt: '9px', flex: 1, minWidth: 0 },
  ...theme.applyStyles('dark', {
    borderColor: on ? '#bed7b5' : '#3f574a', bgcolor: on ? 'rgba(190,215,181,0.12)' : '#1e3027',
    boxShadow: on ? 'inset 0 0 0 1px #bed7b5' : 'none',
    ...(!disabled && { '&:hover': { borderColor: on ? '#bed7b5' : '#6b8a76' } }),
    ...(disabled && { bgcolor: 'rgba(255,255,255,0.03)' }),
    '&:has(.Mui-focusVisible)': { outline: '2px solid #f2ce8b', outlineOffset: 2 },
  }),
})
const callout = (kind) => (theme) => ({
  display: 'flex', gap: 1, alignItems: 'flex-start', borderRadius: '12px', p: 1.25, pl: 1.5, fontSize: 14, lineHeight: 1.5,
  ...{
    info: { bgcolor: '#eef3ee', borderLeft: '4px solid #5b8a6e', color: '#2c4a3b' },
    warning: { bgcolor: '#fff4e0', border: '1px solid #f0d29c', color: '#6e4300' },
    error: { bgcolor: '#fdeceb', border: '1px solid #f3c4c0', color: '#9d1f17' },
  }[kind],
  ...theme.applyStyles('dark', {
    info: { bgcolor: 'rgba(190,215,181,0.07)', borderLeftColor: '#8fb39a', color: '#dfe9da' },
    warning: { bgcolor: 'rgba(255,183,77,0.12)', borderColor: 'rgba(255,183,77,0.35)', color: '#ffd59a' },
    error: { bgcolor: 'rgba(255,138,128,0.12)', borderColor: 'rgba(255,138,128,0.35)', color: '#ffb4ab' },
  }[kind]),
})
const calloutIcon = { fontSize: 19, mt: '1px', flexShrink: 0 }

/** A ✓ line of what Slatebox found, with a lock for "sign-in needed". */
function Found({ children, lock = false, ...rest }) {
  const Icon = lock ? LockOutlined : CheckCircleRounded
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }} {...rest}>
      <Icon aria-hidden="true" sx={checkIcon} />
      <Typography variant="body2" component="div" sx={{ lineHeight: 1.5 }}>{children}</Typography>
    </Box>
  )
}
Found.propTypes = { children: PropTypes.node, lock: PropTypes.bool }

function Callout({ kind = 'info', children, sx, ...rest }) {
  const Icon = { info: InfoOutlined, warning: WarningAmberRounded, error: ErrorOutlineRounded }[kind]
  return (
    <Box sx={[callout(kind), ...(Array.isArray(sx) ? sx : [sx])]} {...rest}>
      <Icon aria-hidden="true" sx={calloutIcon} />
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
Callout.propTypes = { kind: PropTypes.oneOf(['info', 'warning', 'error']), children: PropTypes.node, sx: PropTypes.oneOfType([PropTypes.shape({}), PropTypes.arrayOf(PropTypes.shape({}))]) }

function Lookalike() {
  return <Callout kind="warning">This address looks like it stands for another site. Check it before you go on.</Callout>
}
function Problem({ text }) {
  return <Callout kind="error" role="alert">{text}</Callout>
}
Problem.propTypes = { text: PropTypes.string.isRequired }

// What an integration's state says, where it can't be invited now.
const STATUS_WORDS = { paused: 'tools changed: review it on the Integrations page', needs_sign_in: 'needs sign-in', pro_ended: 'Pro ended' }

const RULE_CHOICES = [
  { value: 'ask', label: 'When I invite it to a slate' },
  { value: 'my_slates', label: 'On every slate I own, by itself' },
]

const SEES = [
  { value: 'request', label: 'Only what I ask' },
  { value: 'selection', label: 'What I ask, and the notes I select' },
  { value: 'slate', label: 'What I ask, and every note on this slate' },
]

// What the outside service asks of you, in plain words: Slatebox Pro is said once, on its own line.
// "Free" alone next to "Pro" read as a contradiction; the service's own price is not Slatebox's.
export const cardCost = (item) => (item.signIn ? item.cost : item.cost === 'Free' ? 'No sign-in needed' : `No sign-in needed · ${item.cost}`)

// A refusal because the server's key ended (enterprise_locked) also empties the app's enterprise slots.
const errorText = (error) => {
  enterpriseSlots.lockIfRefused(error)
  return error?.reason || error?.message || 'That did not work. Try again.'
}

/** The gallery card's state for this person: { here } when one of their agents on this slate came from it. */
export function cardState(item, invited = []) {
  // A paused copy (its tools changed) is invited again to look at them, so its card stays open.
  const here = invited.find((c) => c.galleryId === item.id && c.mine && c.status !== 'removed' && c.status !== 'paused') || null
  return { here }
}

export default function InviteWalkthrough({ open, onClose, shareId = null, slateName, onInvited, reconnect, invited = [], onManage = null, integrations = [], onConnected = null }) {
  const integrationMode = !shareId
  const [step, setStep] = useState('choose') // choose | discovering | signin | waiting | consent | inviting | reconnected
  const [rule, setRule] = useState('ask')
  // A server this person already connected (from discovery): offered to invite in one step.
  const [connected, setConnected] = useState(null)
  // The slate owner's choice of who may bring outside agents here (null until it answers).
  const [setting, setSetting] = useState(null)
  const [clientId, setClientId] = useState('')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const pending = useRef(null)
  const [address, setAddress] = useState('')
  const [found, setFound] = useState(null)
  const [name, setName] = useState('')
  const [allowed, setAllowed] = useState({})
  const [sees, setSees] = useState('request')
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState('')
  // A pasted address (or a card) for an agent of yours already here: { agentId, name, text }.
  const [already, setAlready] = useState(null)
  // The gallery as administrators set it (/admin/ai › Gallery), and whether this person may invite;
  // null until it answers (cards an administrator turned off are never shown), the built-in cards
  // only if it cannot be asked.
  const [gallery, setGallery] = useState({ cards: null, canInvite: null })
  const { open: openPay, prefetch } = usePaySheet()
  // On a phone the walkthrough is a full-height sheet; its footer stays in reach.
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  // Slatebox Pro is Slatebox Cloud's; a licensed self-hosted install has no Pro to mention. The
  // server says which it is (unlocked as Cloud by Cloud's key, or by an on-prem license).
  const cloud = enterpriseState(Meteor.settings).via === 'cloud'
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useEffect(() => {
    if (open && !reconnect) Meteor.callAsync('connectors.gallery', {}).then((answer) => {
      if (live.current) setGallery(Array.isArray(answer?.cards) ? { cards: answer.cards, canInvite: Boolean(answer.canInvite) } : { cards: GALLERY, canInvite: null })
    }).catch(() => { if (live.current) setGallery({ cards: GALLERY, canInvite: null }) })
    if (open && shareId && !reconnect) Meteor.callAsync('integrations.slateSetting', { shareId }).then((answer) => { if (live.current) setSetting(answer) }).catch(() => {})
    if (!open) {
      pending.current?.cancel()
      setStep('choose'); setFound(null); setError(''); setAddress(''); setShowAll(false); setKey(''); setClientId(''); setShowKey(false); setAlready(null); setConnected(null); setRule('ask')
    } else if (reconnect?.address) {
      setAddress(reconnect.address)
      discover(reconnect.address)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The server checks Pro on every call; a refusal opens the in-app sheet, and paying carries on from here.
  const payThen = (retry) => openPay({ action: 'pro', from: integrationMode ? 'integrations' : 'agents', reason: integrationMode ? 'Connect outside agents once and invite them onto any slate.' : 'Invite outside agents onto your slates.', retry })

  // One of this person's integrations onto this slate: no sign-in, no consent again.
  async function inviteIntegration(integration) {
    setError('')
    setStep('inviting')
    try {
      const connection = await Meteor.callAsync('integrations.invite', { shareId, integrationId: integration.integrationId })
      if (!live.current) return
      onInvited?.(connection)
      onClose()
    } catch (e) {
      if (!live.current) return
      setStep('choose')
      if (e?.error === 'pro_required') return payThen(() => inviteIntegration(integration))
      if (e?.error === 'already_here') return setAlready({ ...(e.details || {}), text: e.reason })
      setError(errorText(e))
    }
  }

  async function discover(raw) {
    const target = (raw ?? address).trim()
    if (!target) return
    setError('')
    setAlready(null)
    setStep('discovering')
    try {
      const result = integrationMode
        ? await Meteor.callAsync('integrations.discover', { address: target })
        : await Meteor.callAsync('connectors.discover', { shareId, address: target })
      if (!live.current) return
      // Already connected (on another slate, or from the Integrations page): invite it in one step.
      if (!integrationMode && result.integration && !result.alreadyHere && !reconnect && !result.signIn) {
        setStep('choose')
        setConnected(result.integration)
        return
      }
      // Already one of yours here: say so and offer its chip, never a second copy.
      if (result.alreadyHere && !result.alreadyHere.lookAgain && !reconnect) {
        setStep('choose')
        setAlready(result.alreadyHere)
        return
      }
      setFound(result)
      if (result.signIn) {
        setShowKey(result.signIn.method === 'key')
        setStep('signin')
        return
      }
      if (reconnect) {
        setStep('reconnected')
        return
      }
      setName(result.alreadyHere?.lookAgain ? result.alreadyHere.name : result.suggestedName)
      setAllowed(Object.fromEntries(result.tools.map((tool) => [tool.name, tool.policy === 'allow'])))
      setStep('consent')
    } catch (e) {
      if (!live.current) return
      setStep('choose')
      if (e?.error === 'pro_required') return payThen(() => discover(target))
      setError(errorText(e))
    }
  }

  // The popup is opened inside the click, before the server is asked, so the browser allows it.
  async function signIn() {
    setError('')
    const win = openSignInWindow()
    setStep('waiting')
    try {
      const started = await Meteor.callAsync('connectors.signIn', { ...(shareId && { shareId }), address: found.address, ...(clientId.trim() && { clientId: clientId.trim() }) })
      if (!live.current) return win?.close()
      const follow = followSignIn(win, started)
      pending.current = follow
      const outcome = await follow.promise
      pending.current = null
      if (!live.current) return
      try { if (!win?.closed) win.close() } catch {}
      if (outcome.ok) return discover(found.address)
      setStep('signin')
      setError(outcome.message || 'Sign-in didn\'t finish. Try again.')
    } catch (e) {
      try { win?.close() } catch {}
      if (!live.current) return
      setStep('signin')
      if (e?.error === 'pro_required') return payThen(() => signIn())
      setError(errorText(e))
    }
  }

  async function useKey(event) {
    event?.preventDefault()
    if (!key.trim()) return
    setError('')
    setStep('waiting')
    try {
      if (integrationMode) await Meteor.callAsync('integrations.useKey', { address: found.address, key: key.trim() })
      else await Meteor.callAsync('connectors.useKey', { shareId, address: found.address, key: key.trim() })
      setKey('')
      if (live.current) discover(found.address)
    } catch (e) {
      if (!live.current) return
      setStep('signin')
      if (e?.error === 'pro_required') return payThen(() => useKey())
      setError(errorText(e))
    }
  }

  async function invite() {
    setError('')
    setStep('inviting')
    try {
      const tools = found.tools.map(({ name: tool, hash }) => ({ name: tool, hash, policy: allowed[tool] ? 'allow' : 'off' }))
      if (integrationMode) {
        const integration = await Meteor.callAsync('integrations.connect', { address: found.address, name, tools, rule })
        if (!live.current) return
        onConnected?.(integration)
        onClose()
        return
      }
      const connection = await Meteor.callAsync('connectors.connect', { shareId, address: found.address, name, tools, contextLevel: sees })
      if (!live.current) return
      onInvited?.(connection)
      onClose()
    } catch (e) {
      if (!live.current) return
      setStep('consent')
      if (e?.error === 'pro_required') return payThen(() => invite())
      if (e?.error === 'tools_changed') {
        setError(errorText(e))
        return discover(found.address)
      }
      if (e?.error === 'already_here') {
        setStep('choose')
        setAlready({ ...(e.details || {}), text: e.reason })
        return
      }
      setError(errorText(e))
    }
  }

  const lookups = found?.tools.filter((tool) => tool.group === 'lookup') || []
  const changes = found?.tools.filter((tool) => tool.group === 'change') || []
  const chosen = lookups.filter((tool) => allowed[tool.name])
  const card = found?.card ? cardFor(found.address) : null
  const plan = found?.signIn
  const signInWith = plan?.provider || plan?.authHost || found?.host


  const agentName = step === 'consent' || step === 'inviting' ? name : reconnect?.name || found?.suggestedName
  const subtitle = found && step !== 'choose' && step !== 'discovering' ? [agentName, found.host].filter(Boolean).join(' · ') : ''
  const toolLabel = (tool) => tool.title || tool.name.replace(/[_-]+/g, ' ')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={phone} aria-labelledby="invite-agent-title" data-invite-agent=""
      PaperProps={{ sx: (t) => ({ bgcolor: '#f6f5ed', backgroundImage: 'none', ...(!phone && { borderRadius: '20px' }), ...t.applyStyles('dark', { bgcolor: '#17251f' }) }) }}>
      <Box sx={(t) => ({
        display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 2,
        background: 'linear-gradient(180deg, #fffef8 0%, #f6f5ed 100%)', borderBottom: '1px solid #e3e5d8',
        ...t.applyStyles('dark', { background: 'linear-gradient(180deg, #23362d 0%, #17251f 100%)', borderBottomColor: '#33493d' }),
      })}>
        <Box aria-hidden="true" sx={(t) => ({
          width: 44, height: 44, borderRadius: '13px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: '#e6efdf', boxShadow: 'inset 0 0 0 1px #cfdfc4', ...t.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.12)', boxShadow: 'inset 0 0 0 1px rgba(190,215,181,0.25)' }),
        })}>
          <Hexagon color={MARK} size={28} style={{}} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <DialogTitle id="invite-agent-title" sx={{ p: 0, fontSize: { xs: 17, sm: 19 }, fontWeight: 750, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
            {integrationMode ? 'Connect an integration' : `Invite an agent to “${slateName || 'this slate'}”`}
          </DialogTitle>
          {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }} data-invite-subtitle="">{subtitle}</Typography>}
        </Box>
      </Box>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 }, borderTop: 'none' }}>
        {step === 'choose' && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Typography variant="body2" sx={{ fontSize: 15, lineHeight: 1.55 }}>
              {integrationMode
                ? 'Connect an agent once. Then invite it onto any slate, or let it join every slate you own, with no new sign-in.'
                : 'Agents work on this slate with you. Everyone here sees each one as a cursor, and its suggestions as ghost notes to keep or discard.'}
            </Typography>
            {!integrationMode && integrations.length > 0 && (
              <Box sx={(t) => ({ ...section(t), display: 'grid', gap: 1 })} data-invite-integrations="">
                <Typography component="div" sx={heading}>Your integrations</Typography>
                {integrations.map((integration) => {
                  const here = invited.some((c) => c.mine && c.status !== 'removed' && c.integrationId === integration.integrationId)
                  const blocked = integration.status !== 'active'
                  return (
                    <Box key={integration.integrationId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-invite-integration={integration.name}>
                      <Hexagon color={MARK} size={18} style={{}} />
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                        <b>{integration.name}</b> · {integration.host}{blocked ? ` · ${STATUS_WORDS[integration.status] || integration.status}` : ''}
                      </Typography>
                      {here
                        ? <Typography variant="caption" color="text.secondary">✓ On this slate</Typography>
                        : <Button size="small" variant="outlined" disabled={blocked || step === 'inviting'} data-invite-integration-go="" onClick={() => inviteIntegration(integration)}>Invite to this slate</Button>}
                    </Box>
                  )
                })}
                <Typography variant="caption" color="text.secondary" component="div">No new sign-in. It sees only what you ask, unless you change that on its chip. <Link to="/integrations">Manage integrations</Link></Typography>
              </Box>
            )}
            {setting?.canChange && (
              <Box sx={(t) => ({ ...section(t), display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' })} data-invite-outside-agents="">
                <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>Who can bring outside agents onto this slate</Typography>
                <TextField select size="small" value={setting.outsideAgents} sx={{ minWidth: 180 }} inputProps={{ 'aria-label': 'Who can bring outside agents onto this slate', 'data-invite-outside-agents-select': '' }}
                  onChange={(e) => Meteor.callAsync('integrations.setSlateSetting', { shareId, outsideAgents: e.target.value }).then((answer) => live.current && setSetting(answer)).catch((err) => setError(errorText(err)))}>
                  <MenuItem value="editors">Anyone who can edit</MenuItem>
                  <MenuItem value="owner">Only me</MenuItem>
                  <MenuItem value="off">No one</MenuItem>
                </TextField>
              </Box>
            )}
            {connected && (
              <Box role="status" data-invite-connected={connected.name} sx={(t) => ({ ...section(t), display: 'flex', alignItems: 'center', gap: 1 })}>
                <Typography variant="body2" sx={{ flex: 1 }}>✓ You already connected {connected.name}. Invite it here with no new sign-in.</Typography>
                <Button size="small" variant="contained" data-invite-connected-go="" disabled={connected.status !== 'active'} onClick={() => inviteIntegration(connected)}>Invite to this slate</Button>
              </Box>
            )}
            <Box component="form" onSubmit={(e) => { e.preventDefault(); discover() }} sx={(t) => ({ ...section(t), display: 'flex', gap: 1, alignItems: 'center' })}>
              <TextField size="small" fullWidth label="Paste an MCP address" placeholder="https://example.com/mcp" value={address}
                onChange={(e) => setAddress(e.target.value)} inputProps={{ 'data-invite-address': '' }} />
              <Button type="submit" variant="contained" onPointerEnter={prefetch} disabled={!address.trim()} sx={{ px: 2.5, flexShrink: 0 }}>Next</Button>
            </Box>
            {error && <Problem text={error} />}
            {already && (
              <Box role="status" data-invite-already={already.name} sx={(t) => ({ ...section(t), display: 'flex', alignItems: 'center', gap: 1 })}>
                <Typography variant="body2" sx={{ flex: 1 }}>✓ {already.text || `${already.name} is already on this slate.`}</Typography>
                {onManage && <Button size="small" variant="outlined" data-invite-manage="" onClick={() => onManage(already.agentId)}>Manage</Button>}
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(200px, 1fr))' }, gap: 1.5 }}>
              {!gallery.cards && <Box data-gallery-loading="" sx={{ gridColumn: '1 / -1' }}><LinearProgress aria-label="Loading the gallery" /></Box>}
              {(gallery.cards || []).map((item) => {
                const { here } = cardState(item, invited)
                return (
                  <Box key={item.id} component="button" type="button" data-gallery-card={item.id} data-gallery-here={here ? '' : undefined}
                    aria-label={here ? `${item.name}: on this slate. Manage it.` : undefined}
                    onClick={() => (here ? onManage?.(here.agentId) : (setAddress(item.url), discover(item.url)))} onPointerEnter={here ? undefined : prefetch}
                    sx={(t) => ({
                      ...surface(t), textAlign: 'left', p: 1.75, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 0.75,
                      transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
                      ...(item.featured && { bgcolor: '#f3f8ee', borderColor: '#b9d2b0' }),
                      ...(here && { borderColor: '#2e7d32' }),
                      '&:hover': { borderColor: '#7fa78a', boxShadow: '0 2px 4px rgba(32,61,50,0.08), 0 10px 24px rgba(32,61,50,0.10)', transform: 'translateY(-1px)' },
                      '&:focus-visible': { outline: '2px solid #254b3b', outlineOffset: 2 },
                      '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                      ...t.applyStyles('dark', {
                        ...(item.featured && { bgcolor: '#26402f', borderColor: '#4f6e59' }),
                        ...(here && { borderColor: '#81c784' }),
                        '&:hover': { borderColor: '#8fb39a', boxShadow: '0 10px 26px rgba(0,0,0,0.35)', transform: 'translateY(-1px)' },
                        '&:focus-visible': { outline: '2px solid #f2ce8b', outlineOffset: 2 },
                      }),
                    })}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box aria-hidden="true" sx={(t) => ({ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: '#e6efdf', ...t.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.12)' }) })}>
                        <Hexagon color={item.featured ? MARK : '#6f8d78'} size={20} style={{}} />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 750, lineHeight: 1.3 }}>{item.name}</Typography>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>{item.job} · {cardCost(item)}</Typography>
                      </Box>
                    </Box>
                    {here && <Typography variant="caption" component="div" data-gallery-on-slate="" sx={(t) => ({ color: '#1b5e20', fontWeight: 650, ...t.applyStyles('dark', { color: '#a5d6a7' }) })}>✓ On this slate · Manage</Typography>}
                    <Typography variant="body2" sx={{ lineHeight: 1.45 }}>{item.lands}</Typography>
                    {cloud && gallery.canInvite === false && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 'auto', pt: 0.25 }}>Needs Slatebox Pro or Business</Typography>}
                  </Box>
                )
              })}
            </Box>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, lineHeight: 1.5 }} data-invite-footer="">Any MCP server works: open ones straight away, others after you sign in on their own page or paste a key. Each agent&apos;s answers become suggestions on your slate.{cloud && gallery.canInvite === false ? ' Inviting agents is part of Slatebox Pro and Slatebox Business.' : ''}</Typography>
          </Box>
        )}
        {step === 'discovering' && (
          <Box aria-live="polite" sx={(t) => ({ ...section(t), py: 3, px: 3, textAlign: 'center' })}>
            <Hexagon color={MARK} size={34} style={{}} />
            <Typography variant="body1" sx={{ mt: 1, fontWeight: 650, overflowWrap: 'anywhere' }}>Connecting to {address}…</Typography>
            <LinearProgress sx={{ mt: 2, height: 6, borderRadius: 3 }} />
          </Box>
        )}
        {(step === 'signin' || step === 'waiting') && found && plan && (
          <Box data-invite-signin={plan.method} sx={{ display: 'grid', gap: 1.5 }}>
            <Box sx={success}>
              <Found>Reached <b>{found.host}</b></Found>
              <Found lock>
                {plan.again ? `${reconnect?.name || 'This agent'} needs you to sign in to ${found.host} again.` : 'Sign-in needed'}
                {plan.method === 'oauth' && plan.authHost ? ` · opens ${plan.authHost}` : ''}
              </Found>
            </Box>
            {found.lookalike && <Lookalike />}
            {step === 'waiting' && (
              <Box aria-live="polite" sx={section}>
                <Typography variant="body2">Finish signing in in the window that opened. Slatebox carries on here by itself.</Typography>
                <LinearProgress sx={{ mt: 1.5, height: 6, borderRadius: 3 }} />
              </Box>
            )}
            {step === 'signin' && (plan.method === 'oauth' || plan.keyAllowed) && (
              <Box sx={(t) => ({ ...section(t), display: 'grid', gap: 1.5 })}>
                {plan.method === 'oauth' && (
                  <Box>
                    {plan.needsClientId && (
                      <TextField size="small" fullWidth label={`Client id from ${found.host}`} value={clientId} onChange={(e) => setClientId(e.target.value)} sx={{ mb: 1.5 }}
                        helperText="This server needs a registered app. Paste the client id it gave you." inputProps={{ maxLength: 500, 'data-invite-client-id': '' }} />
                    )}
                    <Button variant="contained" data-invite-sign-in="" disabled={plan.needsClientId && !clientId.trim()} onClick={signIn} sx={{ px: 2.5, width: { xs: '100%', sm: 'auto' } }}>Sign in to {signInWith} →</Button>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.25, mb: 0, lineHeight: 1.5 }} data-invite-sign-in-reach="">
                      A window opens on {plan.authHost || found.host}'s own page. Slatebox never sees your password.
                      {plan.sendsTo && plan.sendsTo !== plan.authHost ? ` Your ${signInWith} sign-in will be sent to ${plan.sendsTo}, and only there.` : ''}
                      {plan.reach ? ` ${plan.reach}` : ''}
                      {' '}What it gives Slatebox is kept encrypted for you alone, never shown to anyone on the slate, and removed when you remove the agent.
                    </Typography>
                  </Box>
                )}
                {plan.keyAllowed && (
                  <Box sx={(t) => (plan.method === 'oauth' ? { borderTop: '1px solid #e7e8dd', pt: 1.25, ...t.applyStyles('dark', { borderTopColor: '#3a5244' }) } : {})}>
                    {plan.method === 'oauth' && !showKey && (
                      <Button size="small" onClick={() => setShowKey(true)}>{card?.keyHint || 'Or paste a key or token'}</Button>
                    )}
                    {showKey && (
                      <Box component="form" onSubmit={useKey} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <TextField size="small" fullWidth type="password" autoComplete="off" label={`Key or token for ${found.host}`} value={key} onChange={(e) => setKey(e.target.value)}
                          helperText="Stored encrypted, never shown to anyone on the slate." inputProps={{ maxLength: 4096, 'data-invite-key': '' }} />
                        <Button type="submit" variant={plan.method === 'key' ? 'contained' : 'outlined'} disabled={!key.trim()} data-invite-use-key="" sx={{ flexShrink: 0, px: 2 }}>Use key</Button>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}
            {error && <Problem text={error} />}
          </Box>
        )}
        {step === 'reconnected' && found && (
          <Box sx={success} data-invite-reconnected="">
            <Found>Signed in to {found.host}. {reconnect?.name || 'Your agent'} is ready: ask it again.</Found>
          </Box>
        )}
        {(step === 'consent' || step === 'inviting') && found && (
          <Box data-invite-consent="" sx={{ display: 'grid', gap: 1.5 }}>
            {found.alreadyHere?.lookAgain && <Box sx={section} data-invite-look-again=""><Typography variant="body2">{found.alreadyHere.text}</Typography></Box>}
            <Box sx={success}>
              <Found>Reached <b>{found.host}</b>{found.serverName ? ` · it calls itself “${found.serverName}” (self-reported)` : ''}</Found>
              <Found>{found.signedIn ? `Signed in${found.signedIn.kind === 'key' ? ' with your key' : ''}: it acts as you on ${found.host}, and only you can ask it` : 'No sign-in: anyone with this address can use this server'}</Found>
              <Found>Found {lookups.length} {lookups.length === 1 ? 'way' : 'ways'} to look things up{changes.length ? ` and ${changes.length} that change things elsewhere` : ''}</Found>
            </Box>
            {found.lookalike && <Lookalike />}
            <Box sx={section}>
              <TextField size="small" fullWidth label="Name on your slate" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 32, 'data-invite-name': '' }}
                helperText={`Shown as “${name || '…'} · added by you”. Names can't say Slatebox, admin, support or a person's name.`} />
            </Box>
            <Box sx={section}>
              <Typography component="div" sx={heading}>Look things up</Typography>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {lookups.map((tool) => (
                  <FormControlLabel key={tool.name} sx={(t) => option(t, Boolean(allowed[tool.name]))}
                    control={<Checkbox checked={Boolean(allowed[tool.name])} onChange={(e) => setAllowed({ ...allowed, [tool.name]: e.target.checked })} />}
                    label={(
                      <>
                        <Typography component="span" sx={{ display: 'block', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>{toolLabel(tool)}</Typography>
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>→ {found.summary.lookups.find((l) => l.name === tool.name)?.lands || 'adds notes'}</Typography>
                      </>
                    )} />
                ))}
              </Box>
              {changes.length > 0 && (
                <>
                  <Typography component="div" sx={(t) => ({ ...heading(t), mt: 2 })}>Change things outside Slatebox</Typography>
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {changes.map((tool) => (
                      <FormControlLabel key={tool.name} disabled control={<Checkbox checked={false} />} sx={(t) => option(t, false, true)}
                        label={(
                          <>
                            <Typography component="span" sx={{ display: 'block', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>{toolLabel(tool)}</Typography>
                            <Typography component="span" variant="body2" sx={{ display: 'block', lineHeight: 1.4 }}>Off. Changes outside Slatebox are not available yet.</Typography>
                          </>
                        )} />
                    ))}
                  </Box>
                </>
              )}
              <Button size="small" onClick={() => setShowAll(!showAll)} sx={{ mt: 1.25, ml: -0.75 }}>{showAll ? 'Hide' : 'Show'} all tools as the server describes them</Button>
              {showAll && (
                <Box component="ul" sx={(t) => ({ m: 0, mt: 0.75, py: 1, pr: 1.5, pl: 3, maxHeight: 180, overflow: 'auto', fontSize: 13, lineHeight: 1.5, borderRadius: '10px', bgcolor: '#f4f3ec', border: '1px solid #e3e4d9', '& li + li': { mt: 0.5 }, ...t.applyStyles('dark', { bgcolor: '#1b2b23', borderColor: '#33493d' }) })}>
                  {found.tools.map((tool) => <li key={tool.name}><b>{tool.name}</b>: {tool.description || '(no description)'}</li>)}
                </Box>
              )}
            </Box>
            <Box sx={section}>
              <Typography component="div" sx={heading}>On this slate it may</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}><b>Suggest:</b> its work arrives as ghost notes anyone who can edit may keep or discard.</Typography>
            </Box>
            {integrationMode && (
              <Box sx={section} data-invite-rule="">
                <Typography component="div" sx={heading} id="invite-rule-label">It joins slates</Typography>
                <RadioGroup value={rule} onChange={(e) => setRule(e.target.value)} aria-labelledby="invite-rule-label" sx={{ display: 'grid', gap: 1 }}>
                  {RULE_CHOICES.map((choice) => (
                    <FormControlLabel key={choice.value} value={choice.value} control={<Radio size="small" />} sx={(t) => ({ ...option(t, rule === choice.value), '& .MuiFormControlLabel-label': { pt: '7px', flex: 1, fontSize: 14.5, fontWeight: rule === choice.value ? 700 : 500 } })}
                      label={choice.label} />
                  ))}
                </RadioGroup>
                <Callout kind="info" sx={{ mt: 1.5 }}>
                  <Box component="span" sx={{ display: 'block' }}>On each slate it sees only what you ask, unless you change that there. Removing it from one slate keeps it away from that slate.</Box>
                </Callout>
              </Box>
            )}
            {!integrationMode && <Box sx={section}>
              <Typography component="div" sx={heading} id="invite-sees-label">It may see</Typography>
              <RadioGroup value={sees} onChange={(e) => setSees(e.target.value)} aria-labelledby="invite-sees-label" sx={{ display: 'grid', gap: 1 }}>
                {SEES.map((option_) => (
                  <FormControlLabel key={option_.value} value={option_.value} control={<Radio size="small" />} sx={(t) => ({ ...option(t, sees === option_.value), '& .MuiFormControlLabel-label': { pt: '7px', flex: 1, fontSize: 14.5, fontWeight: sees === option_.value ? 700 : 500 } })}
                    label={option_.label} />
                ))}
              </RadioGroup>
              <Callout kind="info" sx={{ mt: 1.5 }}>
                <Box component="span" sx={{ display: 'block' }}><b>What leaves Slatebox:</b> {sees === 'request' ? 'only what you type when you ask it.' : sees === 'selection' ? 'what you type, and the text of the notes you select.' : 'what you type, and the text of every note on this slate, including notes by others.'}</Box>
                <Box component="span" sx={{ display: 'block', mt: 0.5 }}>Never: other slates, people's names or emails, comments, links or share settings.</Box>
              </Callout>
            </Box>}
            <Box sx={section}>
              <Typography component="div" sx={heading}>Who can ask it</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}>Only you. Everyone on {integrationMode ? 'a slate it is on' : 'the slate'} sees its cursor and suggestions.</Typography>
            </Box>
            {card?.try && (
              <Box sx={(t) => ({
                justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: 999, fontSize: 14, lineHeight: 1.4,
                bgcolor: '#fff4b8', border: '1px solid #e9d671', color: '#4a3d00', boxShadow: '0 1px 2px rgba(110,90,0,0.10)',
                ...t.applyStyles('dark', { bgcolor: 'rgba(242,206,139,0.14)', borderColor: 'rgba(242,206,139,0.40)', color: '#ffe0a4' }),
              })}>
                <LightbulbOutlined aria-hidden="true" sx={{ fontSize: 18 }} />
                <span>Try: “{card.try}”</span>
              </Box>
            )}
            {error && <Problem text={error} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={(t) => ({
        px: { xs: 2, sm: 3 }, py: 1.5, pb: { xs: 'max(12px, env(safe-area-inset-bottom))', sm: 1.5 }, gap: 1,
        bgcolor: '#fffef8', borderTop: '1px solid #e3e5d8', boxShadow: '0 -6px 16px rgba(32,61,50,0.06)',
        '& > :not(style) ~ :not(style)': { ml: 0 },
        ...t.applyStyles('dark', { bgcolor: '#1e3027', borderTopColor: '#33493d', boxShadow: '0 -8px 20px rgba(0,0,0,0.3)' }),
      })}>
        {step === 'consent' || step === 'inviting' ? (
          <>
            <Button onClick={() => { setStep('choose'); setError('') }}>Back</Button>
            <Button variant="contained" data-invite-go="" disabled={step === 'inviting' || !name.trim() || !chosen.length} onClick={invite} sx={{ px: 3, py: 1, flex: { xs: 1, sm: 'none' } }}>
              {step === 'inviting' ? (integrationMode ? 'Connecting…' : 'Inviting…') : `${integrationMode ? 'Connect' : 'Invite'} ${name || 'agent'} ⬡`}
            </Button>
          </>
        ) : step === 'signin' || step === 'waiting' ? (
          <>
            {!reconnect && <Button onClick={() => { pending.current?.cancel(); setStep('choose'); setError('') }}>Back</Button>}
            <Button onClick={() => { pending.current?.cancel(); onClose() }}>{step === 'waiting' ? 'Cancel' : 'Close'}</Button>
          </>
        ) : (
          <Button onClick={onClose}>{step === 'reconnected' ? 'Done' : 'Close'}</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

InviteWalkthrough.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  shareId: PropTypes.string,
  slateName: PropTypes.string,
  onInvited: PropTypes.func,
  reconnect: PropTypes.shape({ connectionId: PropTypes.string, address: PropTypes.string, name: PropTypes.string }),
  invited: PropTypes.arrayOf(PropTypes.shape({ agentId: PropTypes.string, name: PropTypes.string, galleryId: PropTypes.string, mine: PropTypes.bool, status: PropTypes.string })),
  onManage: PropTypes.func,
  integrations: PropTypes.arrayOf(PropTypes.shape({ integrationId: PropTypes.string, name: PropTypes.string, host: PropTypes.string, status: PropTypes.string })),
  onConnected: PropTypes.func,
}
