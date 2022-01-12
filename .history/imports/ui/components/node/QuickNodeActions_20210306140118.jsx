import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import RadioGroup from '@material-ui/core/RadioGroup';
import Grid from '@material-ui/core/Grid';
import Tooltip from '@material-ui/core/Tooltip';
import SvgIcon from '@material-ui/core/SVGIcon';
import SpeedDial from '@material-ui/lab/SpeedDial';
import SpeedDialIcon from '@material-ui/lab/SpeedDialIcon';
import SpeedDialAction from '@material-ui/lab/SpeedDialAction';
import { defaultShapes } from './defaultShapes.js';
import chunk from 'lodash.chunk';

import { Slatebox } from 'slatebox';

import Button from '@material-ui/core/Button';
import ButtonGroup from '@material-ui/core/ButtonGroup';
import { HexColorPicker } from "react-colorful";

const useStyles = makeStyles((theme) => ({
  speedDial: {
    position: 'fixed',
    bottom: theme.spacing(1),
    right: theme.spacing(1),
    alignItems: "flex-end",
    "& .MuiSpeedDialAction-fab": {
      backgroundColor: "transparent",
      cursor: "pointer",
      "& .MuiSvgIcon-root": {
        transition: "transform .1s",
        "&:hover": {
          transform: "scale(1.3)"
        }
      }
    },
    "& .MuiFab-root": {
      boxShadow: "none"
    },
    "& .MuiFab-sizeSmall": {
      width: "250px",
      height: "20px"
    }
  },
  buttonRoot: {
    backgroundColor: "transparent",
    border: 0
  }
}));

export const QuickNodeActions = (props) => {

  const classes = useStyles();

  const [actionMenuOpen, setActionMenuOpen] = React.useState(false);

  const handleActionMenuOpen = (e) => {
    setActionMenuOpen(true);
  }

  const handleActionMenuClose = (e) => {
    setActionMenuOpen(false);
  }

  const addNode = (path) => {
    
    const snap = props.slate.snapshot();
    const orient = props.slate.getOrientation();
    // height: 427
    // left: 5406.5
    // orientation: "landscape"
    // top: 4963
    // width: 455
    const xPos = orient.left + orient.width + 20;
    const yPos = orient.top + (orient.height / 2);

    let tpath = Slatebox.utils._transformPath(path, `T${xPos},${yPos}s6,6`);

    console.log("x y", path, xPos, yPos);
    let pbox = Slatebox.utils.getBBox(tpath);

    const nodeOpts = {
      text: ''
      , xPos: xPos
      , yPos: yPos
      , height: pbox.height
      , width: pbox.width
      , vectorPath: tpath
      , backgroundColor: "#23aad6"
      , foregroundColor: "#000"
      , lineColor: "#333"
      , lineWidth: 3
    };
    const node = new Slatebox.node(nodeOpts);

    props.slate.nodes.add(node);

    //send collaboration info
    const pkg = { type: 'onNodeAdded', data: props.slate.exportDifference(snap) };
    props.slate.collab.send(pkg);

    console.log("sent node collab");

    node.position("center", () => {
      node.mark();
    })

    // console.log("orient is ", orient);
    // props.slate.canvas.move({ 
    //   x: 60
    //   , dur: 500
    //   , isAbsolute: false
    //   , callbacks: {
    //     after: () => {
    //       console.log("add node")
    //     }
    //   } 
    // });

    // _self._.position('center', function () {
    //   _self._.editor && _self._.editor.start();
    // });

    props.onNodeCreated(node);

    setActionMenuOpen(false);
  }

  let allShapes = [...defaultShapes, {
    key: "searchCustom",
    name: "Search For Custom Shape",
    path: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
  }];

  const actionPaths = chunk(allShapes, 6).map((ds, i) => { return { row: i, shapes: ds } });

  console.log("actionpaths are now ", actionPaths);

  function MappedShapes(row) {
    return (
      <Grid container>
        {row.shapes.map((shape) => (
          <Grid item xs={2}>
            {shape.key === "searchCustom" ?
              <Tooltip title="Search For Custom Shape" placement="top" aria-label="searchForCustomShape">
                <SvgIcon color="primary" style={{ "fontSize": 36 }} onClick={(e) => { addNode(shape.path); }}>
                  <path stroke-width="1px" stroke="#000" d={shape.path} />
                </SvgIcon>
              </Tooltip>
              :
              <SvgIcon color="secondary" style={{ "fontSize": 36 }} onClick={(e) => { addNode(shape.path); }}>
                <path stroke-width="1px" stroke="#000" d={shape.path} />
              </SvgIcon>
            }
          </Grid>
        ))}
      </Grid>
    )
  }

  console.log("action menu open ", actionMenuOpen);

  return (
    <div>
      <SpeedDial
        ariaLabel="Slatebox - quickly add a node"
        className={classes.speedDial}
        hidden={false}
        icon={<SpeedDialIcon />}
        onClose={handleActionMenuClose}
        onOpen={handleActionMenuOpen}
        open={actionMenuOpen}
        direction="up"
      >
        {actionPaths.map((action) => (
          <SpeedDialAction
            key={action.row}
            tooltipTitle=""
            icon={<MappedShapes {...action} />}
          />
        ))}
      </SpeedDial>
    </div>
  )
}