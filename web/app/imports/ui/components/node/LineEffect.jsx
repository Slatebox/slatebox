import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import nodeProps from '../../propTypes/nodeProps'
import associationProps from '../../propTypes/associationProps'

export default function LineEffect({ node, association, onChange }) {
  const lineEffect = node?.options?.lineEffect
  const [selectedFilter, updateEffect] = React.useState(lineEffect)

  const effects = node?.slate?.filters?.availableFilters || []
  const availEffects = []
  Object.keys(effects).forEach((e) => {
    if (effects[e].types.includes('line')) {
      availEffects.push(e)
    }
  })

  const setEffect = (event, sLineEffect) => {
    const index = node?.relationships?.associations.findIndex(
      (a) => a.id === association.id
    )
    const data = {
      val: sLineEffect,
      prop: 'lineEffect',
      associationId: association.id,
      index,
    }
    onChange({ type: 'onLinePropertiesChanged', data })
    updateEffect(lineEffect)
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
        aria-label="line effect"
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

LineEffect.propTypes = {
  node: nodeProps,
  association: associationProps,
  onChange: PropTypes.func.isRequired,
}

LineEffect.defaultProps = {
  node: null,
  association: null,
}
