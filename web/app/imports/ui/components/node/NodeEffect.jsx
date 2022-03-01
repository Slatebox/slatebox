/* eslint-disable react/destructuring-assignment */
import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import nodeProps from '../../propTypes/nodeProps'

export default function NodeEffect({ node, onChange }) {
  const effects = node?.slate?.filters?.availableFilters || []
  const availEffects = []
  Object.keys(effects).forEach((e) => {
    if (
      effects[e].types.includes('vect') ||
      (node?.options.image != null && effects[e].types.includes('image'))
    ) {
      availEffects.push(e)
    }
  })
  const filterId = node?.options?.filters?.vect

  const [selectedFilter, updateEffect] = React.useState(filterId)

  const setEffect = (event, sFilterId) => {
    onChange({
      type: 'onNodeEffectChanged',
      data: { filter: { apply: 'vect', id: sFilterId } },
    })
    updateEffect(sFilterId)
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
        aria-label="node effect"
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

NodeEffect.propTypes = {
  node: nodeProps.isRequired,
  onChange: PropTypes.func.isRequired,
}
