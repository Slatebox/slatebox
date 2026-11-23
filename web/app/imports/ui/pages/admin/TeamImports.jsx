// Admin tools › Import a team export: an administrator of this server uploads a team's export
// (from Team settings › Export everything, here or on another Slatebox server). It becomes a new
// hidden team; the report says what came across and what did not, and the administrator confirms
// it (the team goes live) or discards it (everything the import wrote is deleted).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AccountActions, AccountNote, AccountPanel, AccountSection, COLUMN_WIDTH, FinePrint, SPACE } from '../../common/AccountLayout'

// The passphrase travels as base64url of its UTF-8 bytes: a header cannot carry text that is not
// ASCII, and a plain header loses white space at its ends (server/team-export/routes.mjs).
const base64url = (text) =>
  btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const SECTION_NAMES = {
  team: 'Team',
  members: 'People',
  files: 'Files',
  slates: 'Slates',
  versions: 'Versions',
  events: 'Event log entries (the log starts again here)',
  comments: 'Comments',
  presentations: 'Presentations',
  presentationChats: 'Presentation conversations',
  links: 'Sharing settings',
  settings: 'Team settings',
  ai: 'AI settings',
  tokens: 'API tokens (to make again)',
}

const signedBy = (source) => {
  if (!source?.signer) return 'Not signed.'
  if (source.signerKnown) return 'Signed by this server.'
  return `Signed by another server (key ${source.signer.slice(0, 12)}…).`
}

function Report({ report }) {
  if (!report) return null
  return (
    <Box data-testid="import-report" sx={{ display: 'grid', gap: SPACE.tight }}>
      <Typography variant="subtitle1">
        {report.team?.name} from {report.source?.instance || 'an unknown server'}
        {report.source?.exportedAt ? `, exported ${report.source.exportedAt}` : ''}
      </Typography>
      <FinePrint>{signedBy(report.source)}</FinePrint>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {Object.entries(report.sections || {}).map(([section, count]) => (
          <li key={section}>
            {SECTION_NAMES[section] || section}: {count.created} made{count.skipped ? `, ${count.skipped} not` : ''}
          </li>
        ))}
        <li>Links rewritten: {report.links?.rewritten ?? 0}</li>
        <li>Board rules switched off: {report.rulesSwitchedOff ?? 0}</li>
      </Box>
      {report.people?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: SPACE.tight }}>People (placeholders until they accept an invitation)</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {report.people.map((person) => (
              <li key={`${person.name}|${person.email}`}>
                {person.name || 'Unnamed'} {person.email ? `<${person.email}>` : ''}
                {person.email && person.emailVerified === false ? ' (address not verified by the source)' : ''} {person.owner ? '(owner)' : ''}{' '}
                {person.roles?.length ? `roles: ${person.roles.join(', ')}` : ''}
              </li>
            ))}
          </Box>
        </>
      )}
      {(report.ai?.imported?.length ?? 0) + (report.ai?.skipped?.length ?? 0) > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: SPACE.tight }}>AI connections (keys are never moved)</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {report.ai.imported.map((c) => (
              <li key={c.name}>{c.name}: imported{c.needsKey ? ', needs its key entered again' : ''}</li>
            ))}
            {report.ai.skipped.map((c) => (
              <li key={c.name}>{c.name}: not imported ({c.reason === 'not_public' ? 'not on a public address' : c.reason})</li>
            ))}
          </Box>
        </>
      )}
      {report.tokens?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: SPACE.tight }}>API tokens to make again</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {report.tokens.map((token) => (
              <li key={`${token.person}|${token.name}|${token.scopes.join(',')}`}>{token.person}: {token.name} ({token.scopes.join(', ')})</li>
            ))}
          </Box>
        </>
      )}
      {report.skipped?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ mt: SPACE.tight }}>Not imported</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {report.skipped.slice(0, 50).map((row) => (
              <li key={`${row.section}|${row.id}|${row.reason}`}>{SECTION_NAMES[row.section] || row.section}: {row.reason}</li>
            ))}
          </Box>
        </>
      )}
    </Box>
  )
}

const OUTCOMES = {
  sent: 'invitation sent',
  needs_consent: 'not invited: an account here already uses this address, so that person has to agree to move',
  mail_disabled: 'not invited: this server cannot send email',
  already_invited: 'already invited',
}

function Invited({ invited, last, busy, onInvite }) {
  return (
    <Box data-testid="import-invited" sx={{ display: 'grid', gap: SPACE.tight }}>
      <Typography variant="subtitle2">Invitations</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        <li>Sent: {invited.sent ?? 0}</li>
        {invited.mailDisabled > 0 && <li>Not sent, this server cannot send email: {invited.mailDisabled}</li>}
        {invited.needsConsent?.length > 0 && <li>Already have an account here (they must agree to move): {invited.needsConsent.join(', ')}</li>}
      </Box>
      {invited.unverified?.length > 0 && (
        <>
          <FinePrint>
            The source had not verified these addresses, so they were not invited. Check each one with the team before
            you invite it: the invitation carries the role the export gave that person.
          </FinePrint>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {invited.unverified.map((email) => (
              <li key={email}>
                {email}{' '}
                <Button size="small" disabled={busy} onClick={() => onInvite(email)} data-testid="import-invite-unverified">
                  I checked it, invite
                </Button>
              </li>
            ))}
          </Box>
        </>
      )}
      {last && (
        <FinePrint data-testid="import-invite-outcome">
          {last.email}: {OUTCOMES[last.outcome] || last.outcome}
        </FinePrint>
      )}
    </Box>
  )
}

export default function TeamImports() {
  const [file, setFile] = React.useState(null)
  const [passphrase, setPassphrase] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [imports, setImports] = React.useState([])
  const [open, setOpen] = React.useState(null) // { importId, report }
  const [invite, setInvite] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      setImports((await Meteor.callAsync('teamImports.list', {})).imports)
    } catch (failure) {
      setError(failure.reason || failure.message)
    }
  }, [])
  React.useEffect(() => {
    refresh()
  }, [refresh])

  const upload = async () => {
    setBusy(true)
    setError(null)
    try {
      const start = await Meteor.callAsync('teamImports.start', {})
      const response = await fetch(new URL(start.uploadUrl).pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', ...(passphrase && { 'slatebox-export-passphrase-base64': base64url(passphrase) }) },
        body: file,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body?.error?.message || 'The import failed.')
      setOpen({ importId: body.importId, report: body.report, state: body.state })
      setFile(null)
      setPassphrase('')
      await refresh()
    } catch (failure) {
      setError(failure.reason || failure.message)
    } finally {
      setBusy(false)
    }
  }

  const view = async (importId) => {
    setError(null)
    try {
      const found = await Meteor.callAsync('teamImports.get', { importId })
      setOpen({ importId, report: found.report, state: found.state, invited: found.invited })
    } catch (failure) {
      setError(failure.reason || failure.message)
    }
  }

  const decide = async (importId, verb) => {
    setBusy(true)
    setError(null)
    try {
      const answer = await Meteor.callAsync(verb === 'confirm' ? 'teamImports.confirm' : 'teamImports.discard', verb === 'confirm' ? { importId, invite } : { importId })
      // A confirm with invitations stays open: it lists who was not invited and why.
      setOpen(verb === 'confirm' && invite ? { ...open, state: 'confirmed', invited: answer.invited } : null)
      await refresh()
    } catch (failure) {
      setError(failure.reason || failure.message)
    } finally {
      setBusy(false)
    }
  }

  // An address the source had not verified is invited only once the administrator has checked it.
  const inviteChecked = async (importId, email) => {
    setBusy(true)
    setError(null)
    try {
      const answer = await Meteor.callAsync('teamImports.invite', { importId, email })
      const found = await Meteor.callAsync('teamImports.get', { importId })
      setOpen((current) => (current?.importId === importId ? { ...current, invited: found.invited, lastInvite: answer } : current))
    } catch (failure) {
      setError(failure.reason || failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountPanel sx={{ maxWidth: COLUMN_WIDTH }}>
      <AccountSection title="Import a team export" data-testid="team-imports">
        <Typography>
          Upload a file from Team settings › Export everything. It becomes a new team that only administrators can
          see, with new addresses for everything. Confirm it to make the team live, or discard it.
        </Typography>
        <FinePrint>
          People arrive as placeholders who cannot sign in until invited, slates arrive private, board rules arrive
          switched off, and keys and tokens never move. Unconfirmed imports are discarded after 14 days.
        </FinePrint>
        <Box sx={{ display: 'grid', gap: SPACE.group, justifyItems: 'start', pt: SPACE.tight, width: '100%', maxWidth: 480 }}>
          <Button variant="outlined" component="label">
            {file ? file.name : 'Choose export file'}
            <input hidden type="file" accept=".sbxteam,.gz,application/octet-stream" data-testid="import-file" onChange={(event) => setFile(event.target.files?.[0] || null)} />
          </Button>
          <TextField
            type="password"
            label="Passphrase"
            autoComplete="off"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            inputProps={{ 'data-testid': 'import-passphrase' }}
            sx={{ width: '100%' }}
          />
        </Box>
        <AccountActions>
          <Button variant="contained" disabled={!file || busy} onClick={upload} data-testid="import-start">
            {busy ? 'Importing…' : 'Import'}
          </Button>
        </AccountActions>
        {error && <Alert severity="error">{error}</Alert>}
        {open && (
          <AccountNote data-testid="import-open" sx={{ display: 'grid', gap: SPACE.text, mt: SPACE.tight }}>
            <Typography variant="h6" component="h3">
              Import {open.state === 'pending' ? 'waiting for you' : open.state}
            </Typography>
            <Report report={open.report} />
            {open.invited && <Invited invited={open.invited} last={open.lastInvite} busy={busy} onInvite={(email) => inviteChecked(open.importId, email)} />}
            {open.state === 'pending' && (
              <>
                <FormControlLabel control={<Checkbox checked={invite} onChange={(event) => setInvite(event.target.checked)} />} label="Invite the people by email" />
                <AccountActions sx={{ pt: 0 }}>
                  <Button variant="contained" disabled={busy} onClick={() => decide(open.importId, 'confirm')} data-testid="import-confirm">
                    Confirm
                  </Button>
                  <Button variant="outlined" color="error" disabled={busy} onClick={() => decide(open.importId, 'discard')} data-testid="import-discard">
                    Discard
                  </Button>
                </AccountActions>
              </>
            )}
          </AccountNote>
        )}
      </AccountSection>
      {imports.length > 0 && (
        <AccountSection title="Recent imports">
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {imports.map((row) => (
              <li key={row.importId}>
                {row.teamName || 'Unnamed team'}: {row.state}
                {row.expiresAt ? ` (discarded ${row.expiresAt.slice(0, 10)} unless confirmed)` : ''}
                {row.failure ? ` (${row.failure.message})` : ''}{' '}
                {['pending', 'confirmed'].includes(row.state) && (
                  <Button size="small" onClick={() => view(row.importId)}>
                    Report
                  </Button>
                )}
              </li>
            ))}
          </Box>
        </AccountSection>
      )}
    </AccountPanel>
  )
}
