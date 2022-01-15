import React, { useEffect, useState } from 'react';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';
import { useSelector } from 'react-redux';

export const SlateEffects = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));
  const slate = useSelector(state => state.slate);

  let bEffect = slate?.options?.containerStyle?.backgroundEffect;
  const [selectedFilter, updateEffect] = React.useState(bEffect);

  console.log("filter effects", slate?.filters);

  let effects = slate?.filters?.availableFilters || [];
  let availEffects = [];
  Object.keys(effects).map(e => {
    if (effects[e].types.includes("slate")) {
      availEffects.push(e);
    }
  });

  const setEffect = (event, filterId) => {
    //event.target.value
    console.log("filterId", filterId)
    props.onChange({ type: "onSlateBackgroundEffectChanged", data: { effect: filterId } });
    updateEffect(filterId);
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2} style={{ height: "180px" }}>
      <ToggleButtonGroup
        value={selectedFilter}
        exclusive
        onChange={setEffect}
        style={{flexWrap: "wrap"}}
        aria-label="slate effect"
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