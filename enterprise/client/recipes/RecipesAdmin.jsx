// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Admin › Recipes (slot admin.recipes), for a server admin: the install's one switch (on from the
// start on Slatebox Cloud; off on a self-hosted install until an admin turns it on), how many
// recipes run, Pause every recipe, and the limits in force. Every change is in the activity log.
import React, { useEffect, useState } from 'react'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import confirmService from '/imports/ui/common/confirm'
import useServerAdmin from '/imports/ui/common/useServerAdmin'
import recipesApi from './recipesApi'
import { refreshCatalog } from './availability'
import { recipeErrorWords } from './recipesModel.mjs'

const LIMIT_WORDS = {
  instancesPerOwner: 'Recipes per person',
  concurrentPerOwner: 'Runs at once per person',
  runsPerDayPerInstance: 'Runs a day per recipe',
  inboundPerHourPerInstance: 'Webhook runs an hour per recipe',
  minScheduleMinutes: 'Shortest schedule (minutes)',
}

/** Where recipes are off: the switch, for a server admin (the project page's Recipes tab shows it too). */
export function RecipesOffSwitch() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function turnOn() {
    setBusy(true); setError('')
    try { await recipesApi.admin.setEnabled({ enabled: true }); await refreshCatalog() } catch (e) { setError(recipeErrorWords(e)); setBusy(false) }
  }
  return (
    <Box sx={{ display: 'grid', gap: 1, justifyItems: 'start', py: 2 }} data-recipes-off="">
      <Typography fontWeight={650}>Recipes are off on this server</Typography>
      <Typography variant="body2" color="text.secondary">
        Recipes are agents that keep slates up to date from GitHub, Slack, Google Drive and webhooks, as the people who add them. Turn them on to let people add them to their projects.
      </Typography>
      <Button variant="contained" disableElevation disabled={busy} onClick={turnOn}>Turn on recipes</Button>
      {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
    </Box>
  )
}

export default function RecipesAdmin() {
  const theme = useTheme()
  const admin = useServerAdmin()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const load = () => recipesApi.admin.status().then(setStatus, (e) => setNote(recipeErrorWords(e)))
  useEffect(() => { if (admin) load() }, [admin])
  if (!admin) return null
  async function setEnabled(enabled) {
    if (!enabled && !await confirmService.show({ theme, title: 'Turn recipes off?', message: 'Every recipe on this server stops running and people can’t add new ones. Their slates stay as they are.' })) return
    setBusy(true); setNote('')
    try { await recipesApi.admin.setEnabled({ enabled }); await load(); await refreshCatalog() } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  async function pauseAll() {
    if (!await confirmService.show({ theme, title: 'Pause every recipe?', message: 'Each one stays paused until its owner resumes it.' })) return
    setBusy(true); setNote('')
    try { await recipesApi.admin.pauseAll(); await load(); setNote('Every recipe is paused.') } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  return (
    <Card variant="outlined" id="recipes" data-admin-recipes="">
      <CardContent sx={{ display: 'grid', gap: 1.5 }}>
        <Typography variant="h6" component="h2">Recipes</Typography>
        <Typography variant="body2" color="text.secondary">
          Agents people attach to their projects to keep slates up to date from GitHub, Slack, Google Drive, schedules and webhooks. They run as the person who added them, with that person’s sign-ins.
        </Typography>
        {status && (
          <>
            <FormControlLabel control={<Switch checked={Boolean(status.enabled)} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />}
              label={status.enabled ? 'Recipes are on' : 'Recipes are off'} />
            {status.instances && (
              <Typography variant="body2">{status.instances.active ?? 0} on · {status.instances.paused ?? 0} paused · {status.instances.total ?? 0} in all</Typography>
            )}
            {status.enabled && <Button variant="outlined" disabled={busy} onClick={pauseAll} sx={{ justifySelf: 'start' }}>Pause every recipe</Button>}
            {status.limits && (
              <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content auto', columnGap: 2, rowGap: 0.5, fontSize: 14 }}>
                {Object.entries(LIMIT_WORDS).filter(([k]) => status.limits[k] !== undefined).map(([k, label]) => (
                  <React.Fragment key={k}><Box component="dt" sx={{ color: 'text.secondary' }}>{label}</Box><Box component="dd" sx={{ m: 0 }}>{status.limits[k]}</Box></React.Fragment>
                ))}
              </Box>
            )}
          </>
        )}
        {note && <Typography role="status" variant="body2">{note}</Typography>}
      </CardContent>
    </Card>
  )
}
