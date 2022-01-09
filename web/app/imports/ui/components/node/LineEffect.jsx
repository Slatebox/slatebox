import React, { useEffect, useState } from 'react';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';

export const LineEffect = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));

  console.log("filter effects", props?.node?.slate?.filters);
  let lineEffect = props?.node?.options?.lineEffect;
  const [selectedFilter, updateEffect] = React.useState(lineEffect);

  let effects = props?.node?.slate?.filters?.availableFilters || [];
  let availEffects = [];
  Object.keys(effects).map(e => {
    if (effects[e].types.includes("line")) {
      availEffects.push(e);
    }
  });

  const setEffect = (event, lineEffect) => {
    const index = props?.node?.relationships?.associations.findIndex(a => a.id === props.association.id);
    const data = { val: lineEffect, prop: "lineEffect", associationId: props.association.id, index: index };
    console.log("sending effect", data);
    props.onChange({ type: "onLinePropertiesChanged", data });
    updateEffect(lineEffect);
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2} style={{ height: "180px" }}>
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
  );
}