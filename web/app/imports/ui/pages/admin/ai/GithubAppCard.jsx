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
import { defaultOrgOf, githubAppStatus, manifestFormFields, orgProblem, returnedNote } from './github-app-model.mjs'

// Admin › AI control › Integration apps › GitHub App: the App recipes read GitHub through
// (connectors.githubApp.get, .manifest, .clear). "Create the GitHub App" makes it in one click with
// GitHub's App manifest flow: on Slatebox Cloud the one public App ("Slatebox", or "Slatebox (test)"
// on the test server) in the Slatebox organization; on a self-hosted install a private App in the
// organization typed here, or the admin's own account. GitHub sends the admin back here with
// ?github=ready. Shown only where recipes run (the actions exist).
const failure = (err, fallback) => err?.reason || err?.message || fallback
const CHIP = { ready: 'Ready', partial: 'Partly set up', none: 'Not set up' }

/** Posts GitHub's App manifest from this page (GitHub's own form flow; nothing secret in it). */
function postManifest(form) {
  const el = document.createElement('form')
  el.method = 'post'
  el.action = form.action
  el.style.display = 'none'
  Object.entries(form.fields).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    el.appendChild(input)
  })
  document.body.appendChild(el)
  el.submit()
}

export default function GithubAppCard() {
  const [view, setView] = useState(null)
  const [hidden, setHidden] = useState(false)
  const [org, setOrg] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [note] = useState(() => (typeof window === 'undefined' ? null : returnedNote(window.location.search)))
  const load = async () => {
    try {
      const got = await Meteor.callAsync('connectors.githubApp.get', {})
      setView(got)
      setOrg((had) => had || defaultOrgOf(got))
    } catch (err) {
      // No recipes on this server (no enterprise code, recipes off, still starting): no card.
      if (err?.error === 404 || err?.error === 409 || /not found|no such action|starting/i.test(err?.reason || err?.message || '')) setHidden(true)
      else setProblem(failure(err, 'The GitHub App could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  if (hidden) return null

  const status = githubAppStatus(view)
  const create = async () => {
    const wrong = orgProblem(org)
    if (wrong) { setProblem(wrong); return }
    setBusy(true)
    setProblem('')
    try {
      const answer = await Meteor.callAsync('connectors.githubApp.manifest', org.trim() ? { org: org.trim() } : {})
      const form = manifestFormFields(answer)
      if (!form) throw new Error('Slatebox could not make the GitHub form. Try again.')
      postManifest(form)
    } catch (err) {
      setProblem(failure(err, 'The GitHub App could not be started.'))
      setBusy(false)
    }
  }
  const clear = async (reason) => {
    await Meteor.callAsync('connectors.githubApp.clear', reason ? { reason } : {})
    setClearing(false)
    await load()
  }
  const makes = view?.makes
  return (
    <Box data-github-app="" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flex: '1 1 160px' }}>GitHub App (recipes)</Typography>
        {view && <Chip size="small" variant={status.state === 'ready' ? 'filled' : 'outlined'} color={status.state === 'ready' ? 'primary' : 'default'}
          label={CHIP[status.state] || CHIP.none} data-github-app-state={status.state} />}
      </Box>
      {note && <Alert severity={note.severity} sx={{ mt: 1 }} data-github-app-returned="">{note.text}</Alert>}
      <Typography variant="body2" sx={{ mt: 1 }} data-github-app-title="">{status.title}</Typography>
      {status.lines.map((line) => <Typography key={line} variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{line}</Typography>)}
      {(status.appUrl || status.installUrl) && (
        <Box sx={{ mt: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {status.appUrl && <Link href={status.appUrl} target="_blank" rel="noopener noreferrer" variant="body2" data-github-app-page="">The App on GitHub</Link>}
          {status.installUrl && <Link href={status.installUrl} target="_blank" rel="noopener noreferrer" variant="body2" data-github-app-install="">{status.installUrl}</Link>}
        </Box>
      )}
      {view && status.state !== 'ready' && (
        <Box sx={{ mt: 1.5, display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField size="small" label="GitHub organization" value={org} onChange={(e) => setOrg(e.target.value)} sx={{ minWidth: 240 }}
            inputProps={{ spellCheck: false, autoComplete: 'off', 'data-github-app-org': '' }}
            helperText={makes?.defaultOrg ? `The App belongs to this organization (${makes.defaultOrg} for Slatebox Cloud).` : 'Leave blank to make it in your own GitHub account.'} />
          <Button variant="contained" size="small" disabled={busy || !view.secretsAvailable} onClick={create} sx={{ mt: 0.5 }} data-github-app-create="">
            Create the GitHub App
          </Button>
        </Box>
      )}
      {view && !view.secretsAvailable && <Alert severity="warning" sx={{ mt: 1 }}>Set SLATEBOX_KEY_ENCRYPTION_KEY on this server to store the GitHub App&apos;s keys.</Alert>}
      {problem && <Alert severity="warning" sx={{ mt: 1 }}>{problem}</Alert>}
      {view?.source === 'admin' && <Button size="small" color="error" sx={{ mt: 1 }} disabled={busy} onClick={() => setClearing(true)}>Clear</Button>}
      <ReasonDialog open={clearing} optional danger title="Clear the GitHub App?"
        body="Slatebox forgets the App's keys. Recipes on GitHub stop until an App is set up again. The App itself stays on GitHub; delete it there if you no longer want it."
        action="Clear" onClose={() => setClearing(false)} onConfirm={clear} />
    </Box>
  )
}
