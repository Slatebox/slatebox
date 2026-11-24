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
import { ReasonDialog } from './BindingEditor'

const usd = (micros) => `$${(micros / 1_000_000).toFixed(2)}`
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback

// Where a surface's model comes from, in words (resolve.mjs provenance.chain).
function source(binding, titles) {
  const layer = binding.provenance?.chain || 'code'
  let where = 'Built in'
  if (layer === 'file') where = 'Settings file'
  else if (/^db:[^@]+:choice$/.test(layer)) where = 'AI settings'
  else if (/@v\d+$/.test(layer)) where = `Set here (version ${layer.split('@v')[1]})`
  return binding.followed ? `Follows ${titles[binding.followed] || binding.followed} · ${where}` : where
}

function modelOf(binding) {
  const first = binding.chain?.[0]
  if (!first) return { model: 'None', via: '' }
  return { model: first.model || 'The connection\'s default model', via: first.connection === 'builtin' ? `built in · ${first.provider || ''}` : first.connection }
}

// A row's text when the surface has no binding of its own to show.
const NOTES = {
  'Not in this build': 'Not in this build',
  'Served by a built-in service': 'A built-in service answers this',
  'Applies to every surface not set below': 'What every part below follows until it has its own choice',
  'Names its model per call': 'Each test run names its own model',
}

function ResetChoices({ open, onClose, onDone, parts }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await Meteor.callAsync('ai.control.reset', { target: 'use', reason: reason.trim() })
      onDone(out)
    } catch (err) {
      setError(failure(err, 'The choices were not reset.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="reset-choices-title">
      <DialogTitle id="reset-choices-title">Return the server&apos;s AI choices to the settings file</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          This removes the choices an administrator made in AI settings for: {parts.join(', ')}. Those parts then use the
          settings file or the built-in AI. Saved connections and their keys stay.
        </Typography>
        <TextField
          label="Why (kept in the change history)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          inputProps={{ maxLength: 500 }}
          autoFocus
        />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep them</Button>
        <Button color="error" variant="contained" disabled={busy || !reason.trim()} onClick={run}>Remove the choices</Button>
      </DialogActions>
    </Dialog>
  )
}

// AI for everyone: on, or off with the message people see (ai.control.setGlobal, a person only).
// Also switches AI control's own settings back on after a reset switched them off.
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
  const turningOff = open.kind === 'ai' && open.to === false
  const titles = {
    ai: open.to ? 'Turn AI back on for everyone' : 'Turn AI off for everyone',
    dbLayer: 'Switch AI control\'s settings back on',
  }
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const input = open.kind === 'dbLayer' ? { dbLayer: 'on' } : { aiEnabled: open.to, ...(turningOff && { message: message.trim() }) }
      await Meteor.callAsync('ai.control.setGlobal', { ...input, reason: reason.trim() })
      onDone(open.kind === 'dbLayer' ? 'AI control\'s settings are on again.' : open.to ? 'AI is on for everyone.' : 'AI is off for everyone. People see your message.')
    } catch (err) {
      setError(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="global-switch-title">
      <DialogTitle id="global-switch-title">{titles[open.kind]}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {open.kind === 'dbLayer'
            ? 'Bindings, providers and models saved in AI control apply again on every server within seconds.'
            : open.to ? 'Every part of Slatebox answers with AI again within seconds.' : 'No part of Slatebox asks a model until AI is turned back on. These admin pages keep working.'}
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
          {open.kind === 'dbLayer' ? 'Switch on' : open.to ? 'Turn AI on' : 'Turn AI off'}
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
  const [resetting, setResetting] = useState(false)
  const [switching, setSwitching] = useState(null)
  const [rollingBack, setRollingBack] = useState(null)

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
  const appChoices = effective.surfaces.filter((s) => s.binding && !s.binding.followed && s.binding.provenance?.chain === 'db:server:choice')
  const health = snapshot.health || []

  return (
    <Box>
      {health.length > 0 ? (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="ai-control-health">
          <Typography variant="subtitle2">Some AI settings are not in use, so those parts use the settings file or built-in AI</Typography>
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {health.map((h) => (
              <li key={`${h.kind}:${h.id}`}>
                <span style={mono}>{h.id}</span>: {h.problem}
                {h.kind === 'breaker' && <Button size="small" color="inherit" sx={{ ml: 1 }} onClick={() => setRollingBack(h.id)}>Roll back</Button>}
              </li>
            ))}
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
      {snapshot.dbLayer === 'off' && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => setSwitching({ kind: 'dbLayer' })}>Switch back on</Button>}>
          AI control&apos;s own settings are switched off on this server. Every part uses AI settings, the settings file and the built-in AI.
        </Alert>
      )}
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}

      <Box display="flex" alignItems="baseline" gap={2} flexWrap="wrap" mb={1}>
        <Typography variant="h6" component="h2">Who answers what</Typography>
        <FormControlLabel
          data-testid="ai-control-global"
          control={<Switch checked={snapshot.global.aiEnabled} disabled={snapshot.dbLayer === 'off'} onChange={(e) => setSwitching({ kind: 'ai', to: e.target.checked, message: snapshot.global.aiDisabledMessage })} />}
          label={snapshot.global.aiEnabled ? 'AI for everyone: on' : `AI for everyone: off (“${snapshot.global.aiDisabledMessage || 'AI is turned off on this server.'}”)`}
        />
      </Box>
      <Typography variant="body2" color="text.secondary" mb={1}>
        As it resolves for someone not signed in. Calls, failures and spend are for the last 24 hours.
      </Typography>
      <TableContainer>
        <Table size="small" aria-label="Who answers what">
          <TableHead>
            <TableRow>
              <TableCell>Part of Slatebox</TableCell>
              <TableCell>Model</TableCell>
              <TableCell>Where the choice comes from</TableCell>
              <TableCell align="right">Calls</TableCell>
              <TableCell align="right">Failed</TableCell>
              <TableCell align="right">Spend</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {effective.surfaces.map((s) => {
              const used = usage[s.id] || { calls: 0, errors: 0, costMicros: 0 }
              const off = s.binding && !s.binding.enabled
              const { model, via } = s.binding ? modelOf(s.binding) : { model: '', via: '' }
              return (
                <TableRow key={s.id} data-testid={`surface-${s.id}`} sx={{ opacity: s.inBuild ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2">{s.title}</Typography>
                    <Typography component="span" sx={mono} color="text.secondary">{s.id}</Typography>
                  </TableCell>
                  {s.binding ? (
                    <>
                      <TableCell>
                        <Typography variant="body2">{off ? `Turned off: ${s.binding.disabledMessage}` : model}</Typography>
                        {!off && via && <Typography component="span" sx={mono} color="text.secondary">{via}</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="body2">{source(s.binding, titles)}</Typography></TableCell>
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

      {appChoices.length > 0 && (
        <Box mt={3}>
          <Typography variant="h6" component="h2">Return to the settings file</Typography>
          <Typography variant="body2" color="text.secondary" mb={1}>
            An administrator chose AI for {appChoices.map((s) => s.title).join(', ')} in AI settings.
          </Typography>
          <Button variant="outlined" color="error" onClick={() => setResetting(true)}>Remove the server&apos;s AI choices…</Button>
        </Box>
      )}
      <ReasonDialog
        open={Boolean(rollingBack)}
        title={rollingBack ? `Roll back ${titles[rollingBack] || rollingBack}` : ''}
        action="Roll back"
        body={<Typography variant="body2">Publishes the version before the one that keeps failing, or removes the binding when there is none, so it follows its parent and the built-in AI again.</Typography>}
        onClose={() => setRollingBack(null)}
        onConfirm={async (reason) => {
          const list = await Meteor.callAsync('ai.bindings.list', {})
          const entry = list.surfaces.find((e) => e.surface === rollingBack)
          const previous = entry?.versions.find((v) => v.status === 'superseded' && v.version < (entry.head?.version ?? 0))
          if (previous) await Meteor.callAsync('ai.bindings.rollback', { surface: rollingBack, toVersion: previous.version, reason })
          else await Meteor.callAsync('ai.control.reset', { target: 'binding', surface: rollingBack, reason })
          setNote({ severity: 'success', text: previous ? `Rolled ${titles[rollingBack]} back to version ${previous.version}.` : `Removed the binding of ${titles[rollingBack]}.` })
          setRollingBack(null)
          load()
        }}
      />
      <GlobalSwitch
        open={switching}
        onClose={() => setSwitching(null)}
        onDone={(text) => {
          setSwitching(null)
          setNote({ severity: 'success', text })
          load()
        }}
      />
      <ResetChoices
        open={resetting}
        parts={appChoices.map((s) => s.title)}
        onClose={() => setResetting(false)}
        onDone={(out) => {
          setResetting(false)
          setNote({ severity: 'success', text: out.cleared.length ? `Removed the choices for ${out.cleared.map((key) => titles[key] || key).join(', ')}.` : 'There were no choices to remove.' })
          load()
        }}
      />
    </Box>
  )
}
