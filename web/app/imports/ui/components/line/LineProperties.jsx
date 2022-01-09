import React, { useEffect, useState } from 'react';
import { useTheme } from '@material-ui/core/styles';
import { makeStyles, withStyles } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import { HexColor } from "../../common/HexColor.jsx"
import { PresetColors } from '../../common/PresetColors.jsx';
import Slider from '@material-ui/core/Slider';
import { Typography } from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';
import Tooltip from '@material-ui/core/Tooltip';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import ArrowForwardIcon from '@material-ui/icons/ArrowForward';
import Divider from '@material-ui/core/Divider';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemText from '@material-ui/core/ListItemText';
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction';

const useStyles = makeStyles((theme) => ({
  slider: {
    width: 350
    // "& .MuiSlider-root": {
    //   color: "#fff"
    // },
    // "& .MuiSlider-thumb": {
    //   color: "#000"
    // }
  }
}));

export const LineProperties = (props) => {

  const theme = useTheme();
  const classes = useStyles();
  const matches = useMediaQuery(theme.breakpoints.up('md'));

  let bColor = props?.node?.options?.lineColor;
  bColor = bColor ? bColor : "#000";

  let lwidth = props?.node?.options?.lineWidth;
  lwidth = lwidth ? lwidth : 5;

  let lOpacity = props?.node?.options?.lineOpacity || 1;

  let parentArrowForChildren = [...new Set(props?.node?.options?.parentArrowForChildren)];
  let noChildArrowForChildren =  [...new Set(props?.node?.options?.noChildArrowForChildren)];

  let parentArrow = parentArrowForChildren?.includes(props?.association?.child.options.id);
  let childArrowExcept = noChildArrowForChildren?.includes(props?.association?.child.options.id);
  let allArrows = [];
  if (parentArrow) allArrows.push('parent');
  if (!childArrowExcept) allArrows.push('child');
  
  console.log("parent children ", parentArrowForChildren, noChildArrowForChildren);

  const [bgColor, updateColor] = React.useState(bColor);
  const [lineOpacity, updateOpacity] = React.useState(lOpacity);
  const [lineWidth, updateLineWidth] = React.useState(lwidth);
  const [arrowTypes, updateArrows] = React.useState(allArrows);
 
  // const [showParentArrow, toggleParentArrow] = React.useState(parentArrow);
  // const [showChildArrow, toggleChildArrow] = React.useState(childArrow);

  const setColor = (color, opacity) => {
    const index = props?.node?.relationships?.associations.findIndex(a => a.id === props.association.id);
    if (color !== bColor) {
      const data = { val: color, prop: "lineColor", associationId: props.association.id, index: index };
      props.onChange({ type: "onLinePropertiesChanged", data });
      updateColor(color);
    } else if (opacity != lOpacity) {
      const data = { val: opacity, prop: "lineOpacity", associationId: props.association.id, index: index };
      props.onChange({ type: "onLinePropertiesChanged", data });
      updateOpacity(opacity);
    }
  }

  const setLineWidth = (e, width) => {
    const index = props?.node?.relationships?.associations.findIndex(a => a.id === props.association.id);
    console.log("width is ", e.target.value, width);
    const data = { val: width, prop: "lineWidth", associationId: props.association.id, index: index };
    props.onChange({ type: "onLinePropertiesChanged", data });
    updateLineWidth(width);
  }

  const toggleArrows = (e, arrows) => {
    console.log("arrows ", arrows);
    const index = props?.node?.relationships?.associations.findIndex(a => a.id === props.association.id);
    const parentArrowIndex = parentArrowForChildren.indexOf(props.association.child.options.id);
    const childArrowExceptionIndex = noChildArrowForChildren.indexOf(props.association.child.options.id);

    if (arrows.includes("parent")) {
      parentArrowForChildren.push(props.association.child.options.id);
    } else if (parentArrowIndex > -1) {
      parentArrowForChildren.splice(parentArrowIndex, 1);
    }

    //this should REMOVE the child to the exception list
    if (arrows.includes("child") && childArrowExceptionIndex > -1) {
      noChildArrowForChildren.splice(childArrowExceptionIndex, 1);
    } else if (!arrows.includes("child")) {
      //otherwise always add the child
      noChildArrowForChildren.push(props.association.child.options.id);
    }

    console.log("will send parent children ", parentArrowForChildren, noChildArrowForChildren, parentArrowIndex, childArrowExceptionIndex);

    const pkgs = [
      { prop: "showParentArrow", val: arrows.includes("parent"), index: index, associationId: props.association.id, updateChild: true, options: { parentArrowForChildren: parentArrowForChildren } },
      { prop: "showChildArrow", val: arrows.includes("child"), index: index, associationId: props.association.id, options: { noChildArrowForChildren: noChildArrowForChildren } }
    ];

    props.onChange({ type: "onLinePropertiesChanged", data: pkgs });

    updateArrows(arrows);
  };

  // changeLineWidth: function(pkg) {
  //   var cn = self.slate.nodes.one(pkg.data.id);
  //   cn.lineOptions.set(pkg.data);
  //   self.addMessage(pkg, 'That was me\n changing the line width!');
  // },

  // toggleParentArrow: function(pkg) {
  //   var cn = self.slate.nodes.one(pkg.data.id);
  //   Object.assign(cn.options, pkg.data.options);
  //   cn.lineOptions.set(pkg.data);
  //   self.addMessage(pkg, 'That was me\n adding the arrow!');
  // },

  // toggleChildArrow: function(pkg) {
  //   var cn = self.slate.nodes.one(pkg.data.id);
  //   Object.assign(cn.options, pkg.data.options);
  //   cn.lineOptions.set(pkg.data);
  //   self.addMessage(pkg, 'That was me\n adding the arrow!');
  // },


  // var onDone = function (width) {
  //   var _data = { val: parseInt(Math.max(width, 1)), prop: "lineWidth", index: self.#_index(c.id) };
  //   self.set(_data);
  //   self.#broadcast({ type: "changeLineWidth", data: _data });
  //   self.node.setEndDrag();
  //   this.scale(1 / Math.sqrt(zoomScalar));
  // };

  // var _data = { prop: "showParentArrow", index: self.#_index(c.id), updateChild: true, options: { parentArrowForChildren: self.node.options.parentArrowForChildren } };
  // var parentArrowIndex = indexOf(self.node.options.parentArrowForChildren, c.child.options.id);
  // if (parentArrowIndex < 0) {
  //   self.node.options.parentArrowForChildren.push(c.child.options.id);
  //   _data.val = true;
  // } else {
  //   self.node.options.parentArrowForChildren.splice(parentArrowIndex, 1);
  //   _data.val = false;
  // }

  // self.set(_data);
  // self.#broadcast({ type: "toggleParentArrow", data: _data });


  //   var _data = { prop: "showChildArrow", index: self.#_index(c.id), options: { noChildArrowForChildren: self.node.options.noChildArrowForChildren } };
  //   const childArrowExceptionIndex = indexOf(self.node.options.noChildArrowForChildren, c.child.options.id);
  //   if (childArrowExceptionIndex < 0) {
  //     self.node.options.noChildArrowForChildren.push(c.child.options.id);
  //     _data.val = false;
  //   } else {
  //     self.node.options.noChildArrowForChildren.splice(childArrowExceptionIndex, 1);
  //     _data.val = true;
  //   }

  //   self.set(_data);
  //   self.#broadcast({ type: "toggleChildArrow", data: _data });

  return (
    <Grid container alignItems="center" justify="center" spacing={2}>
      <Grid item>
        <HexColor
          opacity={lineOpacity}
          color={bgColor}
          onChange={setColor} />
      </Grid>
      <Grid item>
        <PresetColors onColorChange={(color) => { setColor(color) }} />
      </Grid>
      <Grid item>
        <List component="nav" aria-label="line options">
          <ListItem divider>
            <ListItemText primary="Width" />
            &nbsp;&nbsp;
            <Slider
              className={classes.slider}
              defaultValue={lineWidth}
              step={1}
              marks
              min={3}
              max={30}
              color="secondary"
              valueLabelDisplay="auto"
              onChange={setLineWidth} />
          </ListItem>
          <ListItem>
            <ListItemText primary="Arrow Heads" />
            <ToggleButtonGroup
              value={arrowTypes}
              onChange={toggleArrows}
              aria-label="toggle line arrows"
            >
              <ToggleButton value="parent" aria-label="parent">
                <ArrowBackIcon htmlColor={bgColor} />
              </ToggleButton>
              <ToggleButton value="child" aria-label="child">
                <ArrowForwardIcon htmlColor={bgColor} />
              </ToggleButton>
            </ToggleButtonGroup>
          </ListItem>
        </List>
      </Grid>
    </Grid>
  );
}