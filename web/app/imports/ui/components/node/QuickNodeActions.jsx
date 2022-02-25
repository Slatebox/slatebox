import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import { useTheme } from '@material-ui/core/styles'
import useMediaQuery from '@material-ui/core/useMediaQuery'
import RadioGroup from '@material-ui/core/RadioGroup'
import Grid from '@material-ui/core/Grid'
import Tooltip from '@material-ui/core/Tooltip'
import SvgIcon from '@material-ui/core/SvgIcon'
import SpeedDial from '@material-ui/lab/SpeedDial'
import SpeedDialIcon from '@material-ui/lab/SpeedDialIcon'
import SpeedDialAction from '@material-ui/lab/SpeedDialAction'
import { defaultShapes } from './defaultShapes.js'
import chunk from 'lodash.chunk'
import cloneDeep from 'lodash.clonedeep'

import { Slatebox } from '../../../api/client/slatebox'

import Button from '@material-ui/core/Button'
import Divider from '@material-ui/core/Divider'
import ButtonGroup from '@material-ui/core/ButtonGroup'
import { HexColorPicker } from 'react-colorful'
import Typography from '@material-ui/core/Typography'
import IconButton from '@material-ui/core/IconButton'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'

export const QuickNodeActions = (props) => {
  const useStyles = makeStyles((theme) => ({
    speedDial: {
      position: 'fixed',
      bottom: theme.spacing(1),
      right: theme.spacing(1),
      alignItems: 'flex-end',
      '& .MuiSpeedDialAction-fab': {
        backgroundColor: 'transparent',
        cursor: 'pointer',
        '& .MuiSvgIcon-root': {
          transition: 'transform .1s',
          '&:hover': {
            transform: 'scale(1.3)',
          },
        },
      },
      '& .MuiSpeedDial-fab': {
        opacity: props.commentAccessOnly ? 0 : 1,
      },
      '& .MuiFab-root': {
        boxShadow: 'none',
      },
      '& .MuiFab-sizeSmall': {
        width: '250px',
        height: '50px',
      },
      '& .MuiSpeedDial-actions': {
        paddingBottom: '24px',
      },
    },
    buttonRoot: {
      backgroundColor: 'transparent',
      border: 0,
    },
  }))

  const dispatch = useDispatch()
  const classes = useStyles()
  const [actionMenuOpen, setActionMenuOpen] = React.useState(false)

  let baseOpts = cloneDeep(
    props.slate?.nodes?.allNodes[props.slate?.nodes?.allNodes.length - 1]
      ?.options
  ) || {
    backgroundColor: '#23aad6',
    foregroundColor: '#000',
    lineColor: '#333',
    lineWidth: 3,
  }

  const handleActionMenuOpen = (e) => {
    setActionMenuOpen(true)
  }

  const handleActionMenuClose = (e) => {
    setActionMenuOpen(false)
  }

  const addNode = (shape) => {
    let path = shape.path
    if (shape.key === 'addText' || shape.key === 'searchCustom') {
      path = defaultShapes.find((s) => s.key === 'rect').path
    } else if (shape.key === 'comment') {
      path = `M 2.7402 0.25 C 1.3817 0.25 0.2805 1.155 0.2805 2.2714 c 0 0.5665 0.2836 1.0784 0.7404 1.4454 c -0.0232 0.3369 -0.175 0.7774 -0.8208 0.7262 c 0 0 0.9442 0.5851 1.7462 -0.2578 c 0.2491 0.0698 0.5162 0.1077 0.7941 0.1077 c 1.3586 0 2.4598 -0.905 2.4598 -2.0214 S 4.0987 0.25 2.7402 0.25 z`
    }

    let xPos = 0
    let yPos = 0
    const snap = props.slate?.snapshot()
    if (props.slate?.nodes?.allNodes.length === 0) {
      xPos = 10000
      yPos = 10000
    } else {
      const orient = props.slate?.getOrientation()
      // height: 427
      // left: 5406.5
      // orientation: "landscape"
      // top: 4963
      // width: 455
      xPos = orient.left + orient.width + 20
      yPos = orient.top + orient.height / 2
      let z = props.slate?.options.viewPort.zoom.r
      xPos = xPos + (xPos / z - xPos)
      yPos = yPos + (yPos / z - yPos)
    }

    let nodeOpts = {}
    function setDimens(tString) {
      let bcopy = cloneDeep(baseOpts)
      let tpath = Slatebox.Utils.lowLevelTransformPath(path, tString)
      let pbox = Slatebox.utils.getBBox({ path: tpath })
      let iOpts = {
        text: '',
        xPos: xPos + pbox.width / 2 + 20,
        yPos: yPos + pbox.height / 2 + 20,
        height: pbox.height,
        width: pbox.width,
        vectorPath: tpath,
        allowMenu: true,
        allowDrag: true,
        opacity: 1,
        borderOpacity: 1,
        textOpacity: 1,
      }
      ;[
        'text',
        'groupId',
        'isComment',
        'id',
        'image',
        'xPos',
        'yPos',
        'height',
        'width',
        'vectorPath',
        'textBounds',
        'textOffset',
        'opacity',
        'borderOpacity',
        'textOpacity',
      ].forEach((p) => {
        delete bcopy[p]
      })
      Object.assign(iOpts, bcopy)
      iOpts.rotate.rotationAngle = 0
      return iOpts
    }

    if (shape.key === 'addText') {
      nodeOpts = setDimens(`T${xPos + 100},${yPos}s15,2`)
      nodeOpts.opacity = 0
      nodeOpts.borderOpacity = 0
      nodeOpts.textOpacity = 1
      nodeOpts.foregroundColor = '#000'
      nodeOpts.fontSize = nodeOpts.fontSize < 20 ? 20 : nodeOpts.fontSize
      dispatch({ type: 'nodedrawer', drawerTab: 1 })
    } else if (shape.key === 'searchCustom') {
      nodeOpts = setDimens(`T${xPos + 100},${yPos}s10,10`)
      nodeOpts.opacity = 0
      dispatch({ type: 'nodedrawer', drawerTab: 2 })
    } else if (shape.key === 'comment') {
      nodeOpts = setDimens(`T${xPos},${yPos}s8,8`)
      nodeOpts.borderOpacity = 1
      nodeOpts.isComment = true
      nodeOpts.disableMenuAsTemplate = false
      nodeOpts.disableDrag = false
      nodeOpts.borderWidth = 1
      nodeOpts.borderColor = '#000'
      nodeOpts.borderStyle = '-'
      nodeOpts.backgroundColor = '#B76C0D'
      nodeOpts.foregroundColor = '#fff'
      nodeOpts.textXAlign = 'middle'
      nodeOpts.text = '?'
      nodeOpts.fontSize = 20
      nodeOpts.fontFamily = 'Bangers'
      //nodeOpts.filters = { text: "outline" };
    } else {
      if (shape.key === 'line') {
        nodeOpts.borderWidth = 3
      }
      nodeOpts = setDimens(`T${xPos},${yPos}s6,6`)
    }

    const node = new Slatebox.Node(nodeOpts)

    props.slate?.nodes.add(node)

    //send collaboration info
    const pkg = {
      type: 'onNodeAdded',
      data: props.slate?.exportDifference(snap),
    }
    props.slate?.collab.send(pkg)

    node.position('center')

    // console.log("orient is ", orient);
    // props.slate?.canvas.move({
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

    props.onNodeCreated(node)
    setActionMenuOpen(false)
  }

  let customActions = [
    {
      key: 'searchCustom',
      text: 'Custom Shape',
    },
    {
      key: 'addText',
      text: 'Add Text',
    },
  ]

  if (Meteor.user()?.orgId) {
    customActions.push({
      key: 'comment',
      text: 'Add Comment',
    })
  }

  if (props.commentAccessOnly) {
    customActions = [
      {
        key: 'comment',
        text: 'Add Comment',
      },
    ]
  }

  const actionPaths = chunk(defaultShapes, 6).map((ds, i) => {
    return { row: i, shapes: ds }
  })
  let actionMenuStyle = actionMenuOpen
    ? {
        backgroundColor: '#fff',
        border: '1px solid #000',
        borderBottomRightRadius: '30px',
        borderTopLeftRadius: '10px',
      }
    : {}

  if (props.commentAccessOnly) {
    actionMenuStyle = { marginRight: '-50px' }
  }

  function MappedShapes(row) {
    return (
      <Grid container spacing={0}>
        {row.shapes.map((shape) => (
          <Grid key={shape.key} item xs={2}>
            <Tooltip title={shape.name} placement="top" aria-label={shape.key}>
              <SvgIcon
                style={{ color: baseOpts.backgroundColor, fontSize: 42 }}
                onClick={() => {
                  addNode(shape)
                }}
              >
                <path strokeWidth="1px" stroke="#000" d={shape.path} />
              </SvgIcon>
            </Tooltip>
          </Grid>
        ))}
      </Grid>
    )
  }

  return (
    <div>
      <SpeedDial
        ariaLabel={
          props.commentAccessOnly
            ? 'Slatebox - comment'
            : 'Slatebox - quickly add a node'
        }
        className={classes.speedDial}
        hidden={false}
        icon={<SpeedDialIcon />}
        onClose={handleActionMenuClose}
        onOpen={handleActionMenuOpen}
        open={props.commentAccessOnly ? true : actionMenuOpen}
        style={actionMenuStyle}
        direction="up"
      >
        {!props.commentAccessOnly &&
          actionPaths.map((action) => (
            <SpeedDialAction
              key={action.row}
              tooltipTitle=""
              icon={<MappedShapes {...action} />}
            />
          ))}
        <SpeedDialAction
          key="buttons"
          tooltipTitle=""
          icon={
            <Grid container justify="center" alignItems="center">
              {customActions.map((c) => (
                <Grid key={c.key} item xs={4}>
                  <Button
                    variant="outlined"
                    color="secondary"
                    style={{ height: '47px', width: '90%' }}
                    onClick={() => {
                      addNode(c)
                    }}
                  >
                    <Typography variant="caption">{c.text}</Typography>
                  </Button>
                </Grid>
              ))}
            </Grid>
          }
        />
      </SpeedDial>
    </div>
  )
}
