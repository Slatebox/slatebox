// Team settings › Sign-in & security › SCIM: a team admin connects the company's identity provider
// (Okta, Microsoft Entra ID, or any SCIM 2.0 client) to /scim/v2, which adds people to the team,
// changes them and turns them off (server/scim). The admin makes the token here (shown once),
// chooses which group gives which role, and who receives the slates of someone turned off.
// What the card shows comes from scim-card-model.mjs.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { MONO } from '../../../common/AccountLayout'
import { ROLE_CHOICES, scimCardState } from './scim-card-model.mjs'
import BusinessGateNotice, { useBusinessAccess } from './BusinessGate'
import { businessGate } from './business-gate-model.mjs'

const reasonOf = (failure) => failure?.reason || failure?.message || 'Something went wrong. Try again.'

function Copyable({ label, value, testId }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box component="code" data-testid={testId}
          sx={{ fontFamily: MONO, fontSize: 13, px: 1, py: 0.75, borderRadius: '8px', bgcolor: 'action.hover', flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {value}
        </Box>
        <Button size="small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </Box>
    </Box>
  )
}
Copyable.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired, testId: PropTypes.string }
Copyable.defaultProps = { testId: undefined }

function Row({ children }) {
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>{children}</Box>
}
Row.propTypes = { children: PropTypes.node.isRequired }

export default function ScimCard({ noun }) {
  const [settings, setSettings] = React.useState(null)
  const [loadError, setLoadError] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [made, setMade] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const access = useBusinessAccess()

  const load = React.useCallback(() => {
    Meteor.callAsync('teamScim.get', {})
      .then((answer) => { setSettings(answer); setLoadError(null) })
      .catch((failure) => setLoadError(reasonOf(failure)))
  }, [])
  React.useEffect(() => { load() }, [load])

  const run = async (name, input, after) => {
    setBusy(true)
    setError(null)
    try {
      const answer = await Meteor.callAsync(name, input)
      if (after) after(answer)
      load()
    } catch (failure) {
      setError(reasonOf(failure))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Alert severity="error">{loadError}</Alert>
  const view = scimCardState(settings)
  if (view.state === 'loading') return <Typography variant="body2" color="text.secondary">Loading SCIM…</Typography>

  return (
    <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }} data-testid="scim-card">
      <Typography variant="body2">
        Your identity provider (Okta, Microsoft Entra ID or any SCIM 2.0 client) adds people to the {noun}, keeps their
        names and roles up to date and turns them off when they leave. The people it adds sign in with single sign-on.
      </Typography>
      {view.state === 'off' && (
        <BusinessGateNotice gate={businessGate({ feature: 'scim', available: false, kept: view.tokens.length > 0, noun, ...access })} />
      )}
      {view.state === 'needs-sso' && (
        <Alert severity="info" data-testid="scim-needs-sso">
          Connect single sign-on first. SCIM adds people at your verified domains, and they sign in through an enabled
          connection.
        </Alert>
      )}
      {view.domainsLine && <Typography variant="body2" color="text.secondary" data-testid="scim-domains">{view.domainsLine}</Typography>}
      <Copyable label="SCIM base URL (also called the tenant URL)" value={settings.baseUrl} testId="scim-base-url" />

      <Box>
        <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700 }}>Tokens</Typography>
        {view.tokens.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No token yet.</Typography>}
        {view.tokens.map((token) => (
          <Row key={token.tokenId}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 650 }}>{token.name}</Typography>
              <Typography variant="body2" color="text.secondary"><Box component="span" sx={{ fontFamily: MONO }}>{token.shown}</Box> · {token.detail}</Typography>
            </Box>
            <Button size="small" color="error" disabled={busy} data-testid="scim-revoke"
              onClick={() => run('teamScim.revokeToken', { tokenId: token.tokenId }, () => setMade((m) => (m?.tokenId === token.tokenId ? null : m)))}>
              Revoke
            </Button>
          </Row>
        ))}
        {made && (
          <Alert severity="success" sx={{ mt: 1, '& .MuiAlert-message': { minWidth: 0, width: '100%' } }} data-testid="scim-token-made">
            <Typography variant="body2" sx={{ mb: 1 }}>Copy the token now and paste it into your identity provider. Slatebox shows it only once.</Typography>
            <Copyable label="Token" value={made.token} testId="scim-token" />
          </Alert>
        )}
        {view.state === 'ready' && (
          <Box sx={{ pt: 1, display: 'grid', gap: 0.5 }}>
            <Box>
              <Button variant="contained" disableElevation disabled={!view.canCreate || busy} data-testid="scim-create"
                onClick={() => run('teamScim.createToken', { name: 'SCIM' }, (answer) => setMade(answer))}>
                Create token
              </Button>
            </Box>
            {view.limitLine && <Typography variant="body2" color="text.secondary">{view.limitLine}</Typography>}
          </Box>
        )}
      </Box>

      {view.state !== 'off' && (
        <Box>
          <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700 }}>Groups and roles</Typography>
          {settings.groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              Groups appear here once your identity provider sends them. Then choose which group makes people admins.
            </Typography>
          ) : settings.groups.map((group) => (
            <Row key={group.groupId}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 650 }}>{group.displayName}</Typography>
                <Typography variant="body2" color="text.secondary">{group.members} {group.members === 1 ? 'person' : 'people'}</Typography>
              </Box>
              <TextField select size="small" label="Role" value={group.role || ''} disabled={busy} sx={{ minWidth: 170 }}
                SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': `scim-role-${group.groupId}` }}
                onChange={(event) => run('teamScim.mapGroup', { groupId: group.groupId, role: event.target.value || null })}>
                {ROLE_CHOICES.map((choice) => <MenuItem key={choice.value} value={choice.value}>{choice.label}</MenuItem>)}
              </TextField>
            </Row>
          ))}
          <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5 }}>
            Someone in an admin group is an admin; admin wins over member. The {noun} owner never changes.
          </Typography>
        </Box>
      )}

      {view.state !== 'off' && (
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700 }}>When someone leaves</Typography>
          <Typography variant="body2">
            When your identity provider turns someone off, they are signed out everywhere and their API tokens stop
            working. Their {noun} slates move, with their sharing and comments, to the person below. Their personal
            slates stay on their account. If they are turned on again, they can sign in again, but slates do not move back.
          </Typography>
          {settings.recipients.length > 0 && (
            <TextField select size="small" label="Their slates go to" value={settings.recipient?.userId || ''} disabled={busy}
              sx={{ maxWidth: 420 }} inputProps={{ 'data-testid': 'scim-recipient' }}
              onChange={(event) => run('teamScim.setRecipient', { recipientId: event.target.value })}>
              {settings.recipients.map((person) => (
                <MenuItem key={person.userId} value={person.userId}>
                  {person.name}{person.owner ? ' (owner)' : ''}{person.email && person.email !== person.name ? ` · ${person.email}` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      )}
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  )
}
ScimCard.propTypes = { noun: PropTypes.string }
ScimCard.defaultProps = { noun: 'team' }
