// Team settings › Export everything: a team admin downloads everything the team owns as one
// archive (server/team-export). The server hands out a one-time address; the browser posts the
// passphrase to it in a plain form, so the download streams to disk instead of into memory.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { AccountActions, AccountPanel, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'

const MIN = 12
// The server's rule (server/team-export/archive.mjs passphraseProblem): a passphrase that starts or
// ends with white space, or holds a control character, could not be typed or sent back to import.
const problemOf = (passphrase) => {
  if (/^\s|\s$/u.test(passphrase)) return 'A passphrase cannot start or end with a space.'
  if (/[\p{Cc}\p{Cs}]/u.test(passphrase)) return 'A passphrase cannot hold control characters.'
  return null
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`

function download(url, passphrase) {
  const form = document.createElement('form')
  form.method = 'POST'
  // the same origin the page came from, whatever address the server knows itself by
  form.action = new URL(url).pathname
  form.style.display = 'none'
  const field = document.createElement('input')
  field.type = 'hidden'
  field.name = 'passphrase'
  field.value = passphrase
  form.appendChild(field)
  document.body.appendChild(form)
  form.submit()
  setTimeout(() => form.remove(), 1000)
}

export default function ExportEverything() {
  const [passphrase, setPassphrase] = React.useState('')
  const [again, setAgain] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)
  const [error, setError] = React.useState(null)
  const tooShort = passphrase.length > 0 && passphrase.length < MIN
  const problem = passphrase.length > 0 ? problemOf(passphrase) : null
  const mismatch = again.length > 0 && again !== passphrase
  const ready = passphrase.length >= MIN && !problem && again === passphrase && !busy

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const answer = await Meteor.callAsync('team.export', {})
      download(answer.downloadUrl, passphrase)
      setResult(answer)
      setPassphrase('')
      setAgain('')
    } catch (failure) {
      setError(failure.reason || failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountPanel>
      <AccountSection title="Export everything" data-testid="export-everything">
        <Typography>
          Download everything your team owns as one file: every slate with its boards and smart components, recent
          versions, comments, presentations, uploaded files, people and their roles, sharing settings, team settings,
          your team&apos;s AI connections and the names of your API tokens. Any Slatebox server can import it,
          including one you run yourself.
        </Typography>
        <FinePrint>
          Never included: passwords, sign-in sessions, API token secrets, AI keys and link keys. Imported board rules
          start switched off until someone reviews them.
        </FinePrint>
        <FinePrint>
          The file is encrypted with a passphrase you choose. Keep it safe: without it nobody, including us, can open
          the file.
        </FinePrint>
        <Box sx={{ display: 'grid', gap: SPACE.hair, pt: SPACE.tight, width: '100%', maxWidth: 480 }}>
          <TextField
            type="password"
            label="Passphrase (at least 12 characters)"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            error={tooShort || Boolean(problem)}
            helperText={tooShort ? `Use at least ${MIN} characters.` : problem || ' '}
            inputProps={{ 'data-testid': 'export-passphrase' }}
          />
          <TextField
            type="password"
            label="Passphrase again"
            autoComplete="new-password"
            value={again}
            onChange={(event) => setAgain(event.target.value)}
            error={mismatch}
            helperText={mismatch ? 'The passphrases differ.' : ' '}
            inputProps={{ 'data-testid': 'export-passphrase-again' }}
          />
        </Box>
        <AccountActions sx={{ pt: 0 }}>
          <Button variant="contained" disabled={!ready} onClick={start} data-testid="export-start">
            {busy ? 'Preparing…' : 'Export everything'}
          </Button>
        </AccountActions>
        {result && (
          <Alert severity="success" data-testid="export-started">
            Your download of {result.team?.name} has started: {count(result.slates, 'slate', 'slates')} and{' '}
            {count(result.members, 'person', 'people')}. Large teams take a few minutes.
          </Alert>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </AccountSection>
    </AccountPanel>
  )
}
