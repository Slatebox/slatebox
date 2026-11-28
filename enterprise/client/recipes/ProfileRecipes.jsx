// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Profile › Agents (slot profile.recipes): "Pause all my recipes", the owner's own kill switch for
// every recipe that runs as them. Recorded in the activity log.
import React, { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import { useCatalog } from './availability'
import recipesApi from './recipesApi'
import { recipeErrorWords } from './recipesModel.mjs'

export default function ProfileRecipes() {
  const { state } = useCatalog()
  const [paused, setPaused] = useState(null)
  const [note, setNote] = useState('')
  useEffect(() => { if (state === 'on') recipesApi.mine().then((a) => setPaused(Boolean(a?.paused)), () => setPaused(null)) }, [state])
  if (state !== 'on' || paused === null) return null
  async function change(next) {
    setNote('')
    try { await recipesApi.pauseMine({ paused: next }); setPaused(next) } catch (e) { setNote(recipeErrorWords(e)) }
  }
  return (
    <Box data-profile-recipes="" sx={{ display: 'grid', gap: 0.5, mt: 2 }}>
      <Typography fontWeight={650}>Recipes</Typography>
      <FormControlLabel control={<Switch checked={paused} onChange={(e) => change(e.target.checked)} />} label="Pause all my recipes" />
      <Typography variant="body2" color="text.secondary">Every recipe that runs as you stops until you turn this off. Their slates stay as they are.</Typography>
      {note && <Typography role="alert" color="error" variant="body2">{note}</Typography>}
    </Box>
  )
}
