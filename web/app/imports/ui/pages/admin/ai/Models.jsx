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
import { modelFormDefaults, numberOrNull, priceText, unpricedIds } from './catalog-view.mjs'

// Admin › AI control › Models: the models each connection serves, what they can do and what they
// cost. The meter charges these prices from the next call; a model with no price is charged at
// the highest rate Slatebox knows until one is added.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const CAPS = ['tools', 'vision', 'json', 'images', 'reasoning']
const BUILTIN = ['deepinfra', 'openai', 'anthropic', 'stabilityai'].map((p) => `builtin:${p}`)
const UNPRICED = 'Until you add a price, Slatebox charges this model at its highest rate.'

function EditModel({ open, onClose, onDone, connections }) {
  const [form, setForm] = useState(() => modelFormDefaults(open, connections, BUILTIN))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setForm(modelFormDefaults(open, connections, BUILTIN))
    setError('')
  }, [open])
  if (!open) return null
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })
  const save = async () => {
    setBusy(true)
    setError('')
    const inputPerM = numberOrNull(form.inputPerM)
    const outputPerM = numberOrNull(form.outputPerM)
    const model = {
      connection: form.connection, model: form.model.trim(), label: form.label.trim() || null, capabilities: form.caps,
      maxContext: numberOrNull(form.maxContext), maxOutput: numberOrNull(form.maxOutput), status: form.status,
      prices: inputPerM === null && outputPerM === null ? null : { inputPerM, outputPerM },
    }
    if ([model.maxContext, model.maxOutput, inputPerM, outputPerM].some((v) => Number.isNaN(v))) {
      setBusy(false)
      setError('Limits and prices are numbers.')
      return
    }
    try {
      await Meteor.callAsync('ai.models.save', { models: [model] })
      onDone(`Saved ${model.label || model.model}.`)
    } catch (err) {
      setError(failure(err, 'The model was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="edit-model-title">
      <DialogTitle id="edit-model-title">{form.existing ? `Change ${form.label || form.model}` : 'Add a model'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField select label="Connection" value={form.connection} onChange={set('connection')} disabled={form.existing}>
            {[...connections, ...BUILTIN].map((c) => <MenuItem key={c} value={c}>{c.startsWith('builtin:') ? `Built-in AI · ${c.slice(8)}` : c.slice(7)}</MenuItem>)}
          </TextField>
          <TextField label="Model" value={form.model} onChange={set('model')} disabled={form.existing} helperText="The name the provider serves, for example gemini-3.5-flash." />
          <TextField label="Label" value={form.label} onChange={set('label')} />
          <Box>
            <Typography variant="body2" color="text.secondary">What it can do</Typography>
            {CAPS.map((cap) => (
              <FormControlLabel key={cap} control={<Checkbox checked={Boolean(form.caps?.[cap])} onChange={(e) => setForm({ ...form, caps: { ...form.caps, [cap]: e.target.checked } })} />} label={cap} />
            ))}
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField label="Context (tokens)" value={form.maxContext} onChange={set('maxContext')} inputProps={{ inputMode: 'numeric' }} />
            <TextField label="Most output (tokens)" value={form.maxOutput} onChange={set('maxOutput')} inputProps={{ inputMode: 'numeric' }} />
          </Stack>
          <Stack direction="row" spacing={2}>
            <TextField label="Input, $ per million" value={form.inputPerM} onChange={set('inputPerM')} inputProps={{ inputMode: 'decimal' }} />
            <TextField label="Output, $ per million" value={form.outputPerM} onChange={set('outputPerM')} inputProps={{ inputMode: 'decimal' }} />
          </Stack>
          {form.inputPerM === '' && form.outputPerM === '' && <Alert severity="info">{UNPRICED}</Alert>}
          <TextField select label="Status" value={form.status} onChange={set('status')}>
            <MenuItem value="enabled">On</MenuItem>
            <MenuItem value="disabled">Off (kept out of bindings)</MenuItem>
          </TextField>
        </Stack>
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !form.model?.trim()} onClick={save}>Save model</Button>
      </DialogActions>
    </Dialog>
  )
}

function FindModels({ connection, onClose, onPick }) {
  const [state, setState] = useState({ busy: true })
  useEffect(() => {
    if (!connection) return
    setState({ busy: true })
    Meteor.callAsync('ai.models.discover', { connection: connection.slice(7) })
      .then((out) => setState({ busy: false, out }))
      .catch((err) => setState({ busy: false, error: failure(err, 'The models could not be listed.') }))
  }, [connection])
  if (!connection) return null
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="find-models-title">
      <DialogTitle id="find-models-title">Models {connection.slice(7)} lists</DialogTitle>
      <DialogContent>
        {state.busy && <Typography color="text.secondary">Asking the provider…</Typography>}
        {state.error && <Alert severity="warning">{state.error}</Alert>}
        {state.out && !state.out.ok && <Alert severity="warning">{state.out.message}</Alert>}
        {state.out?.ok && (
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">{state.out.message} Pick one to add it, then confirm what it can do and its prices.</Typography>
            {state.out.models.slice(0, 100).map((m) => (
              <Button key={m.id} size="small" sx={{ justifyContent: 'flex-start', textTransform: 'none' }} onClick={() => onPick(m.id)}>{m.id}</Button>
            ))}
          </Stack>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  )
}

export default function Models() {
  const [snapshot, setSnapshot] = useState(null)
  const [connections, setConnections] = useState([])
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [editing, setEditing] = useState(null)
  const [finding, setFinding] = useState(null)
  const [findFrom, setFindFrom] = useState('')

  const load = async () => {
    try {
      const [snap, listed] = await Promise.all([Meteor.callAsync('ai.control.get', {}), Meteor.callAsync('ai.connections.list', {})])
      setSnapshot(snap)
      const chat = listed.connections.filter((c) => !c.aux && c.status !== 'disabled').map((c) => `server:${c.name}`)
      setConnections(chat)
      setFindFrom((current) => current || chat[0] || '')
      setError('')
    } catch (err) {
      setError(failure(err, 'The models could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  if (error) return <Alert severity="warning">{error}</Alert>
  if (!snapshot) return <Typography color="text.secondary">Reading models…</Typography>
  const unpriced = unpricedIds(snapshot.warnings)
  const models = [...snapshot.models].sort((a, b) => a._id.localeCompare(b._id))

  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      {unpriced.size > 0 && <Alert severity="warning" sx={{ mb: 2 }} data-testid="unpriced-warning">{unpriced.size === 1 ? 'One model has no price.' : `${unpriced.size} models have no price.`} {UNPRICED}</Alert>}
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Models</Typography>
        <Button variant="outlined" size="small" onClick={() => setEditing({})}>Add model</Button>
        {connections.length > 0 && (
          <>
            <TextField select size="small" label="Find models on" value={findFrom} onChange={(e) => setFindFrom(e.target.value)} sx={{ minWidth: 200 }}>
              {connections.map((c) => <MenuItem key={c} value={c}>{c.slice(7)}</MenuItem>)}
            </TextField>
            <Button size="small" disabled={!findFrom} onClick={() => setFinding(findFrom)}>Find models</Button>
          </>
        )}
      </Box>
      {models.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No models are listed yet. Each connection still serves the model it names; add a model here to give it capabilities and prices.</Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Models">
            <TableHead>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell>Connection</TableCell>
                <TableCell>Can</TableCell>
                <TableCell align="right">Context</TableCell>
                <TableCell>Price</TableCell>
                <TableCell>Status</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((m) => (
                <TableRow key={m._id} data-testid={`model-${m._id}`} sx={{ opacity: m.status === 'disabled' ? 0.6 : 1 }}>
                  <TableCell>
                    <Typography variant="body2">{m.label || m.model}</Typography>
                    <Typography component="span" sx={mono} color="text.secondary">{m._id}</Typography>
                  </TableCell>
                  <TableCell><Typography sx={mono}>{m.connection}</Typography></TableCell>
                  <TableCell>{CAPS.filter((cap) => m.capabilities?.[cap]).map((cap) => <Chip key={cap} size="small" label={cap} sx={{ mr: 0.5 }} />)}</TableCell>
                  <TableCell align="right">{m.maxContext ? m.maxContext.toLocaleString() : '–'}</TableCell>
                  <TableCell>
                    {unpriced.has(m._id) ? <Chip size="small" color="warning" label="Unpriced" title={UNPRICED} /> : <Typography variant="body2">{priceText(m)}</Typography>}
                  </TableCell>
                  <TableCell>{m.status === 'disabled' ? 'Off' : 'On'}</TableCell>
                  <TableCell><Button size="small" onClick={() => setEditing({ model: m })}>Change</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <EditModel open={editing} connections={connections} onClose={() => setEditing(null)} onDone={(text) => { setEditing(null); setNote({ severity: 'success', text }); load() }} />
      <FindModels connection={finding} onClose={() => setFinding(null)} onPick={(id) => { const from = finding; setFinding(null); setEditing({ connection: from, modelName: id }) }} />
    </Box>
  )
}
