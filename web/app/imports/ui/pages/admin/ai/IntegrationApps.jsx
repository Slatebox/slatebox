import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Link from '@mui/material/Link'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { ReasonDialog } from './ReasonDialog'

// Admin › AI control › Integration apps: the OAuth app this server signs people in to outside tools
// with, for each vendor that offers no automatic registration (Slack, Asana, HubSpot, ...). An
// administrator pastes the client id and the client secret here instead of editing the settings
// file. The secret field is always empty: the secret is stored encrypted on the server and never
// sent back, only which secret it is (a fingerprint). What is entered here wins over the settings
// file at once, with no restart; clearing it goes back to the settings file. Google's apps stay in
// the settings file. Only a person saves (connectors.apps.list, .set, .clear).
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback
const SOURCE = { admin: 'Set here', settings: 'From the settings file', none: 'Not set up' }

function secretTextOf(app) {
  if (app.secretUnreadable) return 'The saved secret was stored under another SLATEBOX_KEY_ENCRYPTION_KEY and cannot be read. Enter it again.'
  if (!app.hasSecret) return 'No secret set.'
  return `Secret set (${app.secretSource === 'admin' ? 'here' : 'settings file'}): ${app.secretFingerprint}`
}

function clientIdHint(app) {
  if (app.source === 'settings') return 'From the settings file. Save to use it from here.'
  if (app.settingsClientId && app.settingsClientId !== app.clientId) return 'The settings file has another client id; this one wins.'
  return ' '
}

function AppRow({ app, secretsAvailable, onChanged }) {
  const [clientId, setClientId] = useState(app.clientId || '')
  const [secret, setSecret] = useState('')
  const [problem, setProblem] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)
  useEffect(() => { setClientId(app.clientId || '') }, [app.clientId])
  const run = async (fn, done) => {
    setBusy(true)
    setProblem('')
    setNote('')
    try {
      await fn()
      setSecret('')
      setNote(done)
      await onChanged()
    } catch (err) {
      setProblem(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  const save = () => {
    const input = { provider: app.provider }
    if (clientId.trim() && (clientId.trim() !== app.clientId || app.source !== 'admin')) input.clientId = clientId.trim()
    if (secret.trim()) input.clientSecret = secret.trim()
    if (!input.clientId && !input.clientSecret) return setProblem('Nothing changed.')
    return run(() => Meteor.callAsync('connectors.apps.set', input), `Saved. ${app.name} sign-ins use it now.`)
  }
  const clear = async (reason) => {
    await Meteor.callAsync('connectors.apps.clear', { provider: app.provider, ...(reason && { reason }) })
    setClearing(false)
    setSecret('')
    setNote('Cleared.')
    await onChanged()
  }
  const secretText = secretTextOf(app)
  return (
    <Box data-integration-app={app.provider} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flex: '1 1 160px' }}>{app.name}</Typography>
        <Chip size="small" variant={app.source === 'none' ? 'outlined' : 'filled'} color={app.source === 'admin' ? 'primary' : 'default'} label={SOURCE[app.source] || app.source} data-integration-app-source={app.source} />
        {app.console && <Link href={app.console.url} target="_blank" rel="noopener noreferrer" variant="body2">{app.console.label}</Link>}
      </Box>
      {!app.editable ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {app.provider === 'google'
            ? 'Google\'s apps are set in the settings file: connectors.oauthApps.google for Gmail, Calendar, Docs, Sheets and Chat, and googleDocs.web for Google Drive.'
            : 'This app is set in the settings file.'}
          {app.clientId ? <> Client id in use: <Box component="span" sx={mono}>{app.clientId}</Box>.</> : ''}
        </Typography>
      ) : (
        <Box sx={{ mt: 1.5, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <TextField size="small" label="Client id" value={clientId} onChange={(e) => setClientId(e.target.value)}
            inputProps={{ spellCheck: false, autoComplete: 'off', 'data-integration-app-client-id': app.provider }}
            helperText={clientIdHint(app)} />
          <TextField size="small" type="password" label={app.hasSecret ? 'New client secret' : 'Client secret'} value={secret} onChange={(e) => setSecret(e.target.value)}
            disabled={!secretsAvailable}
            inputProps={{ spellCheck: false, autoComplete: 'new-password', 'data-integration-app-secret': app.provider }}
            helperText={secretsAvailable ? secretText : 'Set SLATEBOX_KEY_ENCRYPTION_KEY on this server to store client secrets.'} />
        </Box>
      )}
      {app.updatedAt && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>Changed here {new Date(app.updatedAt).toLocaleString()}</Typography>}
      {problem && <Alert severity="warning" sx={{ mt: 1 }}>{problem}</Alert>}
      {note && <Alert severity="success" sx={{ mt: 1 }}>{note}</Alert>}
      {app.editable && (
        <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
          <Button variant="contained" size="small" disabled={busy} onClick={save}>Save</Button>
          {app.adminSaved && <Button size="small" color="error" disabled={busy} onClick={() => setClearing(true)}>Clear</Button>}
        </Box>
      )}
      <ReasonDialog open={clearing} optional danger title={`Clear the ${app.name} app?`}
        body={`The client id and secret entered here are forgotten. ${app.settingsClientId ? 'The app in the settings file is used again.' : `${app.name} is then not set up on this server, and people cannot sign in to it.`}`}
        action="Clear" onClose={() => setClearing(false)} onConfirm={clear} />
    </Box>
  )
}

export default function IntegrationApps() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const load = async () => {
    try {
      setData(await Meteor.callAsync('connectors.apps.list', {}))
      setError('')
    } catch (err) {
      setError(err?.error === 404 || /not found|no such action/i.test(err?.reason || err?.message || '')
        ? 'This build of Slatebox carries no integrations code, so there are no integration apps here.'
        : failure(err, 'The integration apps could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.redirectUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  if (error) return <Alert severity="info">{error}</Alert>
  if (!data) return <Typography variant="body2">Reading the integration apps…</Typography>
  return (
    <Box data-integration-apps="">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        These tools have no automatic sign-up, so people sign in to them through one app you register with each vendor.
        Register the app in the vendor&apos;s console, give it the redirect URL below, then paste its client id and client secret here.
        The secret is stored encrypted and never shown again; what you enter here is used right away and wins over the settings file.
        Each tool&apos;s card shows in the agent gallery once its app has a client id.
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Typography variant="body2">Redirect URL:</Typography>
        <Box component="code" sx={mono} data-integration-apps-redirect="">{data.redirectUrl}</Box>
        <Button size="small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </Box>
      {!data.secretsAvailable && <Alert severity="warning" sx={{ mb: 2 }}>SLATEBOX_KEY_ENCRYPTION_KEY is not set on this server, so client secrets cannot be stored and tools that need sign-in are not offered.</Alert>}
      {data.apps.map((app) => <AppRow key={app.provider} app={app} secretsAvailable={data.secretsAvailable} onChanged={load} />)}
    </Box>
  )
}
