// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "Invite an agent": pick from the gallery or paste an address → (free account: the in-app Pro
// sheet, then straight on) → discovery → (a server that needs sign-in: a popup on its own page,
// a pasted client id, or a pasted key or token) → what it can do, in plain words → which lookups
// it may use → what it may see, and what leaves Slatebox → it arrives as a named cursor.
// With `reconnect` (an agent that needs sign-in again) it stops after the sign-in.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
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
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import { enterpriseState } from '/imports/api/common/edition.mjs'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { GALLERY, cardFor } from '../common/gallery.mjs'
import { followSignIn, openSignInWindow } from './signin'

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

export default function InviteWalkthrough({ open, onClose, shareId, slateName, onInvited, reconnect }) {
  const [step, setStep] = useState('choose') // choose | discovering | signin | waiting | consent | inviting | reconnected
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
  const { open: openPay, prefetch } = usePaySheet()
  // Slatebox Pro is Slatebox Cloud's; a licensed self-hosted install has no Pro to mention. The
  // server says which it is (unlocked as Cloud by Cloud's key, or by an on-prem license).
  const cloud = enterpriseState(Meteor.settings).via === 'cloud'
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useEffect(() => {
    if (!open) {
      pending.current?.cancel()
      setStep('choose'); setFound(null); setError(''); setAddress(''); setShowAll(false); setKey(''); setClientId(''); setShowKey(false)
    } else if (reconnect?.address) {
      setAddress(reconnect.address)
      discover(reconnect.address)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The server checks Pro on every call; a refusal opens the in-app sheet, and paying carries on from here.
  const payThen = (retry) => openPay({ action: 'pro', from: 'agents', reason: 'Invite outside agents onto your slates.', retry })

  async function discover(raw) {
    const target = (raw ?? address).trim()
    if (!target) return
    setError('')
    setStep('discovering')
    try {
      const result = await Meteor.callAsync('connectors.discover', { shareId, address: target })
      if (!live.current) return
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
      setName(result.suggestedName)
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
      const started = await Meteor.callAsync('connectors.signIn', { shareId, address: found.address, ...(clientId.trim() && { clientId: clientId.trim() }) })
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
      await Meteor.callAsync('connectors.useKey', { shareId, address: found.address, key: key.trim() })
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
      setError(errorText(e))
    }
  }

  const lookups = found?.tools.filter((tool) => tool.group === 'lookup') || []
  const changes = found?.tools.filter((tool) => tool.group === 'change') || []
  const chosen = lookups.filter((tool) => allowed[tool.name])
  const card = found?.card ? cardFor(found.address) : null
  const plan = found?.signIn
  const signInWith = plan?.provider || plan?.authHost || found?.host

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby="invite-agent-title" data-invite-agent="">
      <DialogTitle id="invite-agent-title">Invite an agent to “{slateName || 'this slate'}”</DialogTitle>
      <DialogContent dividers>
        {step === 'choose' && (
          <>
            <Typography variant="body2" sx={{ mb: 2 }}>Agents work on this slate with you. Everyone here sees each one as a cursor, and its suggestions as ghost notes to keep or discard.</Typography>
            <Box component="form" onSubmit={(e) => { e.preventDefault(); discover() }} sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField size="small" fullWidth label="Paste an MCP address" placeholder="https://example.com/mcp" value={address}
                onChange={(e) => setAddress(e.target.value)} inputProps={{ 'data-invite-address': '' }} />
              <Button type="submit" variant="contained" onPointerEnter={prefetch} disabled={!address.trim()}>Next</Button>
            </Box>
            {error && <Typography role="alert" color="error" variant="body2" sx={{ mb: 2 }}>{error}</Typography>}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 1.5 }}>
              {GALLERY.map((item) => (
                <Box key={item.id} component="button" type="button" data-gallery-card={item.id} onClick={() => { setAddress(item.url); discover(item.url) }} onPointerEnter={prefetch}
                  sx={{ textAlign: 'left', p: 1.5, border: '1px solid', borderColor: item.featured ? 'primary.main' : 'divider', borderRadius: 2, bgcolor: 'background.paper', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <Typography variant="subtitle2">⬡ {item.name}</Typography>
                  <Typography variant="caption" color="text.secondary" component="div">{item.job} · {cardCost(item)}</Typography>
                  {cloud && <Typography variant="caption" color="text.secondary" component="div">Needs Slatebox Pro or Business</Typography>}
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{item.lands}</Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>Any MCP server works: open ones straight away, others after you sign in on their own page or paste a key. Slatebox AI turns what it answers into notes on your slate.{cloud ? ' Inviting agents is part of Slatebox Pro and Slatebox Business.' : ''}</Typography>
          </>
        )}
        {step === 'discovering' && (
          <Box aria-live="polite" sx={{ py: 3 }}>
            <Typography variant="body1">Connecting to {address}…</Typography>
            <LinearProgress sx={{ mt: 2 }} />
          </Box>
        )}
        {(step === 'signin' || step === 'waiting') && found && plan && (
          <Box data-invite-signin={plan.method}>
            <Typography variant="body2">✓ Reached <b>{found.host}</b></Typography>
            {found.lookalike && <Typography color="warning.main" variant="body2">This address looks like it stands for another site. Check it before you go on.</Typography>}
            <Typography variant="body2" sx={{ mb: 2 }}>
              {plan.again ? `✓ ${reconnect?.name || 'This agent'} needs you to sign in to ${found.host} again.` : '✓ Sign-in needed'}
              {plan.method === 'oauth' && plan.authHost ? ` · opens ${plan.authHost}` : ''}
            </Typography>
            {step === 'waiting' && (
              <Box aria-live="polite" sx={{ mb: 2 }}>
                <Typography variant="body2">Finish signing in in the window that opened. Slatebox carries on here by itself.</Typography>
                <LinearProgress sx={{ mt: 1 }} />
              </Box>
            )}
            {step === 'signin' && plan.method === 'oauth' && (
              <Box sx={{ mb: 2 }}>
                {plan.needsClientId && (
                  <TextField size="small" fullWidth label={`Client id from ${found.host}`} value={clientId} onChange={(e) => setClientId(e.target.value)} sx={{ mb: 1 }}
                    helperText="This server needs a registered app. Paste the client id it gave you." inputProps={{ maxLength: 500, 'data-invite-client-id': '' }} />
                )}
                <Button variant="contained" data-invite-sign-in="" disabled={plan.needsClientId && !clientId.trim()} onClick={signIn}>Sign in to {signInWith} →</Button>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }} data-invite-sign-in-reach="">
                  A window opens on {plan.authHost || found.host}'s own page. Slatebox never sees your password.
                  {plan.sendsTo && plan.sendsTo !== plan.authHost ? ` Your ${signInWith} sign-in will be sent to ${plan.sendsTo}, and only there.` : ''}
                  {plan.reach ? ` ${plan.reach}` : ''}
                  {' '}What it gives Slatebox is kept encrypted for you alone, never shown to anyone on the slate, and removed when you remove the agent.
                </Typography>
              </Box>
            )}
            {step === 'signin' && plan.keyAllowed && (
              <Box>
                {plan.method === 'oauth' && !showKey && (
                  <Button size="small" onClick={() => setShowKey(true)}>{card?.keyHint || 'Or paste a key or token'}</Button>
                )}
                {showKey && (
                  <Box component="form" onSubmit={useKey} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField size="small" fullWidth type="password" autoComplete="off" label={`Key or token for ${found.host}`} value={key} onChange={(e) => setKey(e.target.value)}
                      helperText="Stored encrypted, never shown to anyone on the slate." inputProps={{ maxLength: 4096, 'data-invite-key': '' }} />
                    <Button type="submit" variant={plan.method === 'key' ? 'contained' : 'outlined'} disabled={!key.trim()} data-invite-use-key="">Use key</Button>
                  </Box>
                )}
              </Box>
            )}
            {error && <Typography role="alert" color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
          </Box>
        )}
        {step === 'reconnected' && found && (
          <Typography variant="body2" data-invite-reconnected="">✓ Signed in to {found.host}. {reconnect?.name || 'Your agent'} is ready: ask it again.</Typography>
        )}
        {(step === 'consent' || step === 'inviting') && found && (
          <Box data-invite-consent="">
            <Typography variant="body2">✓ Reached <b>{found.host}</b>{found.serverName ? ` · it calls itself “${found.serverName}” (self-reported)` : ''}</Typography>
            {found.lookalike && <Typography color="warning.main" variant="body2">This address looks like it stands for another site. Check it before you go on.</Typography>}
            <Typography variant="body2">{found.signedIn ? `✓ Signed in${found.signedIn.kind === 'key' ? ' with your key' : ''}: it acts as you on ${found.host}, and only you can ask it` : '✓ No sign-in: anyone with this address can use this server'}</Typography>
            <Typography variant="body2" sx={{ mb: 2 }}>✓ Found {lookups.length} {lookups.length === 1 ? 'way' : 'ways'} to look things up{changes.length ? ` and ${changes.length} that change things elsewhere` : ''}</Typography>
            <TextField size="small" label="Name on your slate" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 32, 'data-invite-name': '' }}
              helperText={`Shown as “${name || '…'} · added by you”. Names can't say Slatebox, admin, support or a person's name.`} sx={{ mb: 2 }} />
            <Typography variant="overline" component="div">Look things up</Typography>
            {lookups.map((tool) => (
              <FormControlLabel key={tool.name} control={<Checkbox checked={Boolean(allowed[tool.name])} onChange={(e) => setAllowed({ ...allowed, [tool.name]: e.target.checked })} />}
                label={`${tool.title || tool.name.replace(/[_-]+/g, ' ')} → ${found.summary.lookups.find((l) => l.name === tool.name)?.lands || 'adds notes'}`} sx={{ display: 'flex' }} />
            ))}
            {changes.length > 0 && (
              <>
                <Typography variant="overline" component="div" sx={{ mt: 1 }}>Change things outside Slatebox</Typography>
                {changes.map((tool) => (
                  <FormControlLabel key={tool.name} disabled control={<Checkbox checked={false} />} label={`${tool.title || tool.name.replace(/[_-]+/g, ' ')}: off. Changes outside Slatebox are not available yet.`} sx={{ display: 'flex' }} />
                ))}
              </>
            )}
            <Button size="small" onClick={() => setShowAll(!showAll)} sx={{ mt: 1 }}>{showAll ? 'Hide' : 'Show'} all tools as the server describes them</Button>
            {showAll && (
              <Box component="ul" sx={{ m: 0, pl: 2, maxHeight: 180, overflow: 'auto', fontSize: 13 }}>
                {found.tools.map((tool) => <li key={tool.name}><b>{tool.name}</b>: {tool.description || '(no description)'}</li>)}
              </Box>
            )}
            <Typography variant="overline" component="div" sx={{ mt: 2 }}>On this slate it may</Typography>
            <Typography variant="body2">Suggest: its work arrives as ghost notes anyone who can edit may keep or discard.</Typography>
            <Typography variant="overline" component="div" sx={{ mt: 2 }}>It may see</Typography>
            <RadioGroup value={sees} onChange={(e) => setSees(e.target.value)}>
              {SEES.map((option) => <FormControlLabel key={option.value} value={option.value} control={<Radio size="small" />} label={option.label} />)}
            </RadioGroup>
            <Typography variant="body2" color="text.secondary">What leaves Slatebox: {sees === 'request' ? 'only what you type when you ask it.' : sees === 'selection' ? 'what you type, and the text of the notes you select.' : 'what you type, and the text of every note on this slate, including notes by others.'} Never: other slates, people's names or emails, comments, links or share settings.</Typography>
            <Typography variant="overline" component="div" sx={{ mt: 2 }}>Who can ask it</Typography>
            <Typography variant="body2">Only you. Everyone on the slate sees its cursor and suggestions.</Typography>
            {card?.try && <Typography variant="body2" sx={{ mt: 2 }}>Try: “{card.try}”</Typography>}
            {error && <Typography role="alert" color="error" variant="body2" sx={{ mt: 2 }}>{error}</Typography>}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'consent' || step === 'inviting' ? (
          <>
            <Button onClick={() => { setStep('choose'); setError('') }}>Back</Button>
            <Button variant="contained" data-invite-go="" disabled={step === 'inviting' || !name.trim() || !chosen.length} onClick={invite}>
              {step === 'inviting' ? 'Inviting…' : `Invite ${name || 'agent'} ⬡`}
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
  shareId: PropTypes.string.isRequired,
  slateName: PropTypes.string,
  onInvited: PropTypes.func,
  reconnect: PropTypes.shape({ connectionId: PropTypes.string, address: PropTypes.string, name: PropTypes.string }),
}
