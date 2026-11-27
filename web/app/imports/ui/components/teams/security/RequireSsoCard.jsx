// A connection's policy: require single sign-on for its verified domains (the owner, and up to two
// named admins, keep a password sign-in for when the identity provider is down), who joins at first
// sign-in, how long a session lasts, and signing out at the identity provider too.
import React from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { SESSION_CHOICES, requireBlocker } from './security-model.mjs'

export default function RequireSsoCard({ connection, admins, canChange, act, noun }) {
  const policy = connection.policy
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const set = async (change) => {
    setBusy(true)
    setError('')
    try {
      await act('teamSso.setPolicy', { connectionId: connection.id, ...change })
    } catch (err) {
      setError(err?.reason || err?.message || 'The policy was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const blocker = requireBlocker(connection)
  const others = admins.filter((a) => !a.owner)
  const owner = admins.find((a) => a.owner)
  const toggleBreakGlass = (id) => {
    const next = policy.breakGlass.includes(id) ? policy.breakGlass.filter((x) => x !== id) : [...policy.breakGlass, id]
    set({ breakGlass: next })
  }
  const disabled = !canChange || busy
  return (
    <Box data-testid="sso-policy" sx={{ display: 'grid', gap: 1.25 }}>
      <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700 }}>Policy</Typography>
      <FormControlLabel
        control={<Switch checked={policy.requireSso} disabled={disabled || (!policy.requireSso && Boolean(blocker))}
          onChange={(e) => set({ requireSso: e.target.checked })} inputProps={{ 'data-testid': 'sso-require' }} />}
        label={<Box><Typography variant="body2" sx={{ fontWeight: 650 }}>Require single sign-on</Typography>
          <Typography variant="body2" color="text.secondary">
            {`Members with an address at a verified domain sign in only with this connection: no password, passkey, sign-in link or password reset. Turning it on signs them out once. Members with other addresses and slate guests are not affected.`}
          </Typography></Box>}
        sx={{ alignItems: 'flex-start', m: 0, gap: 1 }} />
      {!policy.requireSso && blocker && <Typography variant="body2" color="text.secondary">{blocker}</Typography>}
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 650 }}>Who keeps a password sign-in</Typography>
        <Typography variant="body2" color="text.secondary">
          {`The ${noun} owner${owner ? ` (${owner.name || owner.email})` : ''} always does, so the ${noun} is never locked out when the identity provider is down. You may name up to two admins more. Each such sign-in is emailed to the other admins.`}
        </Typography>
        {others.length === 0 && <Typography variant="body2" color="text.secondary">{`No other admins in the ${noun} yet.`}</Typography>}
        {others.map((a) => (
          <FormControlLabel key={a.id} sx={{ m: 0 }}
            control={<Checkbox size="small" checked={policy.breakGlass.includes(a.id)} disabled={disabled || (!policy.breakGlass.includes(a.id) && policy.breakGlass.length >= 2)}
              onChange={() => toggleBreakGlass(a.id)} />}
            label={<Typography variant="body2">{a.name ? `${a.name} (${a.email})` : a.email}</Typography>} />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <TextField select size="small" label="Who joins at first sign-in" value={policy.joinRule} disabled={disabled}
          onChange={(e) => set({ joinRule: e.target.value })}
          helperText={policy.joinRule === 'member' ? `Anyone at a verified domain becomes a Member of the ${noun}.` : `Only people invited to the ${noun} get in.`}>
          <MenuItem value="member">Anyone at a verified domain</MenuItem>
          <MenuItem value="invited-only">Invited people only</MenuItem>
        </TextField>
        <TextField select size="small" label="Sessions last" value={policy.sessionHours} disabled={disabled}
          onChange={(e) => set({ sessionHours: Number(e.target.value) })} helperText="Then people sign in with single sign-on again.">
          {SESSION_CHOICES.map((c) => <MenuItem key={c.hours} value={c.hours}>{c.label}</MenuItem>)}
        </TextField>
      </Box>
      {connection.protocol === 'oidc' && (
        <FormControlLabel sx={{ m: 0 }}
          control={<Switch checked={policy.signOutOfIdp} disabled={disabled} onChange={(e) => set({ signOutOfIdp: e.target.checked })} />}
          label={<Typography variant="body2">Signing out of Slatebox also signs out at the identity provider</Typography>} />
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  )
}
RequireSsoCard.propTypes = {
  connection: PropTypes.shape({ id: PropTypes.string, protocol: PropTypes.string, policy: PropTypes.shape({}) }).isRequired,
  admins: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string })).isRequired,
  canChange: PropTypes.bool.isRequired,
  act: PropTypes.func.isRequired,
  noun: PropTypes.string.isRequired,
}
