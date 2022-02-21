import { Meteor } from 'meteor/meteor';
import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import TextField from '@material-ui/core/TextField';
import FormatAlignLeftIcon from '@material-ui/icons/FormatAlignLeft';
import FormatAlignCenterIcon from '@material-ui/icons/FormatAlignCenter';
import FormatAlignRightIcon from '@material-ui/icons/FormatAlignRight';
import Brightness1Icon from '@material-ui/icons/Brightness1';
import FontPicker from "font-picker-react";
import Grid from '@material-ui/core/Grid';
import Select from '@material-ui/core/Select';
import MenuItem from '@material-ui/core/MenuItem';
import Button from '@material-ui/core/Button';
import Divider from '@material-ui/core/Divider';

import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';

import { HexColor } from "../../common/HexColor.jsx"
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';

const useStyles = makeStyles((theme) => ({
  root: {
    width: "100%",
    background: "#fff"
  },
  items: {
    width: 'fit-content',
    marginLeft: 'auto',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.secondary,
    cursor: "pointer",
    '& svg': {
      margin: theme.spacing(0.5),
    },
    '& hr': {
      margin: theme.spacing(0, 0.5),
    },
  },
  active: {
    color: theme.palette.secondary.main
  },
  hexInput: {
    padding: "4px 4px",
    width: "110px"
  }
}));

export const NodeText = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));

  const classes = useStyles();
  const fontSizes = [];
  for (let ptx = 10; ptx < 201; ptx++) {
    ptx % 2 === 0 && fontSizes.push(ptx);
  }
  let fonts = ["arial", "times-new-roman", "georgia", "courier-prime", "indie-flower", "abril-fatface"
    , "bangers", "caveat", "eb-garamond", "fredoka-one", "graduate", "gravitas-one", "ibm-plex-mono"
    , "ibm-plex-sans", "ibm-plex-serif", "lemon", "nixie-one", "noto-sans", "pt-sans", "pt-sans-narrow"
    , "pt-serif", "permanent-marker", "rammetto-one", "roboto", "roboto-condensed", "roboto-mono", "roboto-slab"
    , "titan-one"];

  const [value, setText] = React.useState(props?.node?.options?.text);
  const [fontSize, setSize] = React.useState(props?.node?.options?.fontSize);
  const [foregroundColor, setColor] = React.useState(props?.node?.options?.foregroundColor || "#000");
  const [textOpacity, setOpacity] = React.useState(props?.node?.options?.textOpacity || 1);
  const [fontFamily, setFont] = React.useState(props?.node?.options?.fontFamily);
  const [alignment, setAlignment] = React.useState(svgToHtmlAlign(props?.node?.options?.textXAlign));

  function filterFonts(font) {
    return fonts.includes(font.id);
  }

  // async function loadFonts() {
  //   await import(selectedFont.import);
  //   for (let f of fonts.filter(f => f.import !== selectedFont.import && !systemFonts.includes(f.raw))) {
  //     await import(f.import);
  //     console.log("loaded ", f.import);
  //   }
  // }

  // loadFonts();

  const updateOptions = (opts) => {

    if (opts.text != null) {
      setText(opts.text);
    } else if (opts.fontFamily) {
      setFont(opts.fontFamily);
    } else if (opts.textXAlign) {
      setAlignment(svgToHtmlAlign(opts.textXAlign));
    } else if (opts.fontColor) {
      setColor(opts.fontColor);
    } else if (opts.fontSize) {
      setSize(opts.fontSize);
    } else if (opts.textOpacity != null) {
      setOpacity(opts.textOpacity);
    }

    window.clearTimeout(window.updateText);
    window.updateText = setTimeout(() => {
      //var textPkg = { type: "onNodeTextChanged", data: { text: _self._.options.text, fontSize: _self._.options.fontSize, fontFamily: _self._.options.fontFamily, fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign } };
      const textPkg = { type: "onNodeTextChanged", data: {} };
      Object.assign(textPkg.data, opts);
      props.onChange(textPkg);
    }, 250);

  };

  function svgToHtmlAlign(svg) {
    if (svg === "end")
      return "right";
    else if (svg === "start")
      return "left"
    else
      return "center";
  }
  
  let effects = props?.node?.slate?.filters?.availableFilters || [];
  let availEffects = [];
  Object.keys(effects).map(e => {
    if (effects[e].types.includes("text")) {
      availEffects.push(e);
    }
  });
  let filterId = props?.node?.options?.filters?.text;

  const [selectedFilter, updateEffect] = React.useState(filterId);

  const setEffect = (event, filterId) => {
    //event.target.value
    props.onChange({ type: "onNodeEffectChanged", data: { filter: { apply: "text", id: filterId } } });
    updateEffect(filterId);
  }

  let bgColor = props?.node?.options?.backgroundColor.split('-');
  bgColor = bgColor ? bgColor.length > 1 ? bgColor[1] : bgColor[0] : null;

  return (
    <div>
      <Grid container alignItems="flex-start" alignContent="flex-end" justify="space-between" spacing={1}>
        <Grid item xs={6}>
          <TextField
            id="txtNode"
            multiline
            variant="outlined"
            inputProps={{ style: { width: "100%", height: "140px", lineHeight: 1, fontFamily: fontFamily, textAlign: alignment, color: foregroundColor, fontSize: fontSize } }}
            className={classes.root}
            value={value}
            style={{ backgroundColor: bgColor }}
            onChange={(e) => { 
              // window.clearTimeout(window.updateText);
              // window.updateText = setTimeout(() => {
              //   console.log("now sending update", e.target.value);
                updateOptions({ text: e.target.value });
              // }, 2000);
            }}
            autoFocus
            onFocus={(e) => { 
              let self = e.target;
              setTimeout(function() { 
                self.selectionStart = self.selectionEnd = 10000;
              }, 0);
            }}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
        </Grid>
        <Grid item xs={4}>
          <Grid container className={classes.items}>
            <FormatAlignLeftIcon className={alignment === svgToHtmlAlign('start') ? classes.active : ""} onClick={() => { updateOptions({ textXAlign: "start" }) }} />
            <FormatAlignCenterIcon className={alignment === svgToHtmlAlign('middle') ? classes.active : ""} onClick={() => { updateOptions({ textXAlign: "middle" }) }} />
            <FormatAlignRightIcon className={alignment === svgToHtmlAlign('end') ? classes.active : ""} onClick={() => { updateOptions({ textXAlign: "end" }) }} />
            <Divider orientation="vertical" flexItem />
            <Select
              labelId="font-size-label"
              id="font-size"
              value={fontSize}
              onChange={(e) => { updateOptions({ fontSize: e.target.value }) }}
              label="Size">
              {fontSizes.map((f) => (
                <MenuItem key={f} value={f}>{f}</MenuItem>
              ))}
            </Select>
            <Divider orientation="vertical" flexItem />
            {/* Overrides the background color on the main.jsx */}
            <FontPicker
              apiKey={Meteor.settings.public.googleFontAPIKey}
              activeFontFamily={fontFamily}
              filter={filterFonts}
              onChange={(font) => updateOptions({ fontFamily: font.family })} />
            <Divider orientation="vertical" flexItem />
            <div style={{ width: '25px', height: '35px', backgroundColor: "#fff", border: "1px solid #000" }} onClick={() => { updateOptions({ fontColor: "#fff", textOpacity: 1 }) }} />
            <div style={{ width: '25px', height: '35px', backgroundColor: "#000", border: "1px solid #ccc" }} onClick={() => { updateOptions({ fontColor: "#000" , textOpacity: 1}) }} />
            <Divider flexItem />
            <ToggleButtonGroup
              value={selectedFilter}
              exclusive
              onChange={setEffect}
              aria-label="text effect"
            >
              {availEffects.map((e) => (
                <ToggleButton size="small" key={e} value={e} aria-label={e}>
                  {e}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

          </Grid>
        </Grid>
        {matches &&
          <Grid item xs={2}>
            <HexColor opacity={textOpacity} color={foregroundColor} onChange={(color, opacity) => { updateOptions({ fontColor: color, textOpacity: opacity }) }}/>
          </Grid>
        }
      </Grid>
    </div>
  );
}