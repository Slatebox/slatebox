// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Standing permissions: the changes outside Slatebox a recipe may make without asking each time
// (a check on pushes, a pull request on slatebox/… branches, a Slack post). Each row says exactly
// what and where, is off until the person turns it on, and is recorded in the activity log. Without
// one, the recipe puts an approval card on its status slate instead. Only a signed-in person grants:
// never a token, exec or MCP (recipes.grant is in NEVER_BOUND).
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import recipesApi from './recipesApi'
import { permissionRows, recipeErrorWords } from './recipesModel.mjs'

export default function RecipePermissions({ instanceId, manifest, config, grants, onChanged, disabled = false }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const rows = permissionRows(manifest, config, grants)
  if (!rows.length) return null
  async function toggle(row, on) {
    setBusy(row.kind)
    setError('')
    try {
      if (on) await recipesApi.grant({ instanceId, kind: row.kind, scope: row.scope })
      else await recipesApi.revoke({ grantId: row.grantId })
      await onChanged()
    } catch (e) { setError(recipeErrorWords(e)) } finally { setBusy(null) }
  }
  return (
    <Box component="fieldset" data-recipe-permissions="" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, m: 0, display: 'grid', gap: 1 }}>
      <Typography component="legend" fontWeight={650} sx={{ px: 0.5 }}>Changes outside Slatebox</Typography>
      <Typography variant="body2" color="text.secondary">
        Off unless you turn them on. Without permission, each change waits for your approval on the recipe’s status slate. You can turn them off at any time.
      </Typography>
      {rows.map((row) => (
        <FormControlLabel key={row.kind} disabled={disabled || busy !== null}
          control={<Checkbox checked={row.granted} onChange={(e) => toggle(row, e.target.checked)} />}
          label={<Typography variant="body2">{row.text}</Typography>} />
      ))}
      {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
    </Box>
  )
}

RecipePermissions.propTypes = {
  instanceId: PropTypes.string.isRequired,
  manifest: PropTypes.object,
  config: PropTypes.object,
  grants: PropTypes.arrayOf(PropTypes.object),
  onChanged: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
