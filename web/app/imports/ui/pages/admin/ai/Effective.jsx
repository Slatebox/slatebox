import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { effectiveRows } from './bindings-view.mjs'

// Admin › AI control › What a person gets: every field of a part's effective binding for someone
// (a person by their id, or someone not signed in), with where each value came from: a published
// binding, AI settings, the settings file or the built-in default (ai.control.effective).
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback

export default function Effective() {
  const [userId, setUserId] = useState('')
  const [surface, setSurface] = useState('agent.slatebox')
  const [result, setResult] = useState(null)
  const [models, setModels] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const show = async () => {
    setBusy(true)
    setError('')
    try {
      const [eff, snap] = await Promise.all([
        Meteor.callAsync('ai.control.effective', { ...(userId.trim() && { userId: userId.trim() }) }),
        Meteor.callAsync('ai.control.get', {}),
      ])
      setResult(eff)
      setModels(snap.models || [])
    } catch (err) {
      setError(failure(err, 'That could not be worked out.'))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { show() }, [])

  const bound = (result?.surfaces || []).filter((s) => s.binding)
  const row = bound.find((s) => s.id === surface) || bound[0]
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        What one person gets for each part of Slatebox, field by field, and where each value comes from.
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" mb={2} flexWrap="wrap" useFlexGap>
        <TextField size="small" label="Person (user id)" value={userId} onChange={(e) => setUserId(e.target.value)} helperText="Empty: someone not signed in" sx={{ width: 260 }} />
        <Button variant="outlined" disabled={busy} onClick={show}>Show</Button>
        {bound.length > 0 && (
          <TextField select size="small" label="Part of Slatebox" value={row?.id || ''} onChange={(e) => setSurface(e.target.value)} sx={{ minWidth: 320 }}>
            {bound.map((s) => <MenuItem key={s.id} value={s.id}>{s.title}</MenuItem>)}
          </TextField>
        )}
      </Stack>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {row && (
        <Box data-testid="effective-binding">
          <Typography variant="h6" component="h2">{row.title}</Typography>
          <Typography sx={mono} color="text.secondary" mb={1}>{row.id}{result.userId ? ` · for ${result.userId}` : ' · for someone not signed in'}</Typography>
          <Table size="small" aria-label="Effective binding">
            <TableHead>
              <TableRow>
                <TableCell>Field</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Comes from</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {effectiveRows(row.binding, models).map((r) => (
                <TableRow key={r.field}>
                  <TableCell>{r.field}</TableCell>
                  <TableCell>{r.value}</TableCell>
                  <TableCell>{r.from}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  )
}
