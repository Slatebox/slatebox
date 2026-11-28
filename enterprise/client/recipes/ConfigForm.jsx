// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The settings form a recipe's configSchema makes (recipesModel.mjs configFields): text, numbers,
// yes/no, choices, and the pickers: the GitHub repos the Slatebox app is installed on, the Slack
// channels the person is in (recipes.pickerOptions), Google files (the Google Picker) and schedules
// (presets, or a custom five-part schedule).
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Autocomplete from '@mui/material/Autocomplete'
import Typography from '@mui/material/Typography'
import { googleStatus } from '../GoogleIntegration'
import { pickFiles, preloadGoogle } from '../google'
import { CRON_PRESETS, configFields, validateCron } from './recipesModel.mjs'

function usePickerOptions(recipeId, picker) {
  const [options, setOptions] = useState(null)
  useEffect(() => {
    if (!['repos', 'channels'].includes(picker)) return undefined
    let live = true
    Meteor.callAsync('recipes.pickerOptions', { recipeId, picker })
      .then((a) => { if (live) setOptions(Array.isArray(a?.options) ? a.options : []) }, () => { if (live) setOptions([]) })
    return () => { live = false }
  }, [recipeId, picker])
  return options
}

function PickerField({ field, recipeId, value, onChange, error }) {
  const options = usePickerOptions(recipeId, field.kind)
  const byValue = new Map((options || []).map((o) => [o.value, o]))
  const picked = (Array.isArray(value) ? value : value ? [value] : []).map((v) => byValue.get(v) || { value: v, label: v })
  return (
    <Autocomplete multiple={field.multiple} options={options || []} loading={options === null} value={field.multiple ? picked : picked[0] || null}
      getOptionLabel={(o) => o.label || o.value} isOptionEqualToValue={(a, b) => a.value === b.value}
      onChange={(e, next) => onChange(field.multiple ? next.map((o) => o.value) : next?.value ?? null)}
      renderInput={(params) => <TextField {...params} label={field.label} required={field.required} error={Boolean(error)}
        helperText={error || field.help || (options?.length === 0 ? (field.kind === 'repos' ? 'No repos yet: add some to the Slatebox app on GitHub.' : 'No channels yet: invite Slatebox to a channel first.') : '')} />} />
  )
}

function FilesField({ field, value, onChange, error }) {
  const [note, setNote] = useState('')
  useEffect(() => { preloadGoogle({ picker: true }) }, [])
  const files = Array.isArray(value) ? value : []
  async function choose() {
    setNote('')
    try {
      const status = await googleStatus()
      if (!status?.clientId) { setNote('Google is not set up on this server yet.'); return }
      const got = await pickFiles({ clientId: status.clientId, apiKey: status.apiKey, appId: status.appId, account: status.account || null, multiple: field.multiple })
      if (got.length) onChange(field.multiple ? [...files.filter((f) => !got.some((g) => g.id === f.id)), ...got] : [got[0]])
    } catch (e) { setNote(e?.message || 'Google did not open. Try again.') }
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Typography variant="body2" fontWeight={650}>{field.label}{field.required ? ' *' : ''}</Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {files.map((f) => <Chip key={f.id} label={f.name || f.id} onDelete={() => onChange(files.filter((x) => x.id !== f.id))} />)}
        <Button variant="outlined" size="small" onClick={choose}>{files.length ? 'Choose more' : 'Choose from Google Drive'}</Button>
      </Box>
      {(error || note || field.help) && <Typography variant="caption" color={error || note ? 'error' : 'text.secondary'}>{error || note || field.help}</Typography>}
    </Box>
  )
}

function CronField({ field, value, onChange, error }) {
  const preset = CRON_PRESETS.find((p) => p.cron === value)
  const [custom, setCustom] = useState(!preset && Boolean(value))
  const check = custom ? validateCron(value) : { ok: true }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <TextField select label={field.label} value={custom ? 'custom' : preset?.id || ''} required={field.required}
        onChange={(e) => {
          if (e.target.value === 'custom') { setCustom(true); return }
          setCustom(false)
          onChange(CRON_PRESETS.find((p) => p.id === e.target.value)?.cron ?? null)
        }} error={Boolean(error)} helperText={!custom ? (error || field.help) : undefined}>
        {CRON_PRESETS.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
        <MenuItem value="custom">Custom schedule…</MenuItem>
      </TextField>
      {custom && (
        <TextField label="Schedule (minute hour day month weekday)" value={value || ''} onChange={(e) => onChange(e.target.value)}
          error={!check.ok || Boolean(error)} helperText={check.error || error || 'For example 0 18 * * 1-5 is every weekday at 18:00, in your time zone.'}
          slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'monospace' } } }} />
      )}
    </Box>
  )
}

export default function ConfigForm({ schema, recipeId, value, onChange, errors = {} }) {
  const fields = configFields(schema)
  const set = (key, v) => onChange({ ...value, [key]: v })
  if (!fields.length) return <Typography color="text.secondary">This recipe has no settings.</Typography>
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-recipe-config="">
      {fields.map((f) => {
        const v = value?.[f.key]
        const error = errors[f.key]
        if (f.kind === 'repos' || f.kind === 'channels') return <PickerField key={f.key} field={f} recipeId={recipeId} value={v} onChange={(x) => set(f.key, x)} error={error} />
        if (f.kind === 'files') return <FilesField key={f.key} field={f} value={v} onChange={(x) => set(f.key, x)} error={error} />
        if (f.kind === 'cron') return <CronField key={f.key} field={f} value={v} onChange={(x) => set(f.key, x)} error={error} />
        if (f.kind === 'boolean') {
          return (
            <Box key={f.key}>
              <FormControlLabel control={<Switch checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />} label={f.label} />
              {f.help && <Typography variant="caption" color="text.secondary" component="div">{f.help}</Typography>}
            </Box>
          )
        }
        if (f.kind === 'select' || f.kind === 'multiselect') {
          return (
            <TextField key={f.key} select label={f.label} required={f.required} value={f.multiple ? (v || []) : (v ?? '')}
              slotProps={{ select: { multiple: f.multiple } }} error={Boolean(error)} helperText={error || f.help}
              onChange={(e) => set(f.key, e.target.value)}>
              {f.options.map((o) => <MenuItem key={o} value={o}>{f.optionLabels?.[o] || o}</MenuItem>)}
            </TextField>
          )
        }
        if (f.kind === 'list' || f.kind === 'paths') {
          return (
            <Autocomplete key={f.key} multiple freeSolo options={[]} value={Array.isArray(v) ? v : []} onChange={(e, next) => set(f.key, next.map(String))}
              renderInput={(params) => <TextField {...params} label={f.label} required={f.required} error={Boolean(error)}
                helperText={error || f.help || 'Type one and press Enter.'} />} />
          )
        }
        if (f.kind === 'number') {
          return (
            <TextField key={f.key} type="number" label={f.label} required={f.required} value={v ?? ''} error={Boolean(error)} helperText={error || f.help}
              slotProps={{ htmlInput: { min: f.min ?? undefined, max: f.max ?? undefined } }}
              onChange={(e) => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))} />
          )
        }
        return (
          <TextField key={f.key} label={f.label} required={f.required} value={v ?? ''} error={Boolean(error)} helperText={error || f.help}
            multiline={(f.max ?? 0) > 200} slotProps={{ htmlInput: { maxLength: f.max ?? undefined } }}
            onChange={(e) => set(f.key, e.target.value)} />
        )
      })}
    </Box>
  )
}

ConfigForm.propTypes = {
  schema: PropTypes.object,
  recipeId: PropTypes.string.isRequired,
  value: PropTypes.object,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object,
}
