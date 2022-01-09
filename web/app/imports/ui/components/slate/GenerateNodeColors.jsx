import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from '@material-ui/core/styles';
import { makeStyles } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import Tooltip from '@material-ui/core/Tooltip';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import Box from '@material-ui/core/Box';
import { HexColor } from "../../common/HexColor.jsx"
import { PresetColors } from '../../common/PresetColors.jsx';
import Brightness1Icon from '@material-ui/icons/Brightness1';
import Typography from '@material-ui/core/Typography';
import { useSelector } from 'react-redux';
import { promisify } from '../../../api/client/promisify.js';
import { CONSTANTS } from '../../../api/common/constants.js';

export const GenerateNodeColors = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));
  let bcolor = props.slate?.options?.containerStyle?.backgroundColor;
  bcolor = bcolor ? bcolor : "#fff";
  const [selectedColor, updateColor] = React.useState(bcolor);
  const [selectedOpacity, updateOpacity] = React.useState(1);
  const [genType, setType] = React.useState(null);

  const setColor = (color, opacity) => {
    updateColor(color);
    updateOpacity(opacity);
  }

  const genColors = async (event, newType) => {
    if (!newType) {
      newType = genType;
    } else {
      setType(newType);
    }
    const palette = await promisify(Meteor.call, CONSTANTS.methods.themes.buildColorPalette, { type: newType, base: selectedColor });
    let c = props.slate.collab;
    if (props.slate.options.eligibleForThemeCompilation) {
      const ppkg = { type: "onNodeColorChanged", data: { id: `parent`, opacity: selectedOpacity, color: palette[0] } };
      c.invoke(ppkg);
      c.send(ppkg);
      for (let p = 1; p < palette.length; p++) {
        let cpkg = { type: "onNodeColorChanged", data: { id: `child_${p}`, opacity: selectedOpacity, color: palette[p] } };
        c.invoke(cpkg);
        c.send(cpkg);
      }
    } else {
      let p = -1;
      props.slate.nodes.allNodes.forEach((n) => {
        p++;
        if (p > palette.length) {
          p = 0;
        }
        let cpkg = { type: "onNodeColorChanged", data: { id: n.options.id, opacity: selectedOpacity, color: palette[p] } };
        c.invoke(cpkg);
        c.send(cpkg);
      });
    }
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={4}>
      <Grid item>
        <Typography variant="body2">
          Automatically generate complementary colors or shades for all the nodes on this slate. Select a single color then click the complementary or shades button to generate. NOTE: this will replace the current node colors.
        </Typography>
      </Grid>
      <Grid item>
        <HexColor
          color={selectedColor}
          opacity={selectedOpacity}
          onChange={setColor} />
      </Grid>
      <Grid item>
        <ToggleButtonGroup
          value={genType}
          exclusive
          onChange={genColors}
          aria-label="gen type"
        >
        <ToggleButton value="palette" aria-label="palette">
          <Tooltip title="Generate complementary colors based on the selected color" placement="top">
            <Typography variant="body2">Complementary</Typography>
          </Tooltip>
        </ToggleButton>
        <ToggleButton value="shades" aria-label="shades">
          <Tooltip title="Generate shades of the selected color based on the selected color" placement="top">
            <Typography variant="body2">Shades</Typography>
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>
    </Grid>
    </Grid >
  );
}