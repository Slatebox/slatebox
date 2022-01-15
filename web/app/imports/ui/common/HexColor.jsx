import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import { HexColorPicker, RgbaColorPicker } from "react-colorful";
import "./react-colorful.css";
import FormControl from '@material-ui/core/FormControl';
import OutlinedInput from '@material-ui/core/OutlinedInput';
import InputAdornment from '@material-ui/core/InputAdornment';
import rgbToHex from 'rgb-hex';
import hexToRGB from 'hex-rgb';

const useStyles = makeStyles((theme) => ({
  hexInput: {
    padding: "4px 4px",
    width: "110px"
  },
  colorPicker: {
    height: "150px"
  }
}));

export const HexColor = (props) => {
  const classes = useStyles();
  let color = props?.color;
  let opacity = props?.opacity;
  color = color === "transparent" ? "#fff" : color;
  opacity = color === "transparent" ? 0 : opacity;
  let c = null;
  try { 
    c = hexToRGB(color);
  } catch (err) {
    c = hexToRGB("#fff");
  }
  const c2 = {
    r: c.red,
    g: c.green,
    b: c.blue,
    a: opacity
  };

  let lt = null;
  const debounceChange = (color, alpha) => {
    clearTimeout(lt);
    lt = window.setTimeout(() => {
      props.onChange(color, alpha);
    }, 50)
  }

  return (
    <Grid container alignItems={props.alignItems || "center"} justify={props.justify || "flex-start"}>
      <Grid item>
        <Grid item xs={12}>
          {props.noAlpha ?
            <HexColorPicker
            color={props?.color}
            onChange={(color) => { 
              debounceChange(`#${color.replace("#", "")}`)
            }}
            className={classes.colorPicker} />
          :
          <RgbaColorPicker
            color={c2}
            onChange={(color) => { 
              let hex = rgbToHex(color.r, color.g, color.b); 
              debounceChange(`#${hex}`, color.a)
            }}
            className={classes.colorPicker} />
          }
        </Grid>
        <Grid xs={12}>
          <FormControl variant="outlined" style={{ marginTop: "8px" }}>
            <OutlinedInput
              id="outlined-adornment-hex"
              classes={{ input: classes.hexInput }}
              value={props.color.replace("#", "")}
              onChange={(e) => { debounceChange(`#${e.target.value.replace("#", "")}`) }}
              startAdornment={<InputAdornment position="start">#</InputAdornment>}
            />
          </FormControl>
        </Grid>
      </Grid>
    </Grid>
  );
}
