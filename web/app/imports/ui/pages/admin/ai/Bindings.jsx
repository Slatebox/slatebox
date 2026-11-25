import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import ListSubheader from '@mui/material/ListSubheader'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { changesOf, choiceGroups, choiceValue, defaultChoiceText, routeText } from './bindings-view.mjs'

// Admin › AI control › Bindings: which model each part of Slatebox uses. One choice per part: a
// provider's model, "Use the default", or turned off. "Everything not set" is the default (Meta
// Muse Ember until another is chosen). Save writes only the rows that changed; each is one line in
// the Changes tab.
const failure = (err, fallback) => err?.reason || err?.message || fallback

export default function Bindings() {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState({})
  const [noteText, setNoteText] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const [listed, snap] = await Promise.all([Meteor.callAsync('ai.bindings.list', {}), Meteor.callAsync('ai.control.get', {})])
      setData({ listed, snap })
      setDraft(Object.fromEntries(listed.surfaces.map((row) => [row.surface, choiceValue(row.binding)])))
      setError('')
    } catch (err) {
      setError(failure(err, 'The bindings could not be read.'))
    }
  }
  useEffect(() => { load() }, [])

  if (error) return <Alert severity="warning">{error}</Alert>
  if (!data) return <Typography color="text.secondary">Reading bindings…</Typography>
  const { listed, snap } = data
  const saved = Object.fromEntries(listed.surfaces.map((row) => [row.surface, choiceValue(row.binding)]))
  const changes = changesOf(saved, draft)
  const save = async () => {
    setBusy(true)
    try {
      const out = await Meteor.callAsync('ai.bindings.set', { changes, ...(noteText.trim() && { note: noteText.trim() }) })
      setNote({ severity: 'success', text: out.changed.length ? `Saved ${out.changed.length} change${out.changed.length === 1 ? '' : 's'}.` : 'Nothing changed.' })
      setNoteText('')
      await load()
    } catch (err) {
      setNote({ severity: 'warning', text: failure(err, 'The changes were not saved.') })
    } finally {
      setBusy(false)
    }
  }

  const row = (r) => {
    const groups = choiceGroups({ providers: snap.providers, models: snap.models, keys: snap.keys || {}, needs: r.needs })
    const isDefault = r.surface === 'default'
    const sub = r.follows && r.follows !== 'default'
    return (
      <Box key={r.surface} data-testid={`binding-${r.surface}`} display="flex" alignItems="center" gap={2} flexWrap="wrap" sx={{ py: 1, pl: sub ? 3 : 0 }}>
        <Box sx={{ minWidth: 300, flex: '1 1 300px' }}>
          <Typography variant="body2" fontWeight={isDefault ? 600 : 400}>{isDefault ? 'Everything not set' : r.title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {r.resolved?.enabled === false ? 'Turned off' : `Answers with ${routeText(r.resolved?.route)}`}
          </Typography>
        </Box>
        <TextField select size="small" value={draft[r.surface] ?? 'default'} onChange={(e) => setDraft({ ...draft, [r.surface]: e.target.value })} sx={{ minWidth: 380, flex: '1 1 380px' }}
          SelectProps={{ MenuProps: { PaperProps: { style: { maxHeight: 480 } } } }} inputProps={{ 'aria-label': `Model for ${r.title}` }}>
          <MenuItem value="default">{defaultChoiceText(r, listed.surfaces, snap.defaultRoute)}</MenuItem>
          {groups.flatMap((g) => [
            <ListSubheader key={`h-${g.provider}`}>{g.label}{g.hasKey ? '' : ' (no key)'}</ListSubheader>,
            ...g.items.map((item) => (
              <MenuItem key={item.value} value={item.value} disabled={item.disabled}>
                {g.label} · {item.label}{item.reason ? ` (${item.reason})` : ''}
              </MenuItem>
            )),
          ])}
          {!isDefault && <Divider />}
          {!isDefault && <MenuItem value="off">Turned off</MenuItem>}
        </TextField>
      </Box>
    )
  }

  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      {(listed.skipped || []).map((h) => <Alert key={h.id} severity="warning" sx={{ mb: 2 }}>{h.id}: {h.problem}. That part uses the default until this is fixed.</Alert>)}
      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Which model each part of Slatebox uses</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        A part that is not set uses the default (a sub-part follows its parent first). A model that cannot do what a part needs is listed but cannot be chosen.
      </Typography>
      {listed.surfaces.map(row)}
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 2 }}>
        <TextField size="small" label="Note (optional, kept in the change history)" value={noteText} onChange={(e) => setNoteText(e.target.value)} sx={{ flex: 1 }} inputProps={{ maxLength: 500 }} />
        <Button variant="contained" disabled={busy || !changes.length} onClick={save}>Save{changes.length ? ` (${changes.length})` : ''}</Button>
      </Stack>
    </Box>
  )
}
