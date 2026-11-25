import React, { Fragment, useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { actionText, actorText, auditCsv, diffRows, targetText } from './audit-diff.mjs'

// Every change to the AI configuration (ai.audit.list), newest first: AI control's own changes,
// AI settings at every level and persona saves. A row opens to what changed; keys show only as
// which key they are. Kept 400 days.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const AREAS = [
  { value: '', label: 'Every change' },
  { value: 'ai.update', label: 'AI settings (connections and choices)' },
  { value: 'ai.control.', label: 'AI control' },
  { value: 'ai.providers.', label: 'Providers' },
  { value: 'ai.connections.', label: 'Server connections and keys' },
  { value: 'ai.models.', label: 'Models and prices' },
  { value: 'ai.bindings.', label: 'Bindings (models, fallbacks, on and off per part)' },
]
const failure = (err, fallback) => err?.reason || err?.message || fallback

// The row's details for an administrator: the action's id and what it was made to, as the API,
// exec and the CSV name them.
function Details({ row }) {
  return (
    <Typography component="div" variant="caption" color="text.secondary" sx={{ mt: 1 }} data-testid="audit-details">
      Action <span style={mono}>{row.action}</span>
      {row.target?.kind && <> on <span style={mono}>{row.target.kind} {row.target.id}</span></>}
    </Typography>
  )
}

function Changes({ row }) {
  const rows = diffRows(row.before, row.after)
  if (row.outcome === 'refused') return <><Typography variant="body2">Refused: {row.error || 'not allowed'}. Nothing changed.</Typography><Details row={row} /></>
  if (!rows.length) return <><Typography variant="body2" color="text.secondary">No field changed.</Typography><Details row={row} /></>
  return (
    <>
    <Table size="small" aria-label="What changed">
      <TableHead>
        <TableRow>
          <TableCell>Field</TableCell>
          <TableCell>Before</TableCell>
          <TableCell>After</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((d) => (
          <TableRow key={d.path}>
            <TableCell sx={mono}>{d.path}</TableCell>
            <TableCell sx={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 420 }}>{d.before}</TableCell>
            <TableCell sx={{ ...mono, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 420 }}>{d.after}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
    <Details row={row} />
    </>
  )
}

export default function Audit() {
  const [area, setArea] = useState('')
  const [outcome, setOutcome] = useState('')
  const [rows, setRows] = useState(null)
  const [next, setNext] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')
  // the plain titles of the parts of Slatebox, for "Changed"
  const [titles, setTitles] = useState({})
  useEffect(() => {
    Meteor.callAsync('ai.control.get', {})
      .then((snap) => setTitles(Object.fromEntries((snap.surfaces || []).map((s) => [s.id, s.title]))))
      .catch(() => {})
  }, [])

  const load = async (before = null) => {
    try {
      const out = await Meteor.callAsync('ai.audit.list', {
        limit: 50,
        ...(area && { action: area }),
        ...(outcome && { outcome }),
        ...(before && { before }),
      })
      setRows(before ? [...(rows || []), ...out.rows] : out.rows)
      setNext(out.next)
      setError('')
    } catch (err) {
      setError(failure(err, 'The change history could not be read.'))
    }
  }
  useEffect(() => {
    setOpen(null)
    load()
  }, [area, outcome])

  const download = () => {
    const blob = new Blob([auditCsv(rows || [])], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `slatebox-ai-changes-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <Box>
      <Box display="flex" gap={2} flexWrap="wrap" alignItems="center" mb={2}>
        <TextField select size="small" label="Show" value={area} onChange={(e) => setArea(e.target.value)} sx={{ minWidth: 280 }}>
          {AREAS.map((a) => <MenuItem key={a.value || 'all'} value={a.value}>{a.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Saved and refused</MenuItem>
          <MenuItem value="ok">Saved</MenuItem>
          <MenuItem value="refused">Refused</MenuItem>
        </TextField>
        <Button variant="outlined" onClick={download} disabled={!rows?.length}>Download CSV</Button>
      </Box>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}
      {rows && !rows.length && <Typography color="text.secondary">No changes recorded yet.</Typography>}
      {rows?.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="AI configuration changes">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Who</TableCell>
                <TableCell>What</TableCell>
                <TableCell>Changed</TableCell>
                <TableCell>Why</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <Fragment key={row._id}>
                  <TableRow
                    hover
                    onClick={() => setOpen(open === row._id ? null : row._id)}
                    sx={{ cursor: 'pointer' }}
                    data-testid="audit-row"
                    aria-expanded={open === row._id}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(row.at).toLocaleString()}</TableCell>
                    <TableCell>{actorText(row.actor)}</TableCell>
                    <TableCell title={row.action}>
                      {actionText(row)}
                      {row.outcome === 'refused' && <Typography component="span" color="error" variant="body2"> (refused)</Typography>}
                    </TableCell>
                    <TableCell>{targetText(row.target, titles)}</TableCell>
                    <TableCell>{row.reason || ''}</TableCell>
                  </TableRow>
                  {open === row._id && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>
                        <Changes row={row} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {next && <Box mt={2}><Button onClick={() => load(next)}>Show older changes</Button></Box>}
    </Box>
  )
}
