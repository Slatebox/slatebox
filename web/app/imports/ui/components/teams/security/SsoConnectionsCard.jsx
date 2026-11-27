// A team's single sign-on connections: add one (pick the identity provider, see what to paste into
// its console, fill in what it gives back), turn it on or off, test it in a popup, change or remove
// it. Each connection shows its domains (DomainsCard) and its policy (RequireSsoCard).
import React from 'react'
import PropTypes from 'prop-types'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { PRESET_CHOICES, PRESET_FIELDS, copyRows, redirectUriFor } from './security-model.mjs'
import CopyValue from './CopyValue'
import DomainsCard from './DomainsCard'
import RequireSsoCard from './RequireSsoCard'

const card = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0, display: 'grid', gap: 2,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})

function ConnectionDialog({ open, onClose, editing, origin, act }) {
  const [preset, setPreset] = React.useState(editing?.preset || 'okta')
  const [values, setValues] = React.useState({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    if (!open) return
    setPreset(editing?.preset || 'okta')
    setError('')
    setValues(editing ? {
      label: editing.label,
      issuer: editing.oidc?.issuer, tenantId: editing.oidc?.tenantId, clientId: editing.oidc?.clientId,
      idpEntityId: editing.saml?.idpEntityId, ssoUrl: editing.saml?.ssoUrl, emailAttribute: editing.saml?.emailAttribute,
    } : {})
  }, [open, editing])
  const fields = PRESET_FIELDS[preset]
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const input = { preset, ...(editing && { id: editing.id }) }
    for (const name of ['label', ...fields.map((f) => f.name)]) {
      const value = (values[name] ?? '').trim()
      if (value) input[name] = value
    }
    try {
      await act('teamSso.saveConnection', input)
      onClose()
    } catch (err) {
      setError(err?.reason || err?.message || 'The connection was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const choice = PRESET_CHOICES.find((p) => p.id === preset)
  const presetName = choice?.name
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="sso-connection-title"
      PaperProps={{ component: 'form', onSubmit: save, noValidate: true, 'data-testid': 'sso-connection-dialog' }}>
      <DialogTitle id="sso-connection-title">{editing ? `Change ${editing.label}` : 'Connect your identity provider'}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2 }}>
        {!editing && (
          <ToggleButtonGroup exclusive size="small" value={preset} onChange={(_e, next) => next && setPreset(next)} aria-label="Identity provider"
            sx={{ flexWrap: 'wrap', gap: 0.5, '& .MuiToggleButton-root': { textTransform: 'none', borderRadius: '8px !important', border: '1px solid', borderColor: 'divider' } }}>
            {PRESET_CHOICES.map((p) => <ToggleButton key={p.id} value={p.id} data-preset={p.id}>{p.name}</ToggleButton>)}
          </ToggleButtonGroup>
        )}
        {preset !== 'saml' ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="body2">
              {`In ${presetName}, create a web application (OpenID Connect) for Slatebox`}
              {choice?.console ? <> (<Link href={choice.console} target="_blank" rel="noopener noreferrer">open the console</Link>)</> : null}
              {' and set its redirect URI to:'}
            </Typography>
            <CopyValue label="Redirect URI" value={redirectUriFor(origin)} />
            {preset === 'entra' && (
              <Typography variant="body2" color="text.secondary">
                Under Token configuration, add the optional claims email and xms_edov to the ID token. Without xms_edov, people sign in with their user principal name, which must be at a verified domain.
              </Typography>
            )}
          </Box>
        ) : (
          <Typography variant="body2">
            Create a SAML app for Slatebox in your identity provider. Save this connection first: Slatebox then shows the ACS URL, entity ID and metadata to give it.
          </Typography>
        )}
        <TextField size="small" label="Name on the sign-in button" placeholder={presetName} value={values.label ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, label: e.target.value }))} />
        {fields.map((f) => (
          <TextField key={f.name} size="small" label={f.label} placeholder={f.placeholder} value={values[f.name] ?? ''}
            type={f.secret ? 'password' : 'text'} autoComplete="off" multiline={Boolean(f.multiline)} minRows={f.multiline ? 4 : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            helperText={f.secret && editing?.oidc?.secretSaved ? `A secret is saved (fingerprint ${editing.oidc.secretFingerprint}). Leave empty to keep it.` : f.help}
            inputProps={{ 'data-field': f.name, spellCheck: false }} />
        ))}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" disableElevation disabled={busy}>{busy ? 'Checking…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  )
}
ConnectionDialog.propTypes = {
  open: PropTypes.bool.isRequired, onClose: PropTypes.func.isRequired, editing: PropTypes.shape({}), origin: PropTypes.string.isRequired,
  act: PropTypes.func.isRequired,
}
ConnectionDialog.defaultProps = { editing: null }

function Connection({ connection, view, act, onEdit, noun }) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const canChange = view.canChange && view.available && !connection.managed
  const run = async (method, input) => {
    setBusy(true)
    setError('')
    try { return await act(method, input) } catch (err) {
      setError(err?.reason || err?.message || 'That did not work. Try again.')
      return null
    } finally { setBusy(false) }
  }
  const test = async () => {
    // the popup opens at once (a click's own window), then goes to the test sign-in
    const popup = window.open('about:blank', 'slatebox-sso-test', 'width=520,height=680')
    const out = await run('teamSso.tryConnection', { connectionId: connection.id })
    if (out?.url && popup) popup.location.href = out.url
    else popup?.close()
  }
  const remove = async () => {
    if (window.confirm(`Remove ${connection.label}? Its domains are released and the sessions it made end. People it signed in keep their accounts and slates, and sign in with a password reset or a sign-in link to their address.`)) {
      await run('teamSso.removeConnection', { connectionId: connection.id })
    }
  }
  return (
    <Box component="section" sx={card} data-testid="sso-connection" data-connection={connection.id} data-preset={connection.preset}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ mr: 'auto', minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{connection.label}</Typography>
          <Typography variant="body2" color="text.secondary">
            {connection.managed ? 'The server\'s own sign-in (Keycloak), set by its administrator.' : `${connection.presetName}${connection.oidc ? ` · ${connection.oidc.issuer}` : ''}`}
          </Typography>
        </Box>
        {connection.managed ? <Chip size="small" label="Set by the server" /> : (
          <>
            <Switch checked={connection.enabled} disabled={!canChange || busy} inputProps={{ 'aria-label': connection.enabled ? 'Turn off' : 'Turn on' }}
              onChange={(e) => run('teamSso.saveConnection', { id: connection.id, enabled: e.target.checked })} />
            <Typography variant="body2" color="text.secondary">{connection.enabled ? 'On' : 'Off'}</Typography>
          </>
        )}
      </Box>
      {!connection.managed && (
        <>
          <Box sx={{ display: 'grid', gap: 0.75 }}>
            <Typography variant="body2" color="text.secondary">Give your identity provider:</Typography>
            {copyRows(connection).map((row) => <CopyValue key={row.label} label={row.label} value={row.value} />)}
          </Box>
          {canChange && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" onClick={test} disabled={busy || !connection.enabled}>Test sign-in</Button>
              <Button size="small" onClick={() => onEdit(connection)} disabled={busy}>Change</Button>
              <Button size="small" color="error" onClick={remove} disabled={busy}>Remove</Button>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Divider />
          <DomainsCard connection={connection} canChange={canChange} serverAdmin={view.serverAdmin} act={act} />
          <Divider />
          <RequireSsoCard connection={connection} admins={view.admins} canChange={canChange} act={act} noun={noun} />
        </>
      )}
    </Box>
  )
}
Connection.propTypes = {
  connection: PropTypes.shape({ id: PropTypes.string, label: PropTypes.string, managed: PropTypes.string }).isRequired,
  view: PropTypes.shape({}).isRequired, act: PropTypes.func.isRequired, onEdit: PropTypes.func.isRequired, noun: PropTypes.string.isRequired,
}

export default function SsoConnectionsCard({ view, act, origin, noun }) {
  const [dialog, setDialog] = React.useState({ open: false, editing: null })
  const canAdd = view.canChange && view.available
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-testid="sso-connections">
      {view.connections.length === 0 && (
        <Box sx={card}>
          <Typography variant="body2">
            {`Let ${noun} members sign in with your company's identity provider: Okta, Microsoft Entra ID, Google Workspace, or any OpenID Connect or SAML 2.0 provider. Free for every ${noun}.`}
          </Typography>
          {canAdd && <Box><Button variant="contained" disableElevation onClick={() => setDialog({ open: true, editing: null })} data-testid="sso-add">Connect an identity provider</Button></Box>}
        </Box>
      )}
      {view.connections.map((c) => (
        <Connection key={c.id} connection={c} view={view} act={act} noun={noun} onEdit={(editing) => setDialog({ open: true, editing })} />
      ))}
      {view.connections.length > 0 && canAdd && (
        <Box><Button variant="outlined" onClick={() => setDialog({ open: true, editing: null })} data-testid="sso-add">Add another connection</Button></Box>
      )}
      <ConnectionDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })}
        origin={origin} act={act} />
    </Box>
  )
}
SsoConnectionsCard.propTypes = {
  view: PropTypes.shape({ connections: PropTypes.arrayOf(PropTypes.shape({})), canChange: PropTypes.bool, available: PropTypes.bool }).isRequired,
  act: PropTypes.func.isRequired, origin: PropTypes.string.isRequired, noun: PropTypes.string.isRequired,
}
