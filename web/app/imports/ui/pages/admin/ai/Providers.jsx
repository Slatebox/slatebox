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
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ReasonDialog } from './ReasonDialog'
import { addablePresets, checkResultText, keyAddedText, keyFormDefaults, keyStatusText, lastTestText, lastUsedText, parseHeaders, priceText, providerFormDefaults, providerSubtitle } from './catalog-view.mjs'

// Admin › AI control › Providers and keys: every model provider this server talks to (Meta (Muse),
// DeepInfra, …), its keys, and the services beside the models. Keys live only in the backend,
// encrypted with the server's key-encryption key: a key field is always empty, and no action returns
// a key, only which key it is (its fingerprint), when it was added, last tested and last used.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
// the Test results shown under each row, by id
const NO_TESTS = {}

function AddProvider({ open, presets, onClose, onDone }) {
  const [form, setForm] = useState(() => providerFormDefaults(presets))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm(providerFormDefaults(presets))
      setError('')
    }
  }, [open])
  if (!open) return null
  const preset = presets.find((p) => p.id === form.preset) || {}
  const other = preset.baseUrlLocked === false
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const choose = (e) => setForm(providerFormDefaults(presets, e.target.value))
  const toggleModel = (model) => setForm({ ...form, models: form.models.includes(model) ? form.models.filter((m) => m !== model) : [...form.models, model] })
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const provider = {
        preset: form.preset, ...(form.label.trim() && { label: form.label.trim() }), ...(form.id.trim() && { id: form.id.trim() }),
        ...(other && { baseUrl: form.baseUrl.trim(), extraHeaders: parseHeaders(form.headers) }),
      }
      const added = await Meteor.callAsync('ai.providers.add', { provider, models: form.models })
      let tested = null
      if (form.apiKey) {
        const key = await Meteor.callAsync('ai.keys.add', { provider: added.provider.id, apiKey: form.apiKey })
        tested = await Meteor.callAsync('ai.keys.test', { id: key.id }).catch(() => null)
      }
      onDone(`Added ${added.provider.label}${form.apiKey ? ` with its key${tested ? `: ${checkResultText(tested).replace(/\.$/, '')}` : ''}` : '. Add its key to use it'}.`)
    } catch (err) {
      setError(failure(err, 'The provider was not added.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="add-provider-title">
      <DialogTitle id="add-provider-title">Add a provider</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Provider" value={form.preset} onChange={choose}>
            {presets.map((p) => <MenuItem key={p.id} value={p.id} disabled={p.added}>{p.label}{p.added ? ' (added: change it on its card)' : ''}</MenuItem>)}
          </TextField>
          <TextField label="Name shown" value={form.label} onChange={set('label')} />
          {other && <TextField label="Id" value={form.id} onChange={set('id')} helperText="Lowercase letters, digits and dashes, for example our-models." />}
          <TextField
            label="Address" value={other ? form.baseUrl : preset.baseUrl || ''} onChange={set('baseUrl')} disabled={!other}
            placeholder="https://…/v1" helperText={other ? 'Any address that speaks the OpenAI API, up to /v1.' : 'Fixed for this provider.'}
          />
          {other && <TextField label="Extra headers (nothing secret)" value={form.headers} onChange={set('headers')} multiline minRows={2} placeholder="x-client: slatebox" />}
          <TextField label="Key" type="password" autoComplete="new-password" value={form.apiKey} onChange={set('apiKey')} helperText="Stored encrypted on this server. Slatebox never shows it again. It is tested after saving." />
          {(preset.models || []).length > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary">Models to add</Typography>
              {preset.models.map((m) => (
                <FormControlLabel key={m.model} control={<Checkbox checked={form.models.includes(m.model)} onChange={() => toggleModel(m.model)} />}
                  label={<span>{m.label} <span style={mono}>{m.model}</span> · {priceText(m)}</span>} />
              ))}
            </Box>
          )}
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || (other && (!form.baseUrl.trim() || !form.id.trim()))} onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

// Add a key (a provider with none), or replace the active one ("cycle"): paste, test, switch. The
// old key is revoked at once when the switch is made; a key that fails its test is never switched to.
function KeyDialog({ open, onClose, onDone }) {
  const [form, setForm] = useState(keyFormDefaults)
  const [tested, setTested] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm(keyFormDefaults())
      setTested(null)
      setError('')
    }
  }, [open])
  if (!open) return null
  const { provider, active } = open
  const replacing = Boolean(active)
  const needsModel = Boolean(provider.modelLabel)
  const set = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value })
    if (key === 'apiKey') setTested(null)
  }
  const test = async () => {
    setBusy(true)
    setError('')
    try {
      setTested(await Meteor.callAsync('ai.keys.test', { provider: provider.id, apiKey: form.apiKey, ...(form.model.trim() && { model: form.model.trim() }) }))
    } catch (err) {
      setError(failure(err, 'The test did not run.'))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const extra = { ...(form.model.trim() && { model: form.model.trim() }), ...(form.label.trim() && { label: form.label.trim() }) }
      if (replacing) {
        const out = await Meteor.callAsync('ai.keys.rotate', { provider: provider.id, apiKey: form.apiKey, ...extra })
        if (!out.activated) {
          setTested(out.test)
          setError('The new key did not pass its test, so the old key stays active. The new key is saved as standby.')
          return
        }
        onDone(`${provider.label} now uses ${out.key.keyFingerprint}.${out.revoked ? ` The old key (${out.revoked.keyFingerprint}) is revoked.` : ''}`)
      } else {
        const key = await Meteor.callAsync('ai.keys.add', { provider: provider.id, apiKey: form.apiKey, ...extra })
        onDone(`Saved ${provider.label}'s key ${key.keyFingerprint}.`)
      }
    } catch (err) {
      setError(failure(err, 'The key was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="key-dialog-title">
      <DialogTitle id="key-dialog-title">{replacing ? `Replace ${provider.label}'s key` : `Add ${provider.label}'s key`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2">1. Paste the new key</Typography>
          <TextField label={provider.keyLabel || 'Key'} type="password" autoComplete="new-password" value={form.apiKey} onChange={set('apiKey')} autoFocus />
          {needsModel && <TextField label={provider.modelLabel} value={form.model} onChange={set('model')} />}
          <Box>
            <Typography variant="body2">2. Test it</Typography>
            <Button size="small" variant="outlined" sx={{ mt: 1 }} disabled={busy || !form.apiKey} onClick={test}>Test new key</Button>
            {tested && <Alert severity={tested.ok ? 'success' : 'warning'} sx={{ mt: 1, py: 0 }}>{checkResultText(tested)}</Alert>}
          </Box>
          {replacing && (
            <Typography variant="body2">
              3. Switch to the new key: the old key (<span style={mono}>{active.keyFingerprint}</span>) is revoked at once.
            </Typography>
          )}
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.apiKey || (replacing && !tested?.ok)} onClick={save}>{replacing ? 'Switch to the new key' : 'Save key'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function KeyRow({ k, tested, onTest, onActivate, onRevoke, onDelete }) {
  const revoked = k.status === 'revoked'
  return (
    <Box data-testid={`key-${k.id}`} sx={{ py: 1, borderTop: 1, borderColor: 'divider', opacity: revoked ? 0.65 : 1 }}>
      <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
        <Chip size="small" color={k.status === 'active' ? 'success' : 'default'} label={keyStatusText(k)} />
        <Typography component="span" sx={mono}>{k.keyFingerprint}</Typography>
        <Typography component="span" variant="body2" color="text.secondary">{keyAddedText(k)}</Typography>
        {!revoked && <Typography component="span" variant="body2" color="text.secondary">· {lastUsedText(k)}</Typography>}
      </Box>
      {!revoked && <Typography variant="body2" color="text.secondary">{lastTestText(k)}</Typography>}
      {tested && <Alert severity={tested.ok ? 'success' : 'warning'} sx={{ mt: 1, py: 0 }}>{tested.text}</Alert>}
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap">
        {!revoked && <Button size="small" onClick={() => onTest(k)}>Test</Button>}
        {k.status === 'standby' && <Button size="small" onClick={() => onActivate(k)}>Switch to this key</Button>}
        {!revoked && <Button size="small" color="error" onClick={() => onRevoke(k)}>Revoke…</Button>}
        {k.status !== 'active' && <Button size="small" onClick={() => onDelete(k)}>Delete…</Button>}
      </Stack>
    </Box>
  )
}

export default function Providers() {
  const [snap, setSnap] = useState(null)
  const [keys, setKeys] = useState([])
  const [keysAvailable, setKeysAvailable] = useState(true)
  const [usedBy, setUsedBy] = useState({})
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [adding, setAdding] = useState(false)
  const [keying, setKeying] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [tests, setTests] = useState(NO_TESTS)

  const load = async () => {
    try {
      const [control, listed, bindings] = await Promise.all([
        Meteor.callAsync('ai.control.get', {}), Meteor.callAsync('ai.keys.list', {}), Meteor.callAsync('ai.bindings.list', {}),
      ])
      setSnap(control)
      setKeys(listed.keys)
      setKeysAvailable(listed.keysAvailable)
      // which parts of Slatebox each provider answers, for the revoke warning
      const parts = {}
      for (const row of bindings.surfaces) {
        const provider = row.resolved?.route?.provider
        if (provider && row.resolved.enabled) (parts[provider] ||= []).push(row.title)
      }
      setUsedBy(parts)
      setError('')
    } catch (err) {
      setError(failure(err, 'The providers could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  const done = (text, severity = 'success') => {
    setAdding(false)
    setKeying(null)
    setConfirming(null)
    setNote({ severity, text })
    load()
  }
  const test = async (k) => {
    setTests((t) => ({ ...t, [k.id]: { ok: true, text: 'Testing…' } }))
    try {
      const result = await Meteor.callAsync('ai.keys.test', { id: k.id })
      setTests((t) => ({ ...t, [k.id]: { ok: result.ok, text: checkResultText(result) } }))
      load()
    } catch (err) {
      setTests((t) => ({ ...t, [k.id]: { ok: false, text: failure(err, 'The test did not run.') } }))
    }
  }
  const activate = async (k) => {
    try {
      const out = await Meteor.callAsync('ai.keys.activate', { id: k.id })
      done(`Switched to ${out.key.keyFingerprint}.${out.revoked ? ` The old key (${out.revoked.keyFingerprint}) is revoked.` : ''}`)
    } catch (err) {
      setNote({ severity: 'warning', text: failure(err, 'The key was not switched.') })
    }
  }

  if (error) return <Alert severity="warning">{error}</Alert>
  if (!snap) return <Typography color="text.secondary">Reading providers…</Typography>
  const labelOf = (id) => snap.providers.find((p) => p.id === id)?.label || id
  const imports = (snap.health || []).filter((h) => h.kind === 'keys-import')
  const leftovers = (snap.health || []).filter((h) => h.kind === 'keys-settings')
  const modelProviders = snap.providers.filter((p) => !p.aux && p.status !== 'archived')
  const services = snap.providers.filter((p) => p.aux)
  const keysOf = (id) => keys.filter((k) => k.provider === id)

  const card = (p) => {
    const own = keysOf(p.id)
    const active = own.find((k) => k.status === 'active')
    const models = snap.models.filter((m) => m.provider === p.id).map((m) => m.label || m.model)
    return (
      <Paper key={p.id} variant="outlined" sx={{ p: 2 }} data-testid={`provider-${p.id}`}>
        <Box display="flex" alignItems="baseline" gap={1} flexWrap="wrap">
          <Typography variant="subtitle1" component="h3">{p.label}</Typography>
          <Typography component="span" variant="caption" color="text.secondary">{providerSubtitle(p)}</Typography>
        </Box>
        {!active && <Typography variant="body2" color="warning.main" sx={{ mt: 0.5 }}>No active key: the parts that use {p.label} do not answer until you add one.</Typography>}
        {own.map((k) => (
          <KeyRow key={k.id} k={k} tested={tests[k.id]} onTest={test} onActivate={activate}
            onRevoke={(key) => setConfirming({ kind: 'revoke', key, provider: p })}
            onDelete={(key) => setConfirming({ kind: 'delete', key, provider: p })} />
        ))}
        {!p.aux && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Models: {models.length ? models.join(', ') : 'none yet (add them on the Models tab)'}</Typography>}
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button size="small" variant="outlined" disabled={!keysAvailable} onClick={() => setKeying({ provider: p, active })}>{active ? 'Replace key…' : 'Add a key'}</Button>
          {!p.aux && <Button size="small" color="error" onClick={() => setConfirming({ kind: 'archive', provider: p })}>Archive…</Button>}
        </Stack>
      </Paper>
    )
  }

  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      {imports.map((h) => <Alert key={h.id} severity="error" sx={{ mb: 2 }} data-testid="keys-import-alert">{h.problem}</Alert>)}
      {leftovers.map((h) => <Alert key={h.id} severity="warning" sx={{ mb: 2 }}>{h.problem}</Alert>)}
      {!keysAvailable && <Alert severity="error" sx={{ mb: 2 }}>This server has no key-encryption key, so it cannot store keys. Set SLATEBOX_KEY_ENCRYPTION_KEY and restart.</Alert>}
      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Providers and keys</Typography>
        <Button variant="outlined" size="small" onClick={() => setAdding(true)}>Add a provider</Button>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Keys are stored encrypted on this server. Slatebox never shows a key again after you save it.
      </Typography>
      <Stack spacing={2}>{modelProviders.map(card)}</Stack>
      <Typography variant="h6" component="h2" sx={{ mt: 4, mb: 1 }}>Services beside the models</Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>Generated pictures, picture search, icons and call transcription.</Typography>
      <Stack spacing={2}>{services.map(card)}</Stack>
      <AddProvider open={adding} presets={addablePresets(snap.presets || [], snap.providers)} onClose={() => setAdding(false)} onDone={done} />
      <KeyDialog open={keying} onClose={() => setKeying(null)} onDone={done} />
      <ReasonDialog
        open={Boolean(confirming)}
        danger
        title={confirming?.kind === 'revoke' ? `Revoke ${confirming.provider.label}'s key ${confirming.key.keyFingerprint}?`
          : confirming?.kind === 'delete' ? `Delete the record of ${confirming.key.keyFingerprint}?` : confirming ? `Archive ${confirming.provider.label}?` : ''}
        body={confirming?.kind === 'revoke' && confirming.key.status === 'active'
          ? <Typography variant="body2">{(usedBy[confirming.provider.id] || []).length ? `${usedBy[confirming.provider.id].join(', ')} use this provider; they stop answering until you add a key.` : 'Nothing uses this provider right now.'} The key is wiped; its record stays.</Typography>
          : confirming?.kind === 'archive' ? <Typography variant="body2">A provider a part of Slatebox uses cannot be archived: change it on the Bindings tab first.</Typography> : null}
        action={confirming?.kind === 'revoke' ? 'Revoke' : confirming?.kind === 'delete' ? 'Delete' : 'Archive'}
        onClose={() => setConfirming(null)}
        onConfirm={async (reason) => {
          if (confirming.kind === 'revoke') await Meteor.callAsync('ai.keys.revoke', { id: confirming.key.id, reason })
          else if (confirming.kind === 'delete') await Meteor.callAsync('ai.keys.remove', { id: confirming.key.id, reason })
          else await Meteor.callAsync('ai.providers.archive', { id: confirming.provider.id, reason })
          done(confirming.kind === 'revoke' ? `Revoked ${labelOf(confirming.provider.id)}'s key ${confirming.key.keyFingerprint}.` : confirming.kind === 'delete' ? 'Deleted the key\'s record.' : `Archived ${confirming.provider.label}.`)
        }}
      />
    </Box>
  )
}
