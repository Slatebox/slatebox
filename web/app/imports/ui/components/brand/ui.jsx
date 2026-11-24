// The brand kit's small parts, in the new pages' look (Integrations, Team settings, the invite
// walkthrough): warm paper cards with a soft border, bold small headings, plain words under them.
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import { contrastCheck } from './brandKit.mjs'

export const card = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})

export function Section({ id, title, intro, action, children, ...props }) {
  return (
    // eslint-disable-next-line react/jsx-props-no-spreading
    <Box component="section" aria-labelledby={`brand-${id}`} sx={card} {...props}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="subtitle1" component="h2" id={`brand-${id}`} sx={{ fontWeight: 750, lineHeight: 1.3 }}>{title}</Typography>
          {intro && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{intro}</Typography>}
        </Box>
        {action}
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
Section.propTypes = { id: PropTypes.string.isRequired, title: PropTypes.node.isRequired, intro: PropTypes.node, action: PropTypes.node, children: PropTypes.node }
Section.defaultProps = { intro: null, action: null, children: null }

/** A small label over a field group. */
export function Label({ children, hint }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 650 }}>{children}</Typography>
      {hint && <Typography variant="caption" color="text.secondary" component="div">{hint}</Typography>}
    </Box>
  )
}
Label.propTypes = { children: PropTypes.node.isRequired, hint: PropTypes.node }
Label.defaultProps = { hint: null }

/** A contrast reading for text on a fill: the ratio and AA, AA large or "Hard to read". */
export function ContrastBadge({ ink, fill, compact }) {
  const c = contrastCheck(ink, fill)
  const good = c.passes
  const words = good ? `AA ${c.ratio.toFixed(1)}:1` : c.level === 'AA large' ? `Large text only ${c.ratio.toFixed(1)}:1` : `Hard to read ${c.ratio.toFixed(1)}:1`
  return (
    <Tooltip title={good ? 'Meets WCAG AA for text of any size.' : 'Below WCAG AA (4.5:1) for normal text. Pick a darker or lighter text color.'}>
      <Box component="span" data-contrast={good ? 'pass' : 'fail'} sx={(theme) => ({
        display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: '999px', fontSize: 12, fontWeight: 650, whiteSpace: 'nowrap',
        bgcolor: good ? '#e5f2e5' : '#fbe9e4', color: good ? '#235c2a' : '#8a2b17',
        ...theme.applyStyles('dark', { bgcolor: good ? '#2c4a33' : '#4d2a23', color: good ? '#cfe9cf' : '#ffd2c6' }),
      })}>
        {compact ? (good ? 'AA' : 'Low contrast') : words}
      </Box>
    </Tooltip>
  )
}
ContrastBadge.propTypes = { ink: PropTypes.string.isRequired, fill: PropTypes.string.isRequired, compact: PropTypes.bool }
ContrastBadge.defaultProps = { compact: false }

/** A round color dot. */
export function Dot({ color, size }) {
  return <Box component="span" aria-hidden sx={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', bgcolor: color, border: '1px solid rgba(0,0,0,.18)', flexShrink: 0 }} />
}
Dot.propTypes = { color: PropTypes.string.isRequired, size: PropTypes.number }
Dot.defaultProps = { size: 18 }
