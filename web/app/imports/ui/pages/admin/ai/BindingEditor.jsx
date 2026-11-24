import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ON_LABELS, PARAM_FIELDS, bindingFromForm, chainOptions, chainText, formFromBinding, limitsText, moveLine, paramsText, toolsText } from './bindings-view.mjs'

// Admin › AI control › Bindings › one part of Slatebox: its model chain (the primary, then
// fallbacks with when each is tried), parameters, allowed tools, limits and on/off. Save keeps a
// draft that changes nothing; Publish asks why and is live on every server within seconds; any
// earlier version can be published again. Only a person publishes (ai.bindings.publish).
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const when = (at) => (at ? new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function ReasonDialog({ open, title, body, action, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])
  if (!open) return null
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (err) {
      setError(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="binding-reason-title">
      <DialogTitle id="binding-reason-title">{title}</DialogTitle>
      <DialogContent>
        {body}
        <TextField label="Why (kept in the change history)" value={reason} onChange={(e) => setReason(e.target.value)} fullWidth multiline minRows={2} inputProps={{ maxLength: 500 }} autoFocus sx={{ mt: 2 }} />
        {error && <Alert severity="warning" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={busy || !reason.trim()} onClick={run}>{action}</Button>
      </DialogActions>
    </Dialog>
  )
}

function Line({ row, index, options, onChange, onMove, onRemove, count }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} data-testid={`chain-line-${index}`}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" sx={{ minWidth: 72 }}>{index === 0 ? 'Primary' : `Fallback ${index}`}</Typography>
        <TextField select size="small" label="Model" value={row.value} onChange={(e) => onChange({ ...row, value: e.target.value })} sx={{ flex: 1 }}>
          {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <IconButton size="small" aria-label={`Move line ${index + 1} up`} disabled={index === 0} onClick={() => onMove(-1)}>↑</IconButton>
        <IconButton size="small" aria-label={`Move line ${index + 1} down`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</IconButton>
        <Button size="small" color="error" onClick={onRemove}>Remove</Button>
      </Stack>
      {index > 0 && (
        <Box mt={1}>
          <Typography variant="caption" color="text.secondary" component="div">Use when</Typography>
          {Object.entries(ON_LABELS).map(([cls, label]) => (
            <FormControlLabel
              key={cls}
              control={<Checkbox size="small" checked={row.on.includes(cls)} onChange={(e) => onChange({ ...row, on: e.target.checked ? [...row.on, cls] : row.on.filter((c) => c !== cls) })} />}
              label={label}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

/**
 * props: { surface: { id, title, follows, followsTitle, needs }, entry (ai.bindings.list row),
 *          effective (the surface's effective binding, for "Set its own"), models, connections,
 *          onClose, onChanged(text) }
 */
export default function BindingEditor({ surface, entry, effective, models, connections, onClose, onChanged }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(null)

  useEffect(() => {
    if (!surface) return
    setForm(formFromBinding(entry?.head, surface.id))
    setError('')
  }, [surface, entry])
  if (!surface || !form) return null
  const options = chainOptions({ models, connections })
  const set = (patch) => setForm({ ...form, ...patch })
  const needsTools = surface.needs?.includes('tools')
  const checked = () => {
    const out = bindingFromForm(form)
    if (out.error) setError(out.error)
    return out.binding || null
  }
  const saveDraft = async () => {
    const binding = checked()
    if (!binding) return
    setBusy(true)
    setError('')
    try {
      const out = await Meteor.callAsync('ai.bindings.saveDraft', { binding })
      onChanged(`Saved version ${out.version} of ${surface.title} as a draft. It changes nothing until it is published.`)
    } catch (err) {
      setError(failure(err, 'The draft was not saved.'))
    } finally {
      setBusy(false)
    }
  }
  const askPublish = () => {
    const binding = checked()
    if (!binding) return
    setError('')
    setConfirming({
      title: `Publish ${surface.title}`,
      action: 'Publish',
      body: (
        <Stack spacing={1}>
          <Typography variant="body2">Every server uses this within seconds.</Typography>
          <Typography variant="body2"><strong>Now:</strong> {entry?.head ? `${chainText(entry.head.chain, models) || `Follows ${surface.followsTitle || 'its parent'}`}${entry.head.enabled === false ? ' (off)' : ''}` : `Follows ${surface.followsTitle || 'the settings file'}`}</Typography>
          <Typography variant="body2"><strong>After:</strong> {binding.enabled === false ? `Off: “${binding.disabledMessage}”` : chainText(binding.chain, models) || `Follows ${surface.followsTitle || 'the settings file'}`}</Typography>
          {[paramsText(binding.params), toolsText(binding.tools), limitsText(binding.limits)].filter(Boolean).map((text) => <Typography key={text} variant="body2" color="text.secondary">{text}</Typography>)}
        </Stack>
      ),
      run: async (reason) => {
        const out = await Meteor.callAsync('ai.bindings.publish', { binding, reason })
        onChanged(`Published version ${out.version} of ${surface.title}.`)
      },
    })
  }
  const askPublishVersion = (version) => setConfirming({
    title: `Publish draft version ${version.version}`,
    action: 'Publish',
    body: <Typography variant="body2">{chainText(version.doc?.chain, models) || 'No model chain of its own'}{version.doc?.enabled === false ? ' (off)' : ''}</Typography>,
    run: async (reason) => {
      const out = await Meteor.callAsync('ai.bindings.publish', { surface: surface.id, version: version.version, reason })
      onChanged(`Published version ${out.version} of ${surface.title}.`)
    },
  })
  const askRollback = (version) => setConfirming({
    title: `Roll back to version ${version.version}`,
    action: 'Roll back',
    body: <Typography variant="body2">Publishes version {version.version} again as a new version: {chainText(version.doc?.chain, models) || 'no model chain of its own'}{version.doc?.enabled === false ? ' (off)' : ''}.</Typography>,
    run: async (reason) => {
      const out = await Meteor.callAsync('ai.bindings.rollback', { surface: surface.id, toVersion: version.version, reason })
      onChanged(`Rolled ${surface.title} back to version ${version.version} (now version ${out.version}).`)
    },
  })
  const setOwn = () => {
    const first = effective?.chain?.[0]
    const value = !first || first.connection === 'builtin' ? 'connection:builtin' : first.modelId ? `model:${first.modelId}` : `connection:${first.connection}`
    set({ chain: [{ value: options.some((o) => o.value === value) ? value : 'connection:builtin', on: [] }] })
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="binding-editor-title">
      <DialogTitle id="binding-editor-title">
        {surface.title}
        <Typography component="div" sx={mono} color="text.secondary">{surface.id}</Typography>
      </DialogTitle>
      <DialogContent>
        {entry?.skipped && <Alert severity="error" sx={{ mb: 2 }}>The published version is not in use: {entry.skipped}</Alert>}
        <Stack spacing={2}>
          <Box>
            <FormControlLabel control={<Switch checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />} label={form.enabled ? 'On' : 'Off for everyone'} />
            {!form.enabled && (
              <TextField label="What people see while it is off" InputLabelProps={{ shrink: true }} value={form.disabledMessage} onChange={(e) => set({ disabledMessage: e.target.value })} fullWidth inputProps={{ maxLength: 300 }} sx={{ mt: 1 }} />
            )}
          </Box>
          <Divider />
          <Box>
            <Typography variant="subtitle2" component="h3">Model chain</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>The primary answers first. A fallback is tried only when the one before it failed the way you tick.</Typography>
            {form.chain.length === 0 ? (
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" data-testid="binding-follows">Follows {surface.followsTitle || 'the settings file and built-in AI'}{effective?.chain?.[0] ? ` (now ${effective.chain[0].model || 'the built-in AI'})` : ''}.</Typography>
                <Button size="small" variant="outlined" onClick={setOwn}>Set its own</Button>
              </Stack>
            ) : (
              <Stack spacing={1}>
                {form.chain.map((row, index) => (
                  <Line
                    key={`${index}-${row.value}`}
                    row={row}
                    index={index}
                    count={form.chain.length}
                    options={options}
                    onChange={(next) => set({ chain: form.chain.map((r, i) => (i === index ? next : r)) })}
                    onMove={(by) => set({ chain: moveLine(form.chain, index, by) })}
                    onRemove={() => set({ chain: moveLine(form.chain.filter((_r, i) => i !== index), 0, 0) })}
                  />
                ))}
                {form.chain.length < 5 && <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => set({ chain: [...form.chain, { value: 'connection:builtin', on: ['infra'] }] })}>Add a fallback</Button>}
              </Stack>
            )}
          </Box>
          <Divider />
          <Box>
            <Typography variant="subtitle2" component="h3">Parameters</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>Leave a field empty for the feature&apos;s own value.</Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              {PARAM_FIELDS.map((field) => (
                <TextField key={field.key} size="small" label={field.label} value={form.params[field.key]} helperText={field.help} onChange={(e) => set({ params: { ...form.params, [field.key]: e.target.value } })} inputProps={{ inputMode: field.decimal ? 'decimal' : 'numeric' }} InputLabelProps={{ shrink: true }} placeholder="The feature's own" sx={{ width: 240 }} />
              ))}
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h3">Tools</Typography>
            <Stack direction="row" spacing={2} mt={1}>
              <TextField size="small" label="Only these tools (names, comma separated)" InputLabelProps={{ shrink: true }} value={form.allow} onChange={(e) => set({ allow: e.target.value })} sx={{ flex: 1 }} helperText="Empty: every tool the feature uses. A call to another tool is refused." />
              <TextField select size="small" label="Tool use" value={form.mode} onChange={(e) => set({ mode: e.target.value })} sx={{ width: 220 }}>
                <MenuItem value="">The feature&apos;s own</MenuItem>
                <MenuItem value="forced">Always call a tool</MenuItem>
                <MenuItem value="auto">The model chooses</MenuItem>
                {!needsTools && <MenuItem value="none">No tools</MenuItem>}
              </TextField>
            </Stack>
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h3">Limits</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>These can only lower the built-in limits.</Typography>
            <Stack direction="row" spacing={2}>
              <TextField size="small" label="Most per request ($)" value={form.ceiling} onChange={(e) => set({ ceiling: e.target.value })} inputProps={{ inputMode: 'decimal' }} InputLabelProps={{ shrink: true }} helperText={surface.ceiling ? `Built in: $${(surface.ceiling / 1e6).toFixed(2)}` : undefined} />
              <TextField size="small" label="Estimate before a request ($)" value={form.estimate} onChange={(e) => set({ estimate: e.target.value })} inputProps={{ inputMode: 'decimal' }} InputLabelProps={{ shrink: true }} helperText={surface.estimate ? `Built in: $${(surface.estimate / 1e6).toFixed(4)}` : undefined} />
            </Stack>
          </Box>
          {error && <Alert severity="warning">{error}</Alert>}
          {entry?.versions?.length > 0 && (
            <>
              <Divider />
              <Box>
                <Typography variant="subtitle2" component="h3" mb={1}>Versions</Typography>
                <Stack spacing={0.5} data-testid="binding-versions">
                  {entry.versions.map((v) => (
                    <Stack key={v.version} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ minWidth: 90 }}>Version {v.version}</Typography>
                      <Typography variant="body2" sx={{ minWidth: 90 }} color={v.status === 'published' ? 'success.main' : 'text.secondary'}>{{ published: 'In use', draft: 'Draft', superseded: 'Earlier' }[v.status] || v.status}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                        {chainText(v.doc?.chain, models) || 'No model chain of its own'}{v.doc?.enabled === false ? ' · off' : ''}{v.note ? ` · ${v.note}` : ''}{v.origin === 'ai-proposal' ? ' · suggested by an agent' : ''} · {when(v.createdAt)}
                      </Typography>
                      {v.status === 'draft' && <Button size="small" onClick={() => askPublishVersion(v)}>Publish</Button>}
                      {v.status === 'superseded' && <Button size="small" onClick={() => askRollback(v)}>Roll back to this</Button>}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button disabled={busy} onClick={saveDraft}>Save draft</Button>
        <Button variant="contained" disabled={busy} onClick={askPublish}>Publish…</Button>
      </DialogActions>
      <ReasonDialog
        open={Boolean(confirming)}
        title={confirming?.title}
        body={confirming?.body}
        action={confirming?.action}
        onClose={() => setConfirming(null)}
        onConfirm={async (reason) => {
          await confirming.run(reason)
          setConfirming(null)
        }}
      />
    </Dialog>
  )
}

export { ReasonDialog }
