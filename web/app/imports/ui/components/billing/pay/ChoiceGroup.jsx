import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import { sheetTone } from './SheetParts'

// Month/year and the top-up amounts: a real radio group (arrow keys move, one tab stop), drawn as
// the mock's cards (design §5.1 review). A disabled choice keeps its description (aria-describedby).
export default function ChoiceGroup({ label, value, onChange, options, columns, disabled, compact }) {
  return (
    <RadioGroup
      aria-label={label}
      value={String(value)}
      onChange={e => onChange(options.find(o => String(o.value) === e.target.value)?.value)}
      sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 1, mb: compact ? 1.5 : 2, flexWrap: 'nowrap' }}
    >
      {options.map(o => {
        const on = String(o.value) === String(value)
        const off = disabled || o.disabled
        return (
          <Box
            component="label"
            key={o.value}
            sx={theme => ({
              position: 'relative', display: 'block', cursor: off ? 'default' : 'pointer', borderRadius: '12px', textAlign: compact ? 'center' : 'left',
              px: compact ? 0 : 1.75, py: compact ? 1.25 : 1.5, opacity: o.disabled ? 0.45 : 1,
              border: `1.5px solid ${on ? theme.palette.primary.main : theme.palette.divider}`,
              boxShadow: on ? `inset 0 0 0 1px ${theme.palette.primary.main}` : 'none',
              bgcolor: on ? `color-mix(in srgb, ${sheetTone.selected(theme)} 45%, ${theme.palette.background.paper})` : 'background.paper',
              '&:has(input:focus-visible)': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
            })}
            data-pay-choice={o.value}
          >
            <Radio
              value={String(o.value)}
              disabled={off}
              inputProps={{ 'aria-describedby': o.describedBy || undefined, 'aria-label': o.ariaLabel || undefined }}
              sx={{ position: 'absolute', opacity: 0, width: 1, height: 1, p: 0, m: 0, pointerEvents: 'none' }}
            />
            {o.render}
          </Box>
        )
      })}
    </RadioGroup>
  )
}

ChoiceGroup.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onChange: PropTypes.func.isRequired,
  options: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]), render: PropTypes.node, disabled: PropTypes.bool, describedBy: PropTypes.string, ariaLabel: PropTypes.string })).isRequired,
  columns: PropTypes.number.isRequired,
  disabled: PropTypes.bool,
  compact: PropTypes.bool,
}
ChoiceGroup.defaultProps = { disabled: false, compact: false }
