import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Stack from '@mui/material/Stack'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { routeText, sourceText } from './bindings-view.mjs'

// Admin › AI control › What a person gets: for one person (by their id, or someone not signed in),
// which provider and model answers each part of Slatebox, and where that comes from: the part's own
// choice, the part it follows, the default, the built-in default, or (self-hosted) their own AI.
const failure = (err, fallback) => err?.reason || err?.message || fallback

export default function Effective() {
  const [userId, setUserId] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const show = async () => {
    setBusy(true)
    setError('')
    try {
      setResult(await Meteor.callAsync('ai.control.effective', { ...(userId.trim() && { userId: userId.trim() }) }))
    } catch (err) {
      setError(failure(err, 'That could not be worked out.'))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { show() }, [])

  const titles = Object.fromEntries((result?.surfaces || []).map((s) => [s.id, s.title]))
  const rows = (result?.surfaces || []).filter((s) => s.resolved && s.id !== 'default')
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        What one person gets for each part of Slatebox, and where it comes from.
      </Typography>
      <Stack direction="row" spacing={2} alignItems="center" mb={2} flexWrap="wrap" useFlexGap>
        <TextField size="small" label="Person (user id)" value={userId} onChange={(e) => setUserId(e.target.value)} helperText="Empty: someone not signed in" sx={{ width: 260 }} />
        <Button variant="outlined" disabled={busy} onClick={show}>Show</Button>
      </Stack>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {result && (
        <Table size="small" aria-label="What a person gets" data-testid="effective-binding">
          <TableHead>
            <TableRow>
              <TableCell>Part of Slatebox</TableCell>
              <TableCell>Provider · model</TableCell>
              <TableCell>Where from</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.title}</TableCell>
                <TableCell>{s.resolved.own ? s.resolved.own.label : s.resolved.enabled === false ? s.resolved.disabledMessage : routeText(s.resolved.route)}</TableCell>
                <TableCell>{sourceText(s.resolved, titles)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}
