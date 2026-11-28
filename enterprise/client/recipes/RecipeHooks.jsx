// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A recipe's webhooks, for developers who hook into it:
//  - outbound: Slatebox POSTs signed events (run finished, diagram changed, approval needed, ...) to a URL;
//  - inbound: a URL your build or tool POSTs to, to run the recipe with data;
//  - intercept: Slatebox asks your URL before it draws or before a change outside Slatebox, and uses the answer.
// A new secret is shown once. Rotating keeps the old one signing for 24 h. Send test posts a signed ping;
// the delivery log keeps 14 days.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import recipesApi from './recipesApi'
import { deliveryRow, hookEvents, hookUrlProblem, inboundCurlSample, interceptPoints, recipeErrorWords } from './recipesModel.mjs'

const DIRECTION_WORDS = { outbound: 'Send events', inbound: 'Run from outside', intercept: 'Ask before acting' }

function SecretOnce({ secret, url, sample }) {
  const [copied, setCopied] = useState('')
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); setCopied(`${what} copied.`) } catch { setCopied('Select it and copy it.') } }
  return (
    <Box role="status" data-hook-secret="" sx={{ border: 1, borderColor: 'warning.main', borderRadius: 1, p: 2, display: 'grid', gap: 1 }}>
      <Typography fontWeight={650}>Copy the secret now. It is not shown again.</Typography>
      {url && <TextField size="small" label="Address to call" value={url} slotProps={{ htmlInput: { readOnly: true } }} onFocus={(e) => e.target.select()} />}
      <TextField size="small" label="Signing secret" value={secret} slotProps={{ htmlInput: { readOnly: true, style: { fontFamily: 'monospace' } } }} onFocus={(e) => e.target.select()} />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained" disableElevation onClick={() => copy(secret, 'Secret')}>Copy secret</Button>
        {url && <Button size="small" onClick={() => copy(url, 'Address')}>Copy address</Button>}
      </Box>
      {sample && (
        <>
          <Typography variant="body2">Try it (set SLATEBOX_HOOK_SECRET to the secret first):</Typography>
          <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12, overflowX: 'auto' }}>{sample}</Box>
          <Button size="small" sx={{ justifySelf: 'start' }} onClick={() => copy(sample, 'Sample')}>Copy sample</Button>
        </>
      )}
      {copied && <Typography variant="body2">{copied}</Typography>}
    </Box>
  )
}

function Deliveries({ hookId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true
    recipesApi.deliveries({ hookId }).then((a) => { if (live) setRows(a?.deliveries ?? []) }, () => { if (live) setRows([]) })
    return () => { live = false }
  }, [hookId])
  if (rows === null) return <Typography variant="body2" color="text.secondary">Finding deliveries…</Typography>
  if (!rows.length) return <Typography variant="body2" color="text.secondary">Nothing sent in the last 14 days.</Typography>
  return (
    <Table size="small" aria-label="Deliveries">
      <TableHead><TableRow><TableCell>When</TableCell><TableCell>Event</TableCell><TableCell>Try</TableCell><TableCell>Result</TableCell><TableCell>Code</TableCell><TableCell>Took</TableCell></TableRow></TableHead>
      <TableBody>
        {rows.map(deliveryRow).map((d) => (
          <TableRow key={d.id}><TableCell>{d.when}</TableCell><TableCell>{d.event}</TableCell><TableCell>{d.attempt}</TableCell><TableCell>{d.state}</TableCell><TableCell>{d.code}</TableCell><TableCell>{d.duration}</TableCell></TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function HookRow({ hook, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [secret, setSecret] = useState(null)
  const [log, setLog] = useState(false)
  async function act(fn, done) {
    setBusy(true); setNote('')
    try { const a = await fn(); if (done) done(a) } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  const what = hook.direction === 'outbound' ? `${(hook.events || []).includes('*') ? 'Every event' : `${(hook.events || []).length} events`} to ${hook.url}`
    : hook.direction === 'intercept' ? `${hook.point} · asks ${hook.url} · ${hook.failMode === 'closed' ? 'skips the run if it does not answer' : 'carries on if it does not answer'}`
      : hook.url || 'Inbound address'
  return (
    <Box data-recipe-hook={hook._id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography fontWeight={650}>{DIRECTION_WORDS[hook.direction]}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{what}</Typography>
        {hook.state === 'disabled' && <Typography variant="body2" color="error">Turned off after failing 8 times</Typography>}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {hook.direction !== 'inbound' && <Button size="small" disabled={busy} onClick={() => act(() => recipesApi.hooks.test({ hookId: hook._id }), (a) => setNote(a?.status ? `Test sent: ${a.status}.` : 'Test sent.'))}>Send test</Button>}
        <Button size="small" disabled={busy} onClick={() => act(() => recipesApi.hooks.rotate({ hookId: hook._id }), (a) => setSecret(a?.secret || null))}>New secret</Button>
        {hook.direction !== 'inbound' && <Button size="small" onClick={() => setLog(!log)} aria-expanded={log}>{log ? 'Hide deliveries' : 'Deliveries'}</Button>}
        <Button size="small" color="error" disabled={busy} onClick={() => act(() => recipesApi.hooks.remove({ hookId: hook._id }), onChanged)}>Remove</Button>
      </Box>
      {secret && <SecretOnce secret={secret} />}
      {log && <Deliveries hookId={hook._id} />}
      {note && <Typography role="status" variant="body2">{note}</Typography>}
    </Box>
  )
}

export default function RecipeHooks({ instance, manifest }) {
  const [hooks, setHooks] = useState(null)
  const [direction, setDirection] = useState('outbound')
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState(() => new Set(['run.finished', 'diagram.changed', 'approval.needed']))
  const [point, setPoint] = useState('')
  const [failMode, setFailMode] = useState('open')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null)
  const points = interceptPoints(manifest)
  const load = () => recipesApi.hooks.list({ instanceId: instance._id }).then((a) => setHooks(a?.hooks ?? []), () => setHooks([]))
  useEffect(() => { load() }, [instance._id]) // eslint-disable-line react-hooks/exhaustive-deps
  const urlProblem = direction === 'inbound' ? null : hookUrlProblem(url)
  async function add(event) {
    event.preventDefault()
    if (urlProblem) { setError(urlProblem); return }
    setBusy(true); setError(''); setMade(null)
    try {
      const a = await recipesApi.hooks.add({
        scope: { instanceId: instance._id },
        direction,
        ...(direction !== 'inbound' && { url: url.trim() }),
        ...(direction === 'outbound' && { events: [...events] }),
        ...(direction === 'intercept' && { point: point || points[0]?.id, failMode }),
      })
      setMade({ secret: a.secret, url: a.url || a.hook?.url || null, inbound: direction === 'inbound' })
      setUrl('')
      load()
    } catch (e) { setError(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  const toggleEvent = (id) => setEvents((had) => { const next = new Set(had); if (next.has(id)) next.delete(id); else next.add(id); return next })
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-recipe-hooks="">
      <Typography variant="body2" color="text.secondary">
        Hook your own tools into this recipe. Every request is signed (Slatebox-Signature) with a secret only you see; receivers dedupe on Slatebox-Delivery.
      </Typography>
      {hooks === null && <Typography color="text.secondary">Finding webhooks…</Typography>}
      {hooks?.map((h) => <HookRow key={h._id} hook={h} onChanged={load} />)}
      <Box component="form" onSubmit={add} sx={{ display: 'grid', gap: 1.5, border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
        <Typography fontWeight={650}>Add a webhook</Typography>
        <ToggleButtonGroup exclusive size="small" value={direction} onChange={(e, v) => v && setDirection(v)} aria-label="Kind of webhook">
          <ToggleButton value="outbound">{DIRECTION_WORDS.outbound}</ToggleButton>
          <ToggleButton value="inbound">{DIRECTION_WORDS.inbound}</ToggleButton>
          {points.length > 0 && <ToggleButton value="intercept">{DIRECTION_WORDS.intercept}</ToggleButton>}
        </ToggleButtonGroup>
        {direction === 'inbound' && <Typography variant="body2" color="text.secondary">Slatebox makes an address. POST to it, signed, to run the recipe with your data (up to 30 times an hour).</Typography>}
        {direction !== 'inbound' && (
          <TextField size="small" label="Your https address" value={url} onChange={(e) => setUrl(e.target.value)} error={Boolean(url) && Boolean(urlProblem)} helperText={url ? urlProblem || ' ' : ' '} />
        )}
        {direction === 'outbound' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {hookEvents(manifest).map((ev) => (
              <FormControlLabel key={ev.id} control={<Checkbox size="small" checked={events.has(ev.id)} onChange={() => toggleEvent(ev.id)} />}
                label={<Typography variant="body2">{ev.label} <Box component="code" sx={{ color: 'text.secondary', fontSize: 12 }}>{ev.id}</Box></Typography>} />
            ))}
          </Box>
        )}
        {direction === 'intercept' && (
          <>
            <TextField select size="small" label="When to ask" value={point || points[0]?.id || ''} onChange={(e) => setPoint(e.target.value)}>
              {points.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="If it does not answer in 5 seconds" value={failMode} onChange={(e) => setFailMode(e.target.value)}>
              <MenuItem value="open">Carry on without it</MenuItem>
              <MenuItem value="closed">Skip the run</MenuItem>
            </TextField>
          </>
        )}
        {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
        <Button type="submit" variant="contained" disableElevation sx={{ justifySelf: 'start' }}
          disabled={busy || (direction !== 'inbound' && !url.trim()) || (direction === 'outbound' && events.size === 0)}>Add webhook</Button>
      </Box>
      {made && <SecretOnce secret={made.secret} url={made.inbound ? made.url : null} sample={made.inbound && made.url ? inboundCurlSample(made.url, manifest?.inputExample || {}) : null} />}
    </Box>
  )
}

RecipeHooks.propTypes = {
  instance: PropTypes.shape({ _id: PropTypes.string.isRequired }).isRequired,
  manifest: PropTypes.object,
}
