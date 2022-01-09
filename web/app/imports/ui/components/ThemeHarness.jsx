import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import { makeStyles } from '@material-ui/core/styles';
import React, { useEffect, useRef, Component } from 'react';
import { Slatebox } from '../../api/client/slatebox';
import { CONSTANTS } from '../../api/common/constants';
import merge from 'deepmerge';

const useStyles = makeStyles((theme) => ({
  slateTheme: {
    width: "inherit", 
    height: "inherit", 
    padding: "0 important",
    transition: "all 500ms",
    "&:hover": {
      transform: "scale(1.2)"
    }
  }
}));


export const ThemeHarness = (props) => {

  const snap = React.useRef(null);
  const classes = useStyles();

  useEffect(() => {
    snap.current = new Slatebox.slate({
      container: `slate_${props.theme._id}`
      , containerStyle: {
        backgroundColor: props.theme.containerStyle.backgroundColor,
        backgroundEffect: props.theme.containerStyle.backgroundEffect,
        backgroundImage: props.theme.containerStyle.backgroundImage,
        backgroundSize: props.theme.containerStyle.backgroundSize,
        backgroundColorAsGradient: props.theme.containerStyle.backgroundColorAsGradient,
        backgroundGradientType: props.theme.containerStyle.backgroundGradientType,
        backgroundGradientColors: props.theme.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy: props.theme.containerStyle.backgroundGradientStrategy
      }
      , viewPort: { allowDrag: !!props.allowDrag, useInertiaScrolling: !!props.allowDrag }
      , defaultLineColor: props.theme.defaultLineColor
      , allowDrag: false
      , name: ``
      , description: ``
      , showbirdsEye: false
      , showLocks: false
      , showMultiSelect: false
      , showUndoRedo: false
      , showZoom: false
      , showAddNodes: false
      , collaboration: {
        allow: false
      }
    }).init();

    // "image" : "",
    // "nodeColor" : "#2196f3",
    // "opacity" : 1,
    // "borderOpacity" : 1,
    // "borderColor" : "#000",
    // "borderStyle" : "solid",
    // "borderWidth" : 2,
    // "lineColor" : "#333",
    // "lineOpacity" : 1,
    // "lineEffect" : "",
    // "lineWidth" : 5,
    // "textOpacity" : 1,
    // "foregroundColor" : "#000",
    // "fontSize" : 20,
    // "fontFamily" : "Roboto",
    // "fontStyle" : "normal",
    // "filters" : {
    //   "vect" : null,
    //   "text" : null,
    //   "line" : null
    // }

    // 5500 + 175, 5500 + (175 * 2) + 20

    let cols = 0;
    let xPos = 5500;
    let yPos = 5300;
    let nodesPerRow = 5;
    let totWidth = 0;
    let pad = 175;
    let dir = 1;
    let lastNode = null;
    Array.from({ length: 15 }).forEach((a, i) => {
      const styleId = i === 0 ? "parent" : `child_${i}`
      const nodeStyle = props.theme.styles[styleId];
      // neutralize the path position in prep for sending to other nodes
      // const shape = nodeStyle. i === 0 ? "ellipse" : "ellipse";
      const width = i === 0 ? 100 : 100;
      const height = i === 0 ? 100 : 100;
      totWidth += width;
      const name = i === 0 ? "P" : `${i}`;
      cols++;
      if (i % nodesPerRow === 0 && i > 0) {
        cols = 0;
        if (dir === 1) {
          dir = -1;
          xPos = 5500 + totWidth + (nodesPerRow * pad);
        } else {
          dir = 1;
          xPos = 5500 + pad;
        }
        totWidth = width;
        yPos += height + pad;
      }
      let x = xPos + (cols * pad * dir) + (totWidth * dir);
      // delete nodeStyle.vectorPath;
      const nodeOptions = {
        name: ""
        , text: name
        , xPos: x
        , yPos: yPos
        , height: height
        , width: width
      };
      Object.assign(nodeOptions, nodeStyle);
      nodeOptions.vectorPath = Slatebox.utils._transformPath(nodeStyle.vectorPath, `T${x},${yPos}`);
      nodeOptions.filters = nodeStyle.filters;
      const node = new Slatebox.node(nodeOptions);
      snap.current.nodes.add(node);
      if (lastNode) {
        lastNode.relationships.addAssociation(node);
      }
      lastNode = node;
    });

    // [{ children: 12, start: [5500, 5300] }].forEach((s) => {
    //   let yPad = 0;
    //   let xPad = -2;
    //   let xMulti = 1;
    //   let rows = 0;
    //   let dir = "right";
    //   Array.from({ length: s.children }).forEach((u, i) => {
    //     console.log("i is ", i);
    //     const shape = i === 0 ? "roundedrectangle" : "ellipse";
    //     const width = i === 0 ? 175 : 100;
    //     const height = i === 0 ? 100 : 100;
    //     const name = i === 0 ? "Parent" : `Child ${i}`;
    //     const styleId = i === 0 ? "parent" : `child_${i}`
    //     const nodeStyle = props.theme.styles[styleId];

    //     if (i % 5 === 0 && i > 0) {
    //       rows++;
    //       if (dir === "right") {
    //         dir = "left";
    //       }
    //       xMulti = -1;
    //       yPad = (height * rows) + 50;
    //       xPad = -1;
    //       if (dir === "left") {
    //         s.start[0] = 5500 + (5 * 150);
    //       } else {
    //         s.start[0] = 5500;
    //       }
    //     }
    //     xPad++;


    //   });
    // });
    // snap.current.toggleFilters(true);
    snap.current.canvas.hideBg(1);
    snap.current.controller.scaleToFitAndCenter();
    // snap.canvas.hideBg(100);

    // setTimeout(() => {
    // //  snap.canvas.refreshBackground();
    // // snap.controller.scaleToFitAndCenter();
    // }, 100);    

  }, []);

  // setTimeout(() => {
  //   document.getElementById(`slate_${props.theme._id}`).appendChild(new Node()
      
  //   );
  // }, 100);

  let sx = {};
  return ( 
    <Box id={`slate_${props.theme._id}`} className={classes.slateTheme} onMouseEnter={
      (e) => { 
        props.onSlateHover(snap.current)
      }
    }>
    </Box>);
}