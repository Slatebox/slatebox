import React, { useEffect, useState } from 'react';
import { Meteor } from "meteor/meteor";
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Skeleton from '@material-ui/lab/Skeleton';
import { CONSTANTS } from '../../api/common/constants';
import { promisify } from '../../api/client/promisify';
import { useSelector } from 'react-redux';

const useStyles = makeStyles((theme) => ({
  swatchParent: {
    width: "300px",
    height: "200px"
  },
  swatch: {
    width: "40px",
    height: "40px",
    cursor: "pointer",
    border: "1px solid #000",
    "border-radius": 5,
    "&:hover": {
      transform: "scale(1.1)"
    },
  }
}));

const presetDefaults = ["#f44336", "#e91e63", "#9c27b0", "#673ab7", "#3f51b5", "#2196f3", "#03a9f4", "#00bcd4", "#009688", "#4caf50", "#8bc34a", "#cddc39", "#ffeb3b", "#ffc107", "#ff9800", "#ff5722", "#795548", "#607d8b"];

export const PresetColors = (props) => {

  let slate = useSelector(state => state.slate);
  const classes = useStyles();
  const [presetColors, setPresets] = React.useState(slate?.options.themeId ? [] : presetDefaults);
  
  useEffect(() => {
    async function getPresets() {
      const palette = await promisify(Meteor.call, CONSTANTS.methods.themes.getPresetColors, { themeId: slate.options.basedOnThemeId });
      console.log("call completed ", palette);
      if (!palette) {
        setPresets(presetDefaults);
      } else {
        setPresets(palette.map(p => p.nodeColor));
      }
    }
    getPresets();
  }, [slate.options.basedOnThemeId])
  
  
  return (
    <Grid container style={{width: `${props.width || 280}px`, height: `${props.height || 150}px` }}>
      {presetColors.length === 0 ?
        <>
          {Array.from({ length: 18 }).map((k) => (
            <Grid item xs={2} className={classes.swatch} key={k}>
              <Skeleton variant="rect" animation="wave" width="100%" height="100%" />
            </Grid>
          ))}
        </>
        :
        presetColors.map((presetColor) => (
          <Grid item xs={2} className={classes.swatch} style={{ backgroundColor: presetColor }} key={presetColor} onClick={() => props.onColorChange(presetColor)}></Grid>
        ))
      }
    </Grid>
  );
};