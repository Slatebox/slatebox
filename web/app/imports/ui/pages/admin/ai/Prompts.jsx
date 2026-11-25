import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import MenuItem from '@mui/material/MenuItem'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import PromptEditor from './PromptEditor'
import { KIND_LABELS, sourceText } from './prompts-view.mjs'

// Admin › AI control › Prompts: every text Slatebox sends its models, by part of Slatebox, with the
// version served now and where it comes from ("Built in" is the text Slatebox ships with), and any
// draft or agent suggestion waiting. Click one to edit, compare, test-run, publish or roll back.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback

export default function Prompts() {
  const [data, setData] = useState(null)
  const [titles, setTitles] = useState({})
  const [error, setError] = useState('')
  const [kind, setKind] = useState('all')
  const [open, setOpen] = useState(null)

  const load = async () => {
    try {
      const [list, snap] = await Promise.all([Meteor.callAsync('ai.prompts.list', {}), Meteor.callAsync('ai.control.get', {})])
      setData(list)
      setTitles(Object.fromEntries(snap.surfaces.map((s) => [s.id, s.title])))
      setError('')
    } catch (err) {
      setError(failure(err, 'The prompts could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  if (error) return <Alert severity="warning">{error}</Alert>
  if (!data) return <Typography color="text.secondary">Reading prompts…</Typography>
  const kinds = [...new Set(data.surfaces.flatMap((s) => s.prompts.map((p) => p.kind)))]

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        The text each part of Slatebox sends its model. A prompt nobody changed uses the text Slatebox ships with (built in). Edit one as a draft, test it with a sample, and publish it once its checks pass; every server uses it within seconds, and you can return to an earlier version or the built-in text at any time.
      </Typography>
      <TextField select size="small" label="Show" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 220, mb: 2 }}>
        <MenuItem value="all">Every kind</MenuItem>
        {kinds.map((k) => <MenuItem key={k} value={k}>{KIND_LABELS[k] || k}</MenuItem>)}
      </TextField>
      <TableContainer>
        <Table size="small" aria-label="Prompts">
          <TableHead>
            <TableRow>
              <TableCell>Prompt</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Served now</TableCell>
              <TableCell>Waiting</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.surfaces.map((group) => {
              const rows = group.prompts.filter((p) => kind === 'all' || p.kind === kind)
              if (!rows.length) return null
              return (
                <React.Fragment key={group.surface}>
                  <TableRow>
                    <TableCell colSpan={4} sx={{ bgcolor: 'action.hover', py: 0.5 }}><Typography variant="subtitle2">{group.title}</Typography></TableCell>
                  </TableRow>
                  {rows.map((p) => (
                    <TableRow key={p.id} hover data-testid={`prompt-${p.id}`} sx={{ cursor: 'pointer' }} onClick={() => setOpen(p.id)}>
                      <TableCell>
                        <Typography variant="body2">{p.title}</Typography>
                        <Typography component="span" sx={mono} color="text.secondary">{p.id}</Typography>
                        {p.problem && <Typography variant="caption" color="error" display="block">{p.problem}</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="body2">{KIND_LABELS[p.kind] || p.kind}</Typography></TableCell>
                      <TableCell>
                        {p.live.version || p.live.fallbackFrom ? <Typography variant="body2">{sourceText(p.live)}</Typography> : <Chip size="small" label="Built in" />}
                      </TableCell>
                      <TableCell>
                        {p.draft && <Chip size="small" color={p.draft.origin === 'ai-proposal' ? 'warning' : 'default'} label={p.draft.origin === 'ai-proposal' ? `Suggestion ${p.draft.version}` : `Draft ${p.draft.version}`} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2" color="text.secondary" mt={2}>
        The texts built into the canvas engine (how it describes its own operations) stay with the engine and are not listed here.
      </Typography>
      {open && <PromptEditor id={open} titles={titles} onClose={() => { setOpen(null); load() }} onChanged={load} />}
    </Box>
  )
}
