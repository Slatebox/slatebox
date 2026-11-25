import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { routeText, sourceText } from './bindings-view.mjs'

const usd = (micros) => `$${(micros / 1_000_000).toFixed(2)}`
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback

// A row's text when the surface has no binding of its own to show.
const NOTES = {
  'Not in this build': 'Not in this build',
  'Served by a built-in service': 'A built-in service answers this',
  'Names its model per call': 'Each test run names its own model',
}

// AI for everyone: on, or off with the message people see (ai.control.setGlobal, a person only).
function GlobalSwitch({ open, onClose, onDone }) {
  const [message, setMessage] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setMessage(open.message || '')
      setReason('')
      setError('')
    }
  }, [open])
  if (!open) return null
  const turningOff = open.to === false
  const title = open.to ? 'Turn AI back on for everyone' : 'Turn AI off for everyone'
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await Meteor.callAsync('ai.control.setGlobal', { aiEnabled: open.to, ...(turningOff && { message: message.trim() }), reason: reason.trim() })
      onDone(open.to ? 'AI is on for everyone.' : 'AI is off for everyone. People see your message.')
    } catch (err) {
      setError(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="global-switch-title">
      <DialogTitle id="global-switch-title">{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {open.to ? 'Every part of Slatebox answers with AI again within seconds.' : 'No part of Slatebox asks a model until AI is turned back on. These admin pages keep working.'}
        </Typography>
        {turningOff && (
          <TextField label="What people see" value={message} onChange={(e) => setMessage(e.target.value)} fullWidth inputProps={{ maxLength: 300 }} sx={{ mb: 2 }} />
        )}
        <TextField label="Why (kept in the change history)" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} autoFocus />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={turningOff ? 'error' : 'primary'} disabled={busy || !reason.trim() || (turningOff && !message.trim())} onClick={run}>
          {open.to ? 'Turn AI on' : 'Turn AI off'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Overview() {
  const [snapshot, setSnapshot] = useState(null)
  const [effective, setEffective] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [switching, setSwitching] = useState(null)

  const load = async () => {
    try {
      const [snap, eff] = await Promise.all([
        Meteor.callAsync('ai.control.get', {}),
        Meteor.callAsync('ai.control.effective', { usage: true }),
      ])
      setSnapshot(snap)
      setEffective(eff)
      setError('')
    } catch (err) {
      setError(failure(err, 'AI control could not be read.'))
    }
  }
  useEffect(() => { load() }, [])

  if (error) return <Alert severity="warning">{error}</Alert>
  if (!snapshot || !effective) return <Typography color="text.secondary">Reading AI control…</Typography>

  const titles = Object.fromEntries(snapshot.surfaces.map((s) => [s.id, s.title]))
  const usage = effective.usage?.surfaces || {}
  const health = snapshot.health || []

  return (
    <Box>
      {health.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="ai-control-health">
          <Typography variant="subtitle2">Needs attention</Typography>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {health.map((h) => <li key={`${h.kind}:${h.id}`}><span style={mono}>{h.id}</span>: {h.problem}</li>)}
          </ul>
        </Alert>
      ) : (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="ai-control-health">No problems found in the AI settings.</Alert>
      )}
      {(snapshot.warnings || []).length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} data-testid="ai-control-warnings">
          <Typography variant="subtitle2">Worth a look</Typography>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {snapshot.warnings.map((w) => <li key={`${w.kind}:${w.id}`}><span style={mono}>{w.id}</span>: {w.problem}</li>)}
          </ul>
        </Alert>
      )}
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}

      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Models answering now</Typography>
        <FormControlLabel
          data-testid="ai-control-global"
          control={<Switch checked={snapshot.global.aiEnabled} onChange={(e) => setSwitching({ to: e.target.checked, message: snapshot.global.aiDisabledMessage })} />}
          label={snapshot.global.aiEnabled ? 'AI for everyone: on' : `AI for everyone: off (“${snapshot.global.aiDisabledMessage || 'AI is turned off on this server.'}”)`}
        />
      </Box>
      <Typography variant="body2" color="text.secondary" mb={1}>
        As it resolves for someone not signed in. Calls, failures and spend are for the last 24 hours.
      </Typography>
      <TableContainer>
        <Table size="small" aria-label="Models answering now">
          <TableHead>
            <TableRow>
              <TableCell>Part of Slatebox</TableCell>
              <TableCell>Provider · model</TableCell>
              <TableCell>Where from</TableCell>
              <TableCell align="right">Calls</TableCell>
              <TableCell align="right">Failed</TableCell>
              <TableCell align="right">Spend</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {effective.surfaces.map((s) => {
              const used = usage[s.id] || { calls: 0, errors: 0, costMicros: 0 }
              const r = s.resolved
              return (
                <TableRow key={s.id} data-testid={`surface-${s.id}`} sx={{ opacity: s.inBuild ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2">{s.id === 'default' ? 'Everything not set' : s.title}</Typography>
                  </TableCell>
                  {r ? (
                    <>
                      <TableCell>
                        <Typography variant="body2">{r.enabled === false ? r.disabledMessage : routeText(r.route)}</Typography>
                        {r.route && !r.route.error && !r.route.aux && !r.route.hasKey && <Typography variant="caption" color="warning.main">No active key</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="body2">{sourceText(r, titles)}</Typography></TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={2}><Typography variant="body2" color="text.secondary">{NOTES[s.note] || s.note}</Typography></TableCell>
                  )}
                  <TableCell align="right">{s.inBuild ? used.calls : ''}</TableCell>
                  <TableCell align="right">{s.inBuild ? used.errors : ''}</TableCell>
                  <TableCell align="right">{s.inBuild ? usd(used.costMicros) : ''}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <GlobalSwitch
        open={switching}
        onClose={() => setSwitching(null)}
        onDone={(text) => {
          setSwitching(null)
          setNote({ severity: 'success', text })
          load()
        }}
      />
    </Box>
  )
}
