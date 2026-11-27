// A value an admin copies into another console (a redirect URI, a DNS record), with a Copy button.
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export default function CopyValue({ label, value }) {
  const [copied, setCopied] = React.useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* the value stays selectable */ }
  }
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '180px minmax(0, 1fr) auto' }, gap: { xs: 0.25, sm: 1 }, alignItems: 'center', minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" component="code" sx={{ fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13, overflowWrap: 'anywhere', userSelect: 'all' }}>{value}</Typography>
      <Button size="small" onClick={copy} aria-label={`Copy ${label}`} sx={{ justifySelf: 'start' }}>{copied ? 'Copied' : 'Copy'}</Button>
    </Box>
  )
}
CopyValue.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.string.isRequired }
