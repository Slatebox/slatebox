// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Team settings › Agents (slot team.recipes): "Allow recipes for this team", for the team's admins.
// Off stops every recipe on the team's projects; each owner's recipes stay as they were for when it
// is allowed again. Recorded in the activity log.
import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Box from '@mui/material/Box'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import { useCatalog } from './availability'
import recipesApi from './recipesApi'
import { recipeErrorWords } from './recipesModel.mjs'

export default function TeamRecipes() {
  const { state } = useCatalog()
  const orgId = useTracker(() => Meteor.user()?.orgId || null, [])
  const [allowed, setAllowed] = useState(null)
  const [note, setNote] = useState('')
  useEffect(() => {
    if (!orgId || state !== 'on') return
    recipesApi.team.get({ orgId }).then((a) => setAllowed(a?.allowed !== false), () => setAllowed(null))
  }, [orgId, state])
  if (!orgId || state !== 'on' || allowed === null) return null
  async function change(next) {
    setNote('')
    try { await recipesApi.team.set({ orgId, allowed: next }); setAllowed(next) } catch (e) { setNote(recipeErrorWords(e)) }
  }
  return (
    <Box data-team-recipes="" sx={{ display: 'grid', gap: 0.5 }}>
      <FormControlLabel control={<Switch checked={allowed} onChange={(e) => change(e.target.checked)} />} label="Allow recipes for this team" />
      <Typography variant="body2" color="text.secondary">Recipes are agents people attach to projects to keep slates up to date from their tools. Off stops them on every team project.</Typography>
      {note && <Typography role="alert" color="error" variant="body2">{note}</Typography>}
    </Box>
  )
}
