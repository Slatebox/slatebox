// A connection's sign-in domains: add one, see the DNS TXT record that proves the team owns it,
// Check it, remove it. On a self-hosted server its administrator may verify one without DNS.
import React from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { domainState } from './security-model.mjs'
import CopyValue from './CopyValue'

export default function DomainsCard({ connection, canChange, serverAdmin, act }) {
  const [domain, setDomain] = React.useState('')
  const [busy, setBusy] = React.useState(null)
  const [note, setNote] = React.useState(null)
  const run = async (key, method, input, done) => {
    setBusy(key)
    setNote(null)
    try {
      const out = await act(method, input)
      done?.(out)
    } catch (err) {
      setNote({ severity: 'error', text: err?.reason || err?.message || 'That did not work. Try again.' })
    } finally {
      setBusy(null)
    }
  }
  const add = (event) => {
    event.preventDefault()
    run('add', 'teamSso.addDomain', { connectionId: connection.id, domain: domain.trim() }, () => setDomain(''))
  }
  const check = (name, withoutDns = false) => run(`check:${name}`, 'teamSso.checkDomain', { connectionId: connection.id, domain: name, ...(withoutDns && { withoutDns }) }, (out) => {
    if (out?.status === 'missing') setNote({ severity: 'warning', text: `The TXT record for ${name} was not found yet. DNS changes can take a few minutes to an hour to show up.` })
    if (out?.status === 'unknown') setNote({ severity: 'warning', text: `DNS for ${name} could not be read just now. Try again in a minute.` })
  })
  return (
    <Box data-testid="sso-domains" sx={{ display: 'grid', gap: 1.25 }}>
      <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700 }}>Domains</Typography>
      <Typography variant="body2" color="text.secondary">
        This connection signs in addresses at the domains your team proves it owns. A domain belongs to one Slatebox team.
      </Typography>
      {connection.domains.map((d) => {
        const state = domainState(d)
        return (
          <Box key={d.domain} data-domain={d.domain} data-domain-state={state.word}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px', p: 1.5, display: 'grid', gap: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body1" sx={{ fontWeight: 650, mr: 'auto' }}>{d.domain}</Typography>
              <Chip size="small" label={state.word} color={state.tone} variant={state.tone === 'success' ? 'filled' : 'outlined'} />
            </Box>
            <Typography variant="body2" color="text.secondary">{state.detail}</Typography>
            {(!d.verified || d.failingSince) && (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                <CopyValue label="Name" value={d.record.name} />
                <CopyValue label="Type" value="TXT" />
                <CopyValue label="Value" value={d.record.value} />
              </Box>
            )}
            {canChange && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" disabled={Boolean(busy)} onClick={() => check(d.domain)}>
                  {busy === `check:${d.domain}` ? 'Checking…' : 'Check'}
                </Button>
                {serverAdmin && !d.verified && (
                  <Button size="small" disabled={Boolean(busy)} onClick={() => check(d.domain, true)}>Verify without DNS</Button>
                )}
                <Button size="small" color="error" disabled={Boolean(busy)} onClick={() => run(`remove:${d.domain}`, 'teamSso.removeDomain', { connectionId: connection.id, domain: d.domain })}>
                  Remove
                </Button>
              </Box>
            )}
          </Box>
        )
      })}
      {canChange && (
        <Box component="form" onSubmit={add} noValidate sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
          <TextField size="small" fullWidth label="Add a domain" placeholder="acme.com" value={domain}
            onChange={(e) => setDomain(e.target.value)} inputProps={{ 'data-testid': 'sso-domain-input', spellCheck: false, autoCapitalize: 'none' }} />
          <Button type="submit" variant="outlined" disabled={busy === 'add' || !domain.trim()} sx={{ flexShrink: 0, minHeight: 40 }}>Add</Button>
        </Box>
      )}
      {note && <Alert severity={note.severity}>{note.text}</Alert>}
    </Box>
  )
}
DomainsCard.propTypes = {
  connection: PropTypes.shape({ id: PropTypes.string, domains: PropTypes.arrayOf(PropTypes.shape({})) }).isRequired,
  canChange: PropTypes.bool.isRequired,
  serverAdmin: PropTypes.bool.isRequired,
  act: PropTypes.func.isRequired,
}
