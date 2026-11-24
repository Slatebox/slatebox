// The kit's colors: each a swatch with its name, hex and role (primary, accent or neutral), and
// "Pull colors from my logo". Each color is the same organizationSettings item as before ({ name,
// value }), with its role kept beside them; roles are what "Use my colors" reads.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import { ROLES, colorName, normalHex } from './brandKit.mjs'

function ColorRow({ color, onChange, onRemove, disabled }) {
  const [name, setName] = useState(color.name)
  const [hex, setHex] = useState(color.value)
  useEffect(() => { setName(color.name) }, [color.name])
  useEffect(() => { setHex(color.value) }, [color.value])
  const commitName = () => { const n = name.trim(); if (n && n !== color.name) onChange({ name: n }); else setName(color.name) }
  const commitHex = (raw) => { const v = normalHex(raw); if (v && v !== color.value) onChange({ value: v }); else if (!v) setHex(color.value) }
  return (
    <Box data-brand-color={color.value} sx={{ display: 'grid', gridTemplateColumns: { xs: '44px 1fr 34px', sm: '44px minmax(0,1.3fr) 110px 128px 34px' }, gap: 1, alignItems: 'center' }}>
      <Box component="label" sx={{ position: 'relative', width: 44, height: 44, borderRadius: '10px', bgcolor: color.value, border: '1px solid rgba(0,0,0,.15)', cursor: disabled ? 'default' : 'pointer', overflow: 'hidden' }}>
        <input type="color" value={color.value} disabled={disabled} aria-label={`Pick ${color.name}`}
          onChange={(e) => setHex(e.target.value)} onBlur={(e) => commitHex(e.target.value)}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'inherit', border: 0, padding: 0 }} />
      </Box>
      <TextField size="small" value={name} disabled={disabled} inputProps={{ 'aria-label': 'Color name', maxLength: 40 }}
        onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
      <TextField size="small" value={hex} disabled={disabled} error={!normalHex(hex)} inputProps={{ 'aria-label': `${color.name} hex`, spellCheck: false, maxLength: 7 }}
        onChange={(e) => setHex(e.target.value)} onBlur={(e) => commitHex(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
        sx={{ display: { xs: 'none', sm: 'block' }, '& input': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 } }} />
      <TextField select size="small" value={color.role || ''} disabled={disabled} SelectProps={{ displayEmpty: true, inputProps: { 'aria-label': `${color.name} role` } }}
        onChange={(e) => onChange({ role: e.target.value || null })} sx={{ display: { xs: 'none', sm: 'block' } }}>
        <MenuItem value=""><em>No role</em></MenuItem>
        {ROLES.map((r) => <MenuItem key={r.key} value={r.key}>{r.name}</MenuItem>)}
      </TextField>
      <IconButton size="small" aria-label={`Remove ${color.name}`} disabled={disabled} onClick={onRemove}><CloseIcon fontSize="small" /></IconButton>
      {/* On a phone the hex and role sit under the name. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, gap: 1, gridColumn: '2 / 4' }}>
        <TextField size="small" value={hex} disabled={disabled} error={!normalHex(hex)} inputProps={{ 'aria-label': `${color.name} hex (phone)`, spellCheck: false, maxLength: 7 }}
          onChange={(e) => setHex(e.target.value)} onBlur={(e) => commitHex(e.target.value)} sx={{ flex: 1, '& input': { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13 } }} />
        <TextField select size="small" value={color.role || ''} disabled={disabled} SelectProps={{ displayEmpty: true, inputProps: { 'aria-label': `${color.name} role (phone)` } }}
          onChange={(e) => onChange({ role: e.target.value || null })} sx={{ flex: 1 }}>
          <MenuItem value=""><em>No role</em></MenuItem>
          {ROLES.map((r) => <MenuItem key={r.key} value={r.key}>{r.name}</MenuItem>)}
        </TextField>
      </Box>
    </Box>
  )
}
ColorRow.propTypes = {
  color: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, value: PropTypes.string, role: PropTypes.string }).isRequired,
  onChange: PropTypes.func.isRequired, onRemove: PropTypes.func.isRequired, disabled: PropTypes.bool.isRequired,
}

export function Suggestions({ colors, onAdd, onDismiss }) {
  const [picked, setPicked] = useState(() => colors.map(() => true))
  useEffect(() => { setPicked(colors.map(() => true)) }, [colors])
  const count = picked.filter(Boolean).length
  return (
    <Box data-brand-suggestions="" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px', p: 1.5, display: 'grid', gap: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 650 }}>From your logo</Typography>
      {!colors.length && <Typography variant="body2" color="text.secondary">No new colors: the kit already has the ones in your logo.</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {colors.map((c, i) => (
          <Box component="label" key={c.value} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, pr: 1, borderRadius: '999px', border: '1px solid', borderColor: 'divider', cursor: 'pointer' }}>
            <Checkbox size="small" checked={picked[i]} onChange={(e) => setPicked(picked.map((p, j) => (j === i ? e.target.checked : p)))} inputProps={{ 'aria-label': `${c.name} ${c.value}` }} />
            <Box component="span" aria-hidden sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: c.value, border: '1px solid rgba(0,0,0,.18)' }} />
            <Typography variant="body2">{c.name}</Typography>
            {c.role && <Typography variant="caption" color="text.secondary">{ROLES.find((r) => r.key === c.role)?.name}</Typography>}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained" disableElevation disabled={!count} onClick={() => onAdd(colors.filter((_, i) => picked[i]))} data-brand-suggestions-add="">
          {count === 1 ? 'Add 1 color' : `Add ${count} colors`}
        </Button>
        <Button size="small" onClick={onDismiss}>Not now</Button>
      </Box>
    </Box>
  )
}
Suggestions.propTypes = { colors: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, name: PropTypes.string, role: PropTypes.string })).isRequired, onAdd: PropTypes.func.isRequired, onDismiss: PropTypes.func.isRequired }

export default function ColorsSection({ palette, onAdd, onChange, onRemove, disabled, pull }) {
  const add = () => {
    const taken = new Set(palette.map((c) => c.value))
    const value = ['#40709a', '#e07a2f', '#2f8f6b', '#6b5bd2', '#d14b6a', '#1f2a26'].find((v) => !taken.has(v)) || '#808080'
    onAdd({ name: colorName(value), value, role: null })
  }
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      {!palette.length && (
        <Typography variant="body2" color="text.secondary">No colors yet. Add your brand colors, or pull them from your logo.</Typography>
      )}
      {palette.length > 0 && (
        <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: '44px minmax(0,1.3fr) 110px 128px 34px', gap: 1, color: 'text.secondary' }}>
          <span />
          <Typography variant="caption">Name</Typography>
          <Typography variant="caption">Hex</Typography>
          <Typography variant="caption">Role</Typography>
          <span />
        </Box>
      )}
      {palette.map((c) => (
        <ColorRow key={c._id} color={c} disabled={disabled} onChange={(patch) => onChange(c, patch)} onRemove={() => onRemove(c)} />
      ))}
      {pull.suggestions && <Suggestions colors={pull.suggestions} onAdd={pull.onAdd} onDismiss={pull.onDismiss} />}
      {pull.error && <Typography role="alert" variant="body2" color="error">{pull.error}</Typography>}
      {!disabled && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={add} data-brand-add-color="">Add a color</Button>
          {pull.available && (
            <Button size="small" variant="outlined" onClick={pull.onPull} disabled={pull.busy} data-brand-pull="">
              {pull.busy ? 'Reading your logo…' : 'Pull colors from my logo'}
            </Button>
          )}
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">
        Roles: {ROLES.map((r) => `${r.name.toLowerCase()} for ${r.hint.toLowerCase()}`).join('; ')}. One color per role.
      </Typography>
    </Box>
  )
}
ColorsSection.propTypes = {
  palette: PropTypes.arrayOf(PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string, value: PropTypes.string, role: PropTypes.string })).isRequired,
  onAdd: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
  disabled: PropTypes.bool.isRequired,
  pull: PropTypes.shape({
    available: PropTypes.bool, busy: PropTypes.bool, error: PropTypes.string,
    suggestions: PropTypes.array, onPull: PropTypes.func, onAdd: PropTypes.func, onDismiss: PropTypes.func,
  }).isRequired,
}
