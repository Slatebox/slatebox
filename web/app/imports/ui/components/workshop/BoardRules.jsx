import React, { useEffect, useState } from 'react'
import { Box, Chip, Typography } from '@mui/material'
import { rulebookLoaded } from 'slateboxjs/workshops/model'
import { boardRuleChips } from '../../../api/common/board-rules.mjs'
import { KIT_KINDS } from '../../../api/common/conversation-preview.mjs'

/**
 * A board's rules as chips, titled "Rules": the legend the board draws above itself on the canvas (boardRuleChips).
 * The rules load first when the board has some and they have not loaded yet. Nothing is shown for a board without rules.
 */
export default function BoardRules({ workshop }) {
  const [, loaded] = useState(0)
  // A plan's or a pipeline's sentences need its kind's rules as well as the rulebook (both load once, then are cached).
  const kind = KIT_KINDS.includes(workshop?.kind) ? workshop.kind : null
  const needs = Boolean(workshop?.behaviour || kind)
  useEffect(() => {
    if (!needs) return undefined
    let gone = false
    Promise.all([rulebookLoaded() ? null : import('slateboxjs/workshops/behaviour'), kind ? import('slateboxjs/workshops/rules') : null])
      .then(() => { if (!gone) loaded(n => n + 1) }).catch(() => undefined)
    return () => { gone = true }
  }, [needs, kind])
  const chips = boardRuleChips(workshop)
  if (!chips.length) return null
  return <Box component="section" aria-label="Rules" sx={{ my: 1 }}>
    <Typography variant="body2" sx={{ fontWeight: 600, mb: .5 }}>Rules</Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: .5 }}>
      {chips.map(chip => <Chip key={chip.key} size="small" label={chip.text} data-rule-chip={chip.icon}
        variant={chip.warn ? 'outlined' : 'filled'} sx={{ bgcolor: chip.warn ? 'transparent' : 'action.hover', borderStyle: chip.warn ? 'dashed' : undefined }} />)}
    </Box>
  </Box>
}
