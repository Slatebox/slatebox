import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import { useSelector } from 'react-redux'

export default function SlateEffects({ onChange }) {
  const slate = useSelector((state) => state.slate)

  const bEffect = slate?.options?.containerStyle?.backgroundEffect
  const [selectedFilter, updateEffect] = React.useState(bEffect)

  const effects = slate?.filters?.availableFilters || []
  const availEffects = []
  Object.keys(effects).forEach((e) => {
    if (effects[e].types.includes('slate')) {
      availEffects.push(e)
    }
  })

  const setEffect = (event, filterId) => {
    onChange({
      type: 'onSlateBackgroundEffectChanged',
      data: { effect: filterId },
    })
    updateEffect(filterId)
  }

  SlateEffects.propTypes = {
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid
      container
      alignItems="center"
      justify="center"
      spacing={2}
      style={{ height: '180px' }}
    >
      <ToggleButtonGroup
        value={selectedFilter}
        exclusive
        onChange={setEffect}
        style={{ flexWrap: 'wrap' }}
        aria-label="slate effect"
      >
        {availEffects.map((e) => (
          <ToggleButton key={e} value={e} aria-label={e}>
            {e}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Grid>
  )
}
