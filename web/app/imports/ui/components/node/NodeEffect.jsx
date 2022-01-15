import React, { useEffect, useState } from 'react';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';

export const NodeEffect = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));

  console.log("filter effects", props?.node?.slate?.filters);

  let effects = props?.node?.slate?.filters?.availableFilters || [];
  let availEffects = [];
  Object.keys(effects).map(e => {
    if (effects[e].types.includes("vect") || (props?.node?.options.image != null && effects[e].types.includes("image"))) {
      availEffects.push(e);
    }
  });
  let filterId = props?.node?.options?.filters?.vect;

  const [selectedFilter, updateEffect] = React.useState(filterId);

  const setEffect = (event, filterId) => {
    //event.target.value
    props.onChange({ type: "onNodeEffectChanged", data: { filter: { apply: "vect", id: filterId } } });
    updateEffect(filterId);
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2} style={{ height: "180px" }}>
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
  );
}