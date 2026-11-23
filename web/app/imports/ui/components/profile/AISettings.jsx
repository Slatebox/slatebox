import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { AccountActions, AccountPanel, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'

// The AI each feature uses: the person's own connections (a cloud key or any OpenAI-compatible
// endpoint), their team's, and the server's. Own connections are a self-hosted feature
// (own-keys.mjs): on Slatebox Cloud (settings.hosted) the tab shows which AI each feature uses and,
// to administrators, the server's connections; nothing of a person's or team's. Mixed freely; the server checks every address and
// never shows a key again. The same actions serve exec, MCP and the CLI (ai.get, ai.update, ai.check).
const TYPES = [
  { value: 'openai-compatible', label: 'OpenAI-compatible endpoint (any host, or a model on your computer or network)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepinfra', label: 'DeepInfra' },
]
const BLANK = { name: '', type: 'openai-compatible', baseUrl: '', model: '', apiKey: '', clearKey: false, tools: null, vision: null, images: false }
const LEVEL_SCOPE = { me: 'me', team: 'team', server: 'server' }

const reason = (err, fallback) => err?.reason || err?.message || fallback

function ConnectionDialog({ open, level, initial, onClose, onSaved, hosted }) {
  const [form, setForm] = useState(BLANK)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setForm(initial ? { ...BLANK, ...initial, apiKey: '', tools: initial.capabilities?.tools ?? null, vision: initial.capabilities?.vision ?? null, images: initial.capabilities?.images === true } : BLANK)
    setResult(null)
    setError('')
  }, [open])
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const connection = () => {
    const capabilities = {}
    if (form.tools !== null) capabilities.tools = form.tools
    if (form.vision !== null) capabilities.vision = form.vision
    if (form.images) capabilities.images = true
    return {
      name: form.name.trim(), type: form.type,
      ...(form.type === 'openai-compatible' && { baseUrl: form.baseUrl.trim() }),
      ...(form.model.trim() && { model: form.model.trim() }),
      // an empty key removes the saved one; leaving the field empty keeps it
      ...(form.clearKey ? { apiKey: '' } : form.apiKey ? { apiKey: form.apiKey } : {}),
      capabilities,
    }
  }
  const test = async () => {
    setBusy(true); setError(''); setResult(null)
    try {
      setResult(await Meteor.callAsync(CONSTANTS.methods.ai.check, { level, connection: connection() }))
    } catch (err) {
      setError(reason(err, 'The connection could not be tested.'))
    } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError('')
    try {
      await onSaved(connection())
    } catch (err) {
      setError(reason(err, 'The connection was not saved.'))
    } finally { setBusy(false) }
  }
  const tri = (key, label) => (
    <TextField select size="small" label={label} value={form[key] === null ? 'unknown' : String(form[key])} sx={{ minWidth: 170, mr: 1, mt: 1 }}
      onChange={(e) => setForm({ ...form, [key]: e.target.value === 'unknown' ? null : e.target.value === 'true' })}>
      <MenuItem value="unknown">Not sure (try it)</MenuItem>
      <MenuItem value="true">Yes</MenuItem>
      <MenuItem value="false">No</MenuItem>
    </TextField>
  )
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? `Change ${initial.name}` : 'Connect an AI model'}</DialogTitle>
      <DialogContent>
        <TextField fullWidth margin="dense" label="Name" helperText="Lowercase letters, digits and dashes, for example desk-model" value={form.name} disabled={Boolean(initial)} onChange={set('name')} />
        <TextField select fullWidth margin="dense" label="Type" value={form.type} onChange={set('type')}>
          {TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
        </TextField>
        {form.type === 'openai-compatible' && (
          <TextField fullWidth margin="dense" label="Address" placeholder={hosted ? 'https://llm.example.com/v1' : 'http://host.docker.internal:11434/v1'}
            helperText={hosted ? 'A public https address.' : 'The address up to /v1. In the Slatebox container, a model on this computer is at host.docker.internal, not localhost.'}
            value={form.baseUrl} onChange={set('baseUrl')} />
        )}
        <TextField fullWidth margin="dense" label="Model" helperText={form.type === 'deepinfra' ? 'Leave empty to follow each feature\'s default model.' : 'The model name the endpoint serves. Test connection lists them where it can.'}
          value={form.model} onChange={set('model')} />
        <TextField fullWidth margin="dense" type="password" autoComplete="off" label={initial?.hasKey ? 'Key (leave empty to keep the saved one)' : form.type === 'openai-compatible' ? 'Key (if your endpoint needs one)' : 'Key'}
          value={form.apiKey} disabled={form.clearKey} onChange={set('apiKey')} />
        {initial?.hasKey && (
          <FormControlLabel control={<Checkbox checked={form.clearKey} onChange={set('clearKey')} />} label="Remove the saved key" />
        )}
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2">What this model can do, where you know it:</Typography>
          {tri('tools', 'Calls tools')}
          {tri('vision', 'Reads images')}
          <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={form.images} onChange={set('images')} />} label="Makes images" />
        </Box>
        {result && (
          <Alert severity={result.ok ? (result.tools === 'yes' ? 'success' : 'info') : 'warning'} sx={{ mt: 2 }}>
            {result.message}
            {result.models?.length ? (
              <Box sx={{ mt: 1 }}>
                Models: {result.models.slice(0, 30).map((m) => (
                  <Button key={m} size="small" onClick={() => setForm({ ...form, model: m })}>{m}</Button>
                ))}
              </Box>
            ) : null}
          </Alert>
        )}
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={test}>Test connection</Button>
        <Button disabled={busy} variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

ConnectionDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  level: PropTypes.oneOf(['me', 'team', 'server']).isRequired,
  initial: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
  hosted: PropTypes.bool,
}

function choicesFor(settings, level) {
  const out = [{ value: '', label: level === 'server' ? 'Not set' : 'Not set (use the next level)' }, { value: 'builtin', label: 'The AI this server provides' }]
  const add = (scope, list, prefix) => (list || []).forEach((c) => out.push({ value: `${scope}:${c.name}`, label: `${prefix}${c.name}${c.model ? ` (${c.model})` : ''}` }))
  if (level === 'me') add('me', settings.mine?.connections, 'Mine: ')
  if (level !== 'server') add('team', settings.team?.connections, 'Team: ')
  add('server', settings.server?.connections, 'Server: ')
  return out
}

function Level({ settings, level, title, holder, editable, onChange, children }) {
  const [dialog, setDialog] = useState(null) // { initial } | null
  const [error, setError] = useState('')
  const [checks, setChecks] = useState({})
  const update = async (input) => {
    setError('')
    try {
      onChange(await Meteor.callAsync(CONSTANTS.methods.ai.update, { level, ...input }))
    } catch (err) {
      setError(reason(err, 'The change was not saved.'))
      throw err
    }
  }
  const check = async (name) => {
    setChecks((now) => ({ ...now, [name]: { message: 'Testing…' } }))
    try {
      const result = await Meteor.callAsync(CONSTANTS.methods.ai.check, { level, name })
      setChecks((now) => ({ ...now, [name]: result }))
    } catch (err) {
      setChecks((now) => ({ ...now, [name]: { ok: false, message: reason(err, 'The connection could not be tested.') } }))
    }
  }
  const choices = choicesFor(settings, level)
  const use = holder?.use || {}
  return (
    <AccountSection title={title}>
      {(holder?.connections || []).length === 0 && <FinePrint>No connections yet.</FinePrint>}
      {(holder?.connections || []).map((c) => (
        <Box key={c.name} sx={{ display: 'flex', alignItems: 'center', columnGap: SPACE.text, rowGap: SPACE.tight, flexWrap: 'wrap' }}>
          <Typography><strong>{c.name}</strong>{c.model ? `: ${c.model}` : ''}{c.host ? ` at ${c.host}` : ''}{c.hasKey ? ', key saved' : ''}{c.source === 'file' ? ' (settings file)' : ''}</Typography>
          {c.lastError && <Typography variant="body2" color="warning.main">{c.lastError}</Typography>}
          {(editable || level === 'me') && c.source !== 'file' && (
            <>
              <Button size="small" onClick={() => check(c.name)}>Test connection</Button>
              {!c.legacy && <Button size="small" onClick={() => setDialog({ initial: c })}>Change</Button>}
              <Button size="small" onClick={() => update({ remove: [c.name] }).catch(() => {})}>Remove</Button>
            </>
          )}
          {checks[c.name] && <Typography variant="body2" sx={{ width: '100%' }} color={checks[c.name].ok ? 'success.main' : 'text.secondary'}>{checks[c.name].message}</Typography>}
        </Box>
      ))}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: SPACE.group, pt: SPACE.tight }}>
        {['default', ...settings.features.map((f) => f.id)].map((key) => (
          <TextField key={key} select size="small" fullWidth disabled={!editable && level !== 'me'}
            label={key === 'default' ? 'Default for every feature' : settings.features.find((f) => f.id === key).title}
            value={use[key] || ''} onChange={(e) => update({ use: { [key]: e.target.value || null } }).catch(() => {})}>
            {choices.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        ))}
      </Box>
      {(editable || level === 'me') && (
        <AccountActions>
          <Button variant="outlined" onClick={() => setDialog({ initial: null })}>Connect a model</Button>
        </AccountActions>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
      {children}
      <ConnectionDialog open={Boolean(dialog)} level={level} initial={dialog?.initial || null} hosted={settings.hosted}
        onClose={() => setDialog(null)}
        onSaved={async (connection) => { await update({ connections: [connection] }); setDialog(null) }} />
    </AccountSection>
  )
}

Level.propTypes = {
  settings: PropTypes.object.isRequired,
  level: PropTypes.oneOf(Object.keys(LEVEL_SCOPE)).isRequired,
  title: PropTypes.string.isRequired,
  holder: PropTypes.object,
  editable: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  children: PropTypes.node,
}

Level.defaultProps = { children: null }

export default function AISettings() {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    Meteor.callAsync(CONSTANTS.methods.ai.get).then(setSettings).catch((err) => setError(reason(err, 'Your AI settings could not be read.')))
  }, [])
  if (error) return <Alert severity="warning">{error}</Alert>
  if (!settings) return null
  const switchOwn = async (on) => {
    try {
      setSettings(await Meteor.callAsync(CONSTANTS.methods.ai.update, { level: 'server', ownProviders: on ? 'on' : 'off' }))
    } catch (err) {
      setError(reason(err, 'The change was not saved.'))
    }
  }
  return (
    <AccountPanel>
      <AccountSection title="Which AI each feature uses">
        <Box sx={{ display: 'grid', rowGap: SPACE.hair }}>
          {settings.features.map((f) => (
            <Typography key={f.id}>
              {f.title}: {settings.effective[f.id].label}{settings.effective[f.id].own ? ' (yours, no charge from Slatebox)' : ''}
              {settings.effective[f.id].gap && <Typography component="span" color="warning.main"> {settings.effective[f.id].gap}</Typography>}
            </Typography>
          ))}
        </Box>
        <FinePrint>
          {settings.hosted
            ? 'On Slatebox Cloud, AI comes with Slatebox Pro credits and top-ups (Profile → Credits).'
            : 'Mix freely: connect a cloud provider with your key, or any OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM, LM Studio or a host), and choose it for one feature or all of them. Your own connections cost nothing on Slatebox.'}
        </FinePrint>
      </AccountSection>
      {!settings.hosted && (settings.mine
        ? <Level settings={settings} level="me" title="Yours" holder={settings.mine} editable onChange={setSettings} />
        : <Alert severity="info">This server uses the AI its operator set up. Own AI providers are turned off.</Alert>)}
      {!settings.hosted && settings.team && <Level settings={settings} level="team" title="Your team's" holder={settings.team} editable={settings.team.editable} onChange={setSettings} />}
      {settings.server.editable && (
        <Level settings={settings} level="server" title="This server's (administrators)" holder={settings.server} editable onChange={setSettings}>
          {!settings.hosted && (
            <FormControlLabel
              control={<Switch checked={settings.ownProviders} disabled={settings.server.ownProvidersLocked} onChange={(e) => switchOwn(e.target.checked)} />}
              label={settings.server.ownProvidersLocked ? 'People may use their own AI (turned off in the settings file)' : 'People may use their own AI'} />
          )}
        </Level>
      )}
    </AccountPanel>
  )
}
