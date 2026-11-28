// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A recipe's run history (recipes.runsFor, live): when, what started it, how it ended, how long, the
// agent tokens it used, what it changed (with links to the slates) and what it did outside Slatebox.
// A run opens to its log. "Undo this run" undoes each slate change it saved, as one step per slate.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import IconButton from '@mui/material/IconButton'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { RecipeRuns as RunsCollection } from '../collections'
import recipesApi from './recipesApi'
import { recipeErrorWords, runRow } from './recipesModel.mjs'

function RunLine({ run, slateLinks, canEdit, onUndone }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const row = runRow(run)
  async function undo() {
    setBusy(true)
    try { await recipesApi.undoRun({ runId: run._id }); setNote('Undone.'); onUndone() } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <TableRow data-recipe-run={run._id} sx={{ '& > td': { borderBottom: open ? 0 : undefined } }}>
        <TableCell padding="checkbox">
          <IconButton size="small" aria-label={open ? 'Hide the run log' : 'Show the run log'} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
          </IconButton>
        </TableCell>
        <TableCell>{row.when}{row.preview ? ' · preview' : ''}</TableCell>
        <TableCell>{row.trigger}</TableCell>
        <TableCell>{row.state}</TableCell>
        <TableCell>{row.duration}</TableCell>
        <TableCell>{row.tokens}</TableCell>
        <TableCell>
          {row.changes}
          {row.slates.map((id) => slateLinks[id] && <Box key={id} component={Link} to={`/canvas/${slateLinks[id].shareId}`} sx={{ display: 'block', fontSize: 13 }}>{slateLinks[id].name}</Box>)}
        </TableCell>
        <TableCell>{row.writes.length ? row.writes.map((w) => <Box key={w.text} sx={{ fontSize: 13 }}>{w.text}: {w.state}</Box>) : '—'}</TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={8} sx={{ bgcolor: 'action.hover' }}>
            {row.kept && <Typography variant="body2" sx={{ mb: 1 }}>{row.kept}</Typography>}
            {row.error && <Typography variant="body2" color="error" sx={{ mb: 1 }}>{row.error}</Typography>}
            <Box component="ol" aria-label="Run log" sx={{ m: 0, pl: 2, fontFamily: 'monospace', fontSize: 12, display: 'grid', gap: 0.25 }}>
              {row.log.length ? row.log.map((l, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <li key={i}><Box component="span" sx={{ color: l.level === 'error' ? 'error.main' : l.level === 'warn' ? 'warning.main' : 'text.secondary' }}>{l.level}</Box> {l.code} · {l.msg}</li>
              )) : <li>No log lines.</li>}
            </Box>
            {canEdit && row.undoable && <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={undo}>Undo this run</Button>}
            {note && <Typography role="status" variant="body2">{note}</Typography>}
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

export default function RecipeRunsTable({ instance, canEdit }) {
  const [limit, setLimit] = useState(20)
  const [tick, setTick] = useState(0)
  const { runs, ready } = useTracker(() => {
    const sub = Meteor.subscribe('recipes.runsFor', instance._id, limit)
    return { ready: sub.ready(), runs: RunsCollection.find({ instanceId: instance._id }, { sort: { startedAt: -1, dueAt: -1 }, limit }).fetch() }
  }, [instance._id, limit, tick])
  const slateLinks = instance.slateLinks || {}
  if (ready && !runs.length) return <Typography color="text.secondary">No runs yet. Run now starts one.</Typography>
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Runs">
        <TableHead>
          <TableRow>
            <TableCell />
            <TableCell>When</TableCell>
            <TableCell>Started by</TableCell>
            <TableCell>Result</TableCell>
            <TableCell>Took</TableCell>
            <TableCell>Tokens</TableCell>
            <TableCell>Changes</TableCell>
            <TableCell>Outside Slatebox</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => <RunLine key={run._id} run={run} slateLinks={slateLinks} canEdit={canEdit} onUndone={() => setTick((t) => t + 1)} />)}
        </TableBody>
      </Table>
      {runs.length >= limit && <Button size="small" sx={{ mt: 1 }} onClick={() => setLimit(limit + 20)}>Show older runs</Button>}
    </Box>
  )
}

RecipeRunsTable.propTypes = {
  instance: PropTypes.shape({ _id: PropTypes.string.isRequired, slateLinks: PropTypes.object }).isRequired,
  canEdit: PropTypes.bool,
}
