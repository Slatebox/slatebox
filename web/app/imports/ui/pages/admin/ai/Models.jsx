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
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ReasonDialog } from './ReasonDialog'
import { capsText, checkResultText, modelFormDefaults, numberOrNull, priceText, unpricedIds } from './catalog-view.mjs'

// Admin › AI control › Models: the models each provider serves, what they can do and what they cost
// per million tokens. Metering charges these prices from the next call. Test sends one short
// request with the provider's active key.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
// the Test results shown under each row, by id
const NO_TESTS = {}
const CAPS = [['tools', 'Calls tools'], ['vision', 'Reads pictures'], ['images', 'Makes pictures'], ['json', 'Answers in JSON'], ['reasoning', 'Reasons']]

function ModelDialog({ open, providers, onClose, onDone }) {
  const [form, setForm] = useState(() => modelFormDefaults(open, providers))
  const [found, setFound] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setForm(modelFormDefaults(open, providers))
      setFound(null)
      setError('')
    }
  }, [open])
  if (!open) return null
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const find = async () => {
    setError('')
    try {
      setFound(await Meteor.callAsync('ai.models.discover', { provider: form.provider }))
    } catch (err) {
      setError(failure(err, 'The provider\'s models could not be listed.'))
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const input = numberOrNull(form.inputPerM)
      const output = numberOrNull(form.outputPerM)
      const image = numberOrNull(form.imageEach)
      if ([input, output, image].some((n) => Number.isNaN(n))) throw new Error('Prices are numbers in dollars.')
      const model = {
        provider: form.provider, model: form.model.trim(), label: form.label.trim() || null, capabilities: form.caps,
        maxOutput: numberOrNull(form.maxOutput), status: form.status,
        prices: input === null && output === null && image === null ? null : { inputPerM: input, outputPerM: output, imageEach: image },
      }
      await Meteor.callAsync('ai.models.save', { models: [model] })
      onDone(`Saved ${model.label || model.model}.`)
    } catch (err) {
      setError(failure(err, 'The model was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="model-dialog-title">
      <DialogTitle id="model-dialog-title">{form.existing ? 'Change a model' : 'Add a model'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Provider" value={form.provider} onChange={set('provider')} disabled={form.existing}>
            {providers.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
          </TextField>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField label="Model id" value={form.model} onChange={set('model')} disabled={form.existing} fullWidth helperText="As the provider names it, for example muse-ember-1.0." />
            {!form.existing && <Button onClick={find} disabled={!form.provider} sx={{ mt: 1 }}>Find models</Button>}
          </Stack>
          {found && (found.ok
            ? <TextField select label="Models the provider lists" value="" onChange={(e) => setForm({ ...form, model: e.target.value })}>{found.models.map((m) => <MenuItem key={m.id} value={m.id}>{m.id}</MenuItem>)}</TextField>
            : <Alert severity="warning">{found.message}</Alert>)}
          <TextField label="Name shown" value={form.label} onChange={set('label')} placeholder="Muse Ember" />
          <Box>
            <Typography variant="body2" color="text.secondary">What it can do</Typography>
            {CAPS.map(([cap, text]) => <FormControlLabel key={cap} control={<Checkbox checked={Boolean(form.caps[cap])} onChange={(e) => setForm({ ...form, caps: { ...form.caps, [cap]: e.target.checked } })} />} label={text} />)}
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField label="Price in ($ per M tokens)" value={form.inputPerM} onChange={set('inputPerM')} />
            <TextField label="Price out ($ per M tokens)" value={form.outputPerM} onChange={set('outputPerM')} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Or per picture ($)" value={form.imageEach} onChange={set('imageEach')} />
            <TextField label="Longest answer (tokens)" value={form.maxOutput} onChange={set('maxOutput')} />
          </Stack>
          <TextField select label="Status" value={form.status} onChange={set('status')}>
            <MenuItem value="enabled">On</MenuItem>
            <MenuItem value="disabled">Off (no part of Slatebox can use it)</MenuItem>
          </TextField>
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.provider || !form.model.trim()} onClick={save}>Save model</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Models() {
  const [snap, setSnap] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [tests, setTests] = useState(NO_TESTS)

  const load = async () => {
    try {
      setSnap(await Meteor.callAsync('ai.control.get', {}))
      setError('')
    } catch (err) {
      setError(failure(err, 'The models could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  const done = (text) => {
    setEditing(null)
    setRemoving(null)
    setNote({ severity: 'success', text })
    load()
  }
  const test = async (m) => {
    setTests((t) => ({ ...t, [m._id]: { ok: true, text: 'Testing…' } }))
    try {
      const result = await Meteor.callAsync('ai.models.test', { id: m._id })
      setTests((t) => ({ ...t, [m._id]: { ok: result.ok, text: checkResultText(result) } }))
    } catch (err) {
      setTests((t) => ({ ...t, [m._id]: { ok: false, text: failure(err, 'The test did not run.') } }))
    }
  }

  if (error) return <Alert severity="warning">{error}</Alert>
  if (!snap) return <Typography color="text.secondary">Reading models…</Typography>
  const providers = snap.providers.filter((p) => !p.aux && p.status !== 'archived')
  const labelOf = (id) => providers.find((p) => p.id === id)?.label || id
  const unpriced = unpricedIds(snap.warnings)
  const models = [...snap.models].sort((a, b) => labelOf(a.provider).localeCompare(labelOf(b.provider)) || a.model.localeCompare(b.model))
  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Models</Typography>
        <Button variant="outlined" size="small" disabled={!providers.length} onClick={() => setEditing({})}>Add a model</Button>
      </Box>
      {!providers.length && <Alert severity="info" sx={{ mb: 2 }}>Add a provider on Providers and keys first.</Alert>}
      <TableContainer>
        <Table size="small" aria-label="Models">
          <TableHead>
            <TableRow>
              <TableCell>Provider</TableCell>
              <TableCell>Model id</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Can do</TableCell>
              <TableCell>Price (in / out)</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {models.map((m) => (
              <TableRow key={m._id} data-testid={`model-${m._id}`} sx={{ opacity: m.status === 'disabled' ? 0.6 : 1 }}>
                <TableCell>{labelOf(m.provider)}</TableCell>
                <TableCell><span style={mono}>{m.model}</span></TableCell>
                <TableCell>{m.label || '—'} {m.status === 'disabled' && <Chip size="small" label="Off" />}</TableCell>
                <TableCell>{capsText(m.capabilities)}</TableCell>
                <TableCell>
                  {priceText(m)}
                  {unpriced.has(m._id) && <Typography variant="caption" color="warning.main" display="block">Charged at the highest rate until you add a price</Typography>}
                  {tests[m._id] && <Alert severity={tests[m._id].ok ? 'success' : 'warning'} sx={{ mt: 0.5, py: 0 }}>{tests[m._id].text}</Alert>}
                </TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => test(m)}>Test</Button>
                  <Button size="small" onClick={() => setEditing({ model: m })}>Edit</Button>
                  <Button size="small" color="error" onClick={() => setRemoving(m)}>Remove…</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <ModelDialog open={editing} providers={providers} onClose={() => setEditing(null)} onDone={done} />
      <ReasonDialog
        open={Boolean(removing)}
        danger
        title={removing ? `Remove ${removing.label || removing.model}?` : ''}
        body={<Typography variant="body2">A model a part of Slatebox uses cannot be removed: change it on the Bindings tab first.</Typography>}
        action="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async (reason) => {
          await Meteor.callAsync('ai.models.remove', { id: removing._id, reason })
          done(`Removed ${removing.label || removing.model}.`)
        }}
      />
    </Box>
  )
}
