import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { checkResultText, connectionFormDefaults, keyText, lastCheckText, parseHeaders, providerFormDefaults } from './catalog-view.mjs'

// Admin › AI control › Providers and keys: the providers Slatebox can talk to (the built-in ones and
// those an administrator added), and under each the server's connections with which key they use.
// Keys are write-only: the field is always empty and no action returns a key.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const PROTOCOLS = [
  { value: 'openai-chat', label: 'OpenAI-compatible chat (Gemini, Meta, Mistral, OpenRouter, Groq, Ollama, vLLM…)' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-images', label: 'OpenAI-compatible pictures' },
]
const CAPS = ['tools', 'vision', 'json', 'images', 'reasoning']
const GRACE = [{ value: 0, label: 'Stop the old key now' }, { value: 1, label: 'Keep the old key 1 hour' }, { value: 24, label: 'Keep the old key 24 hours' }]

// A saved connection as it is sent back unchanged (a save replaces the whole connection), so a
// rotation or turning it off keeps its address, model, capabilities and limits.
const keep = (c) => ({
  name: c.name, type: c.provider, ...(c.model && { model: c.model }),
  ...(!c.aux && c.baseUrl && { baseUrl: c.baseUrl }), ...(!c.aux && { capabilities: c.capabilities || {} }),
  ...(c.maxTokens && { maxTokens: c.maxTokens }), ...(c.toolChoice && { toolChoice: c.toolChoice }),
})

function Reason({ value, onChange, label = 'Why (kept in the change history)' }) {
  return <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} sx={{ mt: 2 }} />
}

function AddConnection({ open, onClose, onDone, providers, hosted }) {
  // the form starts filled (its first render reads every field), and again each time it opens
  const [form, setForm] = useState(() => connectionFormDefaults(open))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm(connectionFormDefaults(open))
      setError('')
    }
  }, [open])
  if (!open) return null
  const provider = providers.find((p) => p.id === form.provider) || {}
  const locked = Boolean(provider.baseUrl && provider.baseUrlLocked)
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async () => {
    setBusy(true)
    setError('')
    const connection = {
      name: form.name.trim(), type: form.provider,
      ...(!locked && form.baseUrl.trim() && { baseUrl: form.baseUrl.trim() }),
      ...(form.model.trim() && { model: form.model.trim() }),
      ...(!provider.aux && { capabilities: { tools: form.tools, vision: form.vision, images: form.images } }),
      ...(form.fromEnv ? { keyRef: { kind: 'env', name: form.envName.trim() } } : form.apiKey ? { apiKey: form.apiKey } : {}),
    }
    try {
      await Meteor.callAsync('ai.connections.save', { connections: [connection] })
      onDone(`Saved ${connection.name}.`)
    } catch (err) {
      setError(failure(err, 'The connection was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="add-connection-title">
      <DialogTitle id="add-connection-title">Add a connection</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Provider" value={form.provider} onChange={set('provider')}>
            {providers.filter((p) => p.status !== 'archived').map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
          </TextField>
          <TextField label="Name" value={form.name} onChange={set('name')} helperText="Lowercase letters, digits and dashes, for example gemini-main." />
          <TextField label="Address" value={locked ? provider.baseUrl : form.baseUrl} onChange={set('baseUrl')} disabled={locked}
            helperText={locked ? 'This provider has its own address.' : 'The address up to /v1.'} placeholder={provider.baseUrl || 'https://…/v1'} />
          <TextField label={provider.modelLabel || 'Model'} value={form.model} onChange={set('model')} />
          {!form.fromEnv && (
            <TextField label={provider.keyLabel || 'Key'} type="password" autoComplete="new-password" value={form.apiKey} onChange={set('apiKey')}
              helperText="Stored encrypted. Slatebox never shows it again." />
          )}
          {!hosted && !provider.aux && (
            <FormControlLabel control={<Checkbox checked={form.fromEnv} onChange={set('fromEnv')} />} label="Read the key from an environment variable" />
          )}
          {form.fromEnv && <TextField label="Environment variable" value={form.envName} onChange={set('envName')} helperText="A name starting SLATEBOX_AI_KEY_, read for each request." />}
          {!provider.aux && (
            <Box>
              <Typography variant="body2" color="text.secondary">What the model can do</Typography>
              {['tools', 'vision', 'images'].map((cap) => <FormControlLabel key={cap} control={<Checkbox checked={form[cap]} onChange={set(cap)} />} label={{ tools: 'Calls tools', vision: 'Reads pictures', images: 'Makes pictures' }[cap]} />)}
            </Box>
          )}
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.name.trim()} onClick={save}>Save connection</Button>
      </DialogActions>
    </Dialog>
  )
}

function RotateKey({ connection, onClose, onDone }) {
  const [apiKey, setApiKey] = useState('')
  const [grace, setGrace] = useState(1)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!connection) return null
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await Meteor.callAsync('ai.connections.save', {
        connections: [{ ...keep(connection), apiKey, ...(grace && connection.hasKey ? { rotate: { graceHours: grace } } : {}) }],
        ...(reason.trim() && { reason: reason.trim() }),
      })
      const after = out.fingerprints?.[connection.name]
      onDone(`Rotated the key of ${connection.name}: ${connection.keyFingerprint ? `…${connection.keyFingerprint.split('…').pop()}` : 'none'} → ${after ? `…${after.split('…').pop()}` : 'saved'}.`)
    } catch (err) {
      setError(failure(err, 'The key was not rotated.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="rotate-title">
      <DialogTitle id="rotate-title">Rotate the key of {connection.name}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>{keyText(connection)}.</Typography>
        <TextField label="New key" type="password" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} fullWidth autoFocus />
        <TextField select label="The old key" value={grace} onChange={(e) => setGrace(Number(e.target.value))} fullWidth sx={{ mt: 2 }}>
          {GRACE.map((g) => <MenuItem key={g.value} value={g.value}>{g.label}</MenuItem>)}
        </TextField>
        <Reason value={reason} onChange={setReason} />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !apiKey} onClick={save}>Rotate key</Button>
      </DialogActions>
    </Dialog>
  )
}

function RemoveConnection({ connection, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!connection) return null
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await Meteor.callAsync('ai.connections.remove', { names: [connection.name], reason: reason.trim() })
      onDone(`Removed ${connection.name}${out.clearedChoices.length ? ` and the choices that named it (${out.clearedChoices.join(', ')})` : ''}.`)
    } catch (err) {
      setError(failure(err, 'The connection was not removed.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="remove-connection-title">
      <DialogTitle id="remove-connection-title">Remove {connection.name} and its key</DialogTitle>
      <DialogContent>
        <Typography variant="body2">Features that use it go back to the settings file or the built-in AI. The saved key is deleted.</Typography>
        <Reason value={reason} onChange={setReason} />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep it</Button>
        <Button color="error" variant="contained" disabled={busy || !reason.trim()} onClick={run}>Remove connection and key</Button>
      </DialogActions>
    </Dialog>
  )
}

function AddProvider({ open, onClose, onDone }) {
  const [form, setForm] = useState(providerFormDefaults)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm(providerFormDefaults())
      setError('')
    }
  }, [open])
  if (!open) return null
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const provider = {
        id: form.id.trim(), label: form.label.trim(), protocol: form.protocol,
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim(), baseUrlLocked: form.baseUrlLocked } : { baseUrl: null }),
        ...(form.protocol !== 'anthropic-messages' && { auth: { style: form.authStyle, ...(['header', 'query'].includes(form.authStyle) && { name: form.authName.trim() }) } }),
        extraHeaders: parseHeaders(form.headers),
        defaultCapabilities: form.caps,
      }
      await Meteor.callAsync('ai.providers.save', { provider })
      onDone(`Added the provider ${provider.label}.`)
    } catch (err) {
      setError(failure(err, 'The provider was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="add-provider-title">
      <DialogTitle id="add-provider-title">Add a provider</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Id" value={form.id} onChange={set('id')} helperText="Lowercase letters, digits and dashes, for example gemini." />
          <TextField label="Label" value={form.label} onChange={set('label')} />
          <TextField select label="Wire protocol" value={form.protocol} onChange={set('protocol')}>
            {PROTOCOLS.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
          </TextField>
          <TextField label="Address" value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://…/v1" helperText="Leave empty to let each connection give its own." />
          {form.baseUrl.trim() && <FormControlLabel control={<Switch checked={form.baseUrlLocked} onChange={set('baseUrlLocked')} />} label="Connections keep this address" />}
          {form.protocol !== 'anthropic-messages' && (
            <Stack direction="row" spacing={2}>
              <TextField select label="How the key is sent" value={form.authStyle} onChange={set('authStyle')} sx={{ minWidth: 220 }}>
                <MenuItem value="bearer">Authorization: Bearer</MenuItem>
                <MenuItem value="header">A header</MenuItem>
                <MenuItem value="query">A query parameter</MenuItem>
                <MenuItem value="none">No key</MenuItem>
              </TextField>
              {['header', 'query'].includes(form.authStyle) && <TextField label={form.authStyle === 'header' ? 'Header name' : 'Parameter name'} value={form.authName} onChange={set('authName')} />}
            </Stack>
          )}
          <TextField label="Extra headers (nothing secret)" value={form.headers} onChange={set('headers')} multiline minRows={2} placeholder="x-client: slatebox" />
          <Box>
            <Typography variant="body2" color="text.secondary">What its models can usually do</Typography>
            {CAPS.map((cap) => (
              <FormControlLabel key={cap} control={<Checkbox checked={Boolean(form.caps[cap])} onChange={(e) => setForm({ ...form, caps: { ...form.caps, [cap]: e.target.checked } })} />} label={cap} />
            ))}
          </Box>
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.id.trim() || !form.label.trim()} onClick={save}>Save provider</Button>
      </DialogActions>
    </Dialog>
  )
}

function ConnectionRow({ connection, onTest, onRotate, onToggle, onRemove, tested }) {
  const off = connection.status === 'disabled'
  return (
    <Box data-testid={`connection-${connection.name}`} sx={{ py: 1.25, borderTop: 1, borderColor: 'divider', opacity: off ? 0.6 : 1 }}>
      <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
        <Typography variant="subtitle2">{connection.name}</Typography>
        {connection.model && <Typography component="span" sx={mono} color="text.secondary">{connection.model}</Typography>}
        {off && <Chip size="small" label="Turned off" />}
        {connection.editable === false && <Chip size="small" variant="outlined" label="Settings file" />}
      </Box>
      <Typography variant="body2" color="text.secondary">{keyText(connection)} · {lastCheckText(connection)}</Typography>
      {connection.previousKeyUntil && <Typography variant="body2" color="text.secondary">The previous key keeps working until {new Date(connection.previousKeyUntil).toLocaleString()}.</Typography>}
      {tested && <Alert severity={tested.ok ? 'success' : 'warning'} sx={{ mt: 1, py: 0 }}>{tested.text}</Alert>}
      {connection.editable === false ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Set in the settings file. Change it there.</Typography>
      ) : (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
          <Button size="small" onClick={() => onTest(connection)}>Test</Button>
          <Button size="small" onClick={() => onRotate(connection)}>{connection.hasKey ? 'Rotate key' : 'Add a key'}</Button>
          <Button size="small" onClick={() => onToggle(connection)}>{off ? 'Turn on' : 'Turn off'}</Button>
          <Button size="small" color="error" onClick={() => onRemove(connection)}>Remove…</Button>
        </Stack>
      )}
    </Box>
  )
}

export default function Providers() {
  const [providers, setProviders] = useState(null)
  const [connections, setConnections] = useState([])
  const [hosted, setHosted] = useState(true)
  const [keysAvailable, setKeysAvailable] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [adding, setAdding] = useState(null)
  const [addingProvider, setAddingProvider] = useState(false)
  const [rotating, setRotating] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [tests, setTests] = useState({})

  const load = async () => {
    try {
      const [snap, listed] = await Promise.all([Meteor.callAsync('ai.control.get', {}), Meteor.callAsync('ai.connections.list', {})])
      setProviders(snap.providers)
      setConnections(listed.connections)
      setHosted(listed.hosted)
      setKeysAvailable(listed.keysAvailable)
      setError('')
    } catch (err) {
      setError(failure(err, 'The providers could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  const done = (text) => {
    setAdding(null)
    setAddingProvider(false)
    setRotating(null)
    setRemoving(null)
    setNote({ severity: 'success', text })
    load()
  }
  const test = async (connection) => {
    setTests({ ...tests, [connection.name]: { ok: true, text: 'Testing…' } })
    try {
      const result = await Meteor.callAsync('ai.check', { level: 'server', name: connection.name })
      setTests((t) => ({ ...t, [connection.name]: { ok: result.ok, text: checkResultText(result, connection) } }))
      load()
    } catch (err) {
      setTests((t) => ({ ...t, [connection.name]: { ok: false, text: failure(err, 'The test did not run.') } }))
    }
  }
  const toggle = async (connection) => {
    try {
      await Meteor.callAsync('ai.connections.save', { connections: [{ ...keep(connection), status: connection.status === 'disabled' ? 'active' : 'disabled' }] })
      done(`${connection.name} is ${connection.status === 'disabled' ? 'on' : 'off'}.`)
    } catch (err) {
      setNote({ severity: 'warning', text: failure(err, 'The connection was not changed.') })
    }
  }

  if (error) return <Alert severity="warning">{error}</Alert>
  if (!providers) return <Typography color="text.secondary">Reading providers…</Typography>
  const byProvider = (id) => connections.filter((c) => c.provider === id || c.type === id)
  const models = providers.filter((p) => !p.aux)
  const services = providers.filter((p) => p.aux)
  const card = (p) => (
    <Paper key={p.id} variant="outlined" sx={{ p: 2 }} data-testid={`provider-${p.id}`}>
      <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
        <Typography variant="subtitle1" component="h3">{p.label}</Typography>
        <Typography component="span" sx={mono} color="text.secondary">{p.id}</Typography>
        {p.builtin && <Chip size="small" label="Built in" />}
      </Box>
      <Typography variant="body2" color="text.secondary">
        {p.protocol}{p.baseUrl ? ` · ${p.baseUrl}${p.baseUrlLocked ? '' : ' (connections may change it)'}` : ' · each connection gives its address'}
        {p.auth?.style === 'header' && p.auth.name ? ` · key in ${p.auth.name}` : ''}{p.auth?.style === 'query' ? ` · key in ?${p.auth.name}` : ''}
      </Typography>
      {byProvider(p.id).map((c) => (
        <ConnectionRow key={c.name} connection={c} tested={tests[c.name]} onTest={test} onRotate={setRotating} onToggle={toggle} onRemove={setRemoving} />
      ))}
      <Button size="small" sx={{ mt: 1 }} onClick={() => setAdding({ provider: p.id })}>Add a connection</Button>
    </Paper>
  )

  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      {!keysAvailable && <Alert severity="warning" sx={{ mb: 2 }}>This server has no key-encryption key, so it cannot save keys. Connections without a key, or with a key from an environment variable, still work.</Alert>}
      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Models</Typography>
        <Button variant="outlined" size="small" onClick={() => setAdding({})}>Add connection</Button>
        <Button size="small" onClick={() => setAddingProvider(true)}>Add provider…</Button>
      </Box>
      <Stack spacing={2}>{models.map(card)}</Stack>
      <Typography variant="h6" component="h2" sx={{ mt: 4, mb: 1 }}>Services beside the models</Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        Picture search, icons, call transcription and generated pictures. A key saved here is used from the next request, instead of the settings file&apos;s.
      </Typography>
      <Stack spacing={2}>{services.map(card)}</Stack>
      <AddConnection open={adding} onClose={() => setAdding(null)} onDone={done} providers={providers} hosted={hosted} />
      <AddProvider open={addingProvider} onClose={() => setAddingProvider(false)} onDone={done} />
      <RotateKey connection={rotating} onClose={() => setRotating(null)} onDone={done} />
      <RemoveConnection connection={removing} onClose={() => setRemoving(null)} onDone={done} />
    </Box>
  )
}
