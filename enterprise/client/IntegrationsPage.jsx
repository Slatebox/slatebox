// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Integrations page (/integrations, the integrations.page slot): every outside agent and Google
// account a person connected once (owner, 2026-11-24). Each row says what it is, whether it works
// now, what it may use (lookups, and changes that wait on a card for approval), which slates it is
// on, when it joins slates (its standing rule) and whether it acts without asking, with Review
// tools, Sign in again and Disconnect (revoked, and removed from every slate). "Connect an
// agent" is the invite walkthrough without a slate. Free accounts on Slatebox Cloud see every row
// marked Pro, and connecting opens the in-app Pro sheet (prices live on /plans/, never here).
import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import Hexagon from '/imports/ui/components/AgentMark.jsx'
import { agentColor } from '/imports/ui/components/AgentPresenceListener.jsx'
import { enterpriseState } from '/imports/api/common/edition.mjs'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { PRICING_URL } from '/imports/api/common/contact.mjs'
import InviteWalkthrough from './InviteWalkthrough'
import GoogleIntegration from './GoogleIntegration'

export const INTEGRATION_STATUS = {
  active: 'Connected',
  paused: 'Tools changed: review them',
  needs_sign_in: 'Needs sign-in',
  pro_ended: 'Pro ended',
}
export const RULE_WORDS = { ask: 'When I invite it', my_slates: 'On every slate I own' }

const errorText = (error) => {
  enterpriseSlots.lockIfRefused(error)
  return error?.reason || error?.message || 'That did not work. Try again.'
}

const card = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 1.75, sm: 2 },
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})

/** Review an integration's tools as its server lists them now, and consent again (resumes every slate). */
function ReviewDialog({ integration, onClose, onDone }) {
  const [review, setReview] = useState(null)
  const [allowed, setAllowed] = useState({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let live = true
    Meteor.callAsync('integrations.review', { integrationId: integration.integrationId }).then((answer) => {
      if (!live) return
      setReview(answer)
      setAllowed(Object.fromEntries((answer.tools || []).map((tool) => [tool.name, tool.policy === 'allow'])))
    }).catch((e) => live && setError(errorText(e)))
    return () => { live = false }
  }, [integration.integrationId])
  const lookups = (review?.tools || []).filter((tool) => tool.group === 'lookup')
  const changes = (review?.tools || []).filter((tool) => tool.group === 'change')
  const toolRow = (tool) => (
    <FormControlLabel key={tool.name} data-review-tool={tool.name}
      control={<Checkbox checked={Boolean(allowed[tool.name])} onChange={(e) => setAllowed({ ...allowed, [tool.name]: e.target.checked })} />}
      label={<span><b>{tool.title || tool.name}</b>{tool.changed ? ' (changed)' : tool.added ? ' (new)' : ''}{tool.destructive ? ' · deletes, closes or merges: each one still waits for your approval' : ''}<br /><Typography component="span" variant="caption" color="text.secondary">{tool.description || '(no description)'}</Typography></span>} />
  )
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await Meteor.callAsync('integrations.connect', { address: review.address, name: integration.name, tools: review.tools.map(({ name, hash }) => ({ name, hash, policy: allowed[name] ? 'allow' : 'off' })) })
      onDone()
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="review-title" data-integration-review={integration.name}>
      <DialogTitle id="review-title">Review {integration.name}&apos;s tools</DialogTitle>
      <DialogContent>
        {!review && !error && <LinearProgress aria-label="Asking its server" />}
        {review?.needsSignIn && <Typography variant="body2">{integration.name} needs you to sign in again first.</Typography>}
        {review && !review.needsSignIn && (
          <Box sx={{ display: 'grid', gap: 0.5 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {review.changed?.length ? `Changed since you allowed them: ${review.changed.join(', ')}. Look at them again before it works anywhere.` : 'Nothing changed since you allowed these.'}
            </Typography>
            {lookups.length > 0 && <Typography variant="overline">Look things up</Typography>}
            {lookups.map(toolRow)}
            {changes.length > 0 && <Typography variant="overline" sx={{ mt: 1 }}>Change things outside Slatebox (each waits on a card you approve)</Typography>}
            {changes.map(toolRow)}
            <Typography variant="caption" color="text.secondary">Saving resumes {integration.name} on every slate it is on. A tool you turned off on one slate stays off there.</Typography>
          </Box>
        )}
        {error && <Typography role="alert" color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" data-review-save="" disabled={!review || review.needsSignIn || saving || !(review.tools || []).some((tool) => allowed[tool.name])} onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
ReviewDialog.propTypes = { integration: PropTypes.shape({ integrationId: PropTypes.string, name: PropTypes.string }).isRequired, onClose: PropTypes.func.isRequired, onDone: PropTypes.func.isRequired }

function IntegrationRow({ integration, pro, cloud, onChanged, onReview, onSignIn }) {
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const allowedTools = integration.tools.filter((tool) => tool.policy === 'allow')
  const setRule = (rule) => Meteor.callAsync('integrations.setRule', { integrationId: integration.integrationId, rule }).then(onChanged).catch((e) => setNote(errorText(e)))
  const writes = integration.tools.filter((tool) => tool.group === 'change' && tool.policy === 'allow')
  const setActing = (actWithoutAsking) => Meteor.callAsync('integrations.setActing', { integrationId: integration.integrationId, actWithoutAsking }).then(onChanged).catch((e) => setNote(errorText(e)))
  const disconnect = () => Meteor.callAsync('integrations.disconnect', { integrationId: integration.integrationId })
    .then((answer) => { setNote(''); onChanged(answer) }).catch((e) => setNote(errorText(e)))
  return (
    <Box sx={card} data-integration-row={integration.name} data-integration-status={integration.status}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <Hexagon color={agentColor(integration.colorIndex ?? 1)} size={26} style={{}} />
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 750, lineHeight: 1.3 }}>{integration.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {integration.kind === 'google' ? 'Google' : integration.galleryId ? 'Agent from the gallery' : 'Agent (MCP address)'} · {integration.host} · Personal
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
            <Chip size="small" label={INTEGRATION_STATUS[integration.status] || integration.status} color={integration.status === 'active' ? 'success' : 'warning'} variant="outlined" />
            {cloud && !pro && <Chip size="small" label="Pro" data-integration-pro="" />}
            {integration.signedIn && <Chip size="small" variant="outlined" label={integration.auth?.kind === 'key' ? 'Signed in with your key' : 'Signed in as you'} />}
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }}>
            May use: {allowedTools.length ? allowedTools.map((tool) => tool.title || tool.name).join(', ') : 'nothing yet'}
            {integration.scopes?.length ? ` · Google access: ${integration.scopes.join(', ')}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" data-integration-slates={integration.slateCount}>
            {integration.slateCount ? (
              <>On {integration.slateCount} {integration.slateCount === 1 ? 'slate' : 'slates'}: {integration.slates.map((slate, i) => (
                <React.Fragment key={slate.slateId}>{i ? ', ' : ''}<Link to={`/canvas/${slate.shareId}`}>{slate.name}</Link></React.Fragment>
              ))}</>
            ) : 'On no slate yet. Invite it from any slate\'s + Invite agent.'}
            {integration.lastUsedAt ? ` · Last asked ${new Date(integration.lastUsedAt).toLocaleDateString()}` : ''}
          </Typography>
        </Box>
        <TextField select size="small" label="Joins slates" value={integration.rule} onChange={(e) => setRule(e.target.value)} disabled={cloud && !pro} sx={{ minWidth: 210 }}
          inputProps={{ 'data-integration-rule': integration.name }}>
          {Object.entries(RULE_WORDS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
        </TextField>
      </Box>
      {integration.kind === 'mcp' && writes.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, flexWrap: 'wrap' }} data-integration-acting={integration.name}>
          <FormControlLabel sx={{ m: 0 }} control={<Switch size="small" checked={Boolean(integration.actWithoutAsking)} disabled={cloud && !pro} onChange={(e) => setActing(e.target.checked)} inputProps={{ 'data-integration-acting-switch': '' }} />}
            label={<Typography variant="body2">Act without asking</Typography>} />
          <Typography variant="caption" color="text.secondary">
            {integration.actWithoutAsking
              ? 'Its changes outside Slatebox are made at once on its slates (a slate can turn this off). Deleting, closing or merging still waits for you.'
              : 'Each change outside Slatebox waits on a card you approve on the slate.'}
          </Typography>
        </Box>
      )}
      {integration.rule === 'my_slates' && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75 }} data-integration-rule-note="">
          It shows on those slates to everyone who can open them. Slates anyone with the link can view get it only when you invite it.
        </Typography>
      )}
      {note && <Typography role="status" variant="body2" sx={{ mt: 1 }}>{note}</Typography>}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.25 }}>
        {integration.kind === 'mcp' && <Button size="small" variant={integration.status === 'paused' ? 'contained' : 'outlined'} data-integration-review-open="" onClick={() => onReview(integration)}>Review tools</Button>}
        {integration.status === 'needs_sign_in' && <Button size="small" variant="contained" data-integration-sign-in="" onClick={() => onSignIn(integration)}>Sign in again</Button>}
        {!confirming && <Button size="small" color="error" data-integration-disconnect="" onClick={() => setConfirming(true)}>Disconnect</Button>}
      </Box>
      {confirming && (
        <Box role="alertdialog" aria-label={`Disconnect ${integration.name}?`} sx={{ mt: 1 }} data-integration-disconnect-confirm="">
          <Typography variant="body2">
            Disconnect {integration.name}? It leaves {integration.slateCount ? `the ${integration.slateCount} ${integration.slateCount === 1 ? 'slate' : 'slates'} it is on` : 'Slatebox'}, its waiting suggestions are discarded, and its sign-in is revoked. Notes people kept stay.
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Button size="small" variant="contained" color="error" data-integration-disconnect-yes="" onClick={() => { setConfirming(false); disconnect() }}>Disconnect</Button>
            <Button size="small" onClick={() => setConfirming(false)}>Cancel</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}
IntegrationRow.propTypes = {
  integration: PropTypes.shape({ integrationId: PropTypes.string, name: PropTypes.string, kind: PropTypes.string, host: PropTypes.string, status: PropTypes.string, rule: PropTypes.string, tools: PropTypes.arrayOf(PropTypes.shape({})), slates: PropTypes.arrayOf(PropTypes.shape({})), slateCount: PropTypes.number, signedIn: PropTypes.bool, scopes: PropTypes.arrayOf(PropTypes.string), galleryId: PropTypes.string, colorIndex: PropTypes.number, lastUsedAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]), auth: PropTypes.shape({ kind: PropTypes.string }) }).isRequired,
  pro: PropTypes.bool,
  cloud: PropTypes.bool,
  onChanged: PropTypes.func.isRequired,
  onReview: PropTypes.func.isRequired,
  onSignIn: PropTypes.func.isRequired,
}

export default function IntegrationsPage() {
  const [state, setState] = useState({ integrations: null, pro: null })
  const [error, setError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [reconnect, setReconnect] = useState(null)
  const [reviewing, setReviewing] = useState(null)
  const { open: openPay } = usePaySheet()
  const cloud = enterpriseState(Meteor.settings).via === 'cloud'
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  const refresh = useCallback(() => Meteor.callAsync('integrations.list', {}).then((answer) => {
    if (live.current) setState({ integrations: answer.integrations || [], pro: Boolean(answer.pro) })
  }).catch((e) => live.current && setError(errorText(e))), [])
  useEffect(() => { refresh() }, [refresh])
  const pay = (retry) => openPay({ action: 'pro', from: 'integrations', reason: 'Connect outside agents and Google once, and invite them onto any slate.', retry })
  const connect = () => (cloud && state.pro === false ? pay(() => { refresh(); setConnecting(true) }) : setConnecting(true))
  const mcp = (state.integrations || []).filter((row) => row.kind !== 'google')

  return (
    <Box data-integrations-page="" sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 } }}>Integrations</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          Connect an agent or your Google account once. Then invite it onto any slate, or let it join every slate you own, with no new sign-in.
        </Typography>
      </Box>
      {cloud && state.pro === false && (
        <Box sx={card} data-integrations-pro-note="">
          <Typography variant="body2">Integrations are part of Slatebox Pro and Slatebox Business. <a href={PRICING_URL} target="_blank" rel="noopener noreferrer">See plans</a></Typography>
        </Box>
      )}
      {error && <Typography role="alert" color="error">{error}</Typography>}
      <GoogleIntegration integrations={state.integrations || []} pro={state.pro !== false || !cloud} onPay={pay} onChanged={refresh} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1, fontWeight: 700 }}>Agents</Typography>
        <Button variant="contained" data-integrations-connect="" onClick={connect}>Connect an agent</Button>
      </Box>
      {state.integrations === null && <LinearProgress aria-label="Loading your integrations" />}
      {state.integrations !== null && !mcp.length && (
        <Box sx={card}><Typography variant="body2" color="text.secondary">No agents connected yet. Connect one from the gallery or paste any MCP server&apos;s address.</Typography></Box>
      )}
      {mcp.map((integration) => (
        <IntegrationRow key={integration.integrationId} integration={integration} pro={Boolean(state.pro)} cloud={cloud} onChanged={refresh}
          onReview={(row) => (cloud && !state.pro ? pay(refresh) : setReviewing(row))} onSignIn={(row) => setReconnect({ address: row.address, name: row.name })} />
      ))}
      <InviteWalkthrough open={connecting || Boolean(reconnect)} reconnect={reconnect} onClose={() => { setConnecting(false); setReconnect(null); refresh() }} onConnected={refresh} />
      {reviewing && <ReviewDialog integration={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); refresh() }} />}
    </Box>
  )
}
