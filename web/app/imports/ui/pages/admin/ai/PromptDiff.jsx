import React from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { flaggedAdditions, sideBySide } from './prompts-view.mjs'

// Admin › AI control › Prompts › compare: two versions side by side, line by line, with the words
// that changed inside a line marked. For an agent's suggestion, what it adds that a reviewer should
// read twice (instructions, links, tool names, AI control or token words) is listed above.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }
const tint = { removed: 'rgba(211, 47, 47, 0.18)', added: 'rgba(46, 125, 50, 0.2)' }

function Side({ parts }) {
  if (!parts) return <Box sx={{ ...mono, bgcolor: 'action.hover', minHeight: '1.2em' }} />
  return (
    <Box sx={mono}>
      {parts.map((part, i) => (
        <Box component="span" key={i} sx={part.kind === 'same' ? null : { bgcolor: tint[part.kind], textDecoration: part.kind === 'removed' ? 'line-through' : 'none' }}>{part.text}</Box>
      ))}
    </Box>
  )
}

export default function PromptDiff({ before, after, beforeLabel, afterLabel, suggestion = false }) {
  const rows = sideBySide(before ?? '', after ?? '')
  const changed = rows.some((row) => row.kind !== 'same')
  const flags = suggestion ? flaggedAdditions(before ?? '', after ?? '') : []
  return (
    <Box data-testid="prompt-diff">
      {flags.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          <Typography variant="body2" fontWeight={600}>An agent suggested this. Read these added sentences twice:</Typography>
          {flags.map((flag, i) => <Typography key={i} variant="body2">“{flag.text}” ({flag.why.join(', ')})</Typography>)}
        </Alert>
      )}
      {!changed && <Typography variant="body2" color="text.secondary">The two texts are the same.</Typography>}
      <Box sx={{ display: 'grid', gridTemplateColumns: '2.5em 1fr 2.5em 1fr', columnGap: 1, rowGap: 0.5, alignItems: 'start' }}>
        <span />
        <Typography variant="caption" color="text.secondary">{beforeLabel}</Typography>
        <span />
        <Typography variant="caption" color="text.secondary">{afterLabel}</Typography>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'right' }}>{row.leftNo ?? ''}</Typography>
            <Side parts={row.left} />
            <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'right' }}>{row.rightNo ?? ''}</Typography>
            <Side parts={row.right} />
          </React.Fragment>
        ))}
      </Box>
    </Box>
  )
}
