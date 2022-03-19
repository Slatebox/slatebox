/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import Tooltip from '@material-ui/core/Tooltip'
import SvgIcon from '@material-ui/core/SvgIcon'
import SpeedDial from '@material-ui/lab/SpeedDial'
import SpeedDialIcon from '@material-ui/lab/SpeedDialIcon'
import SpeedDialAction from '@material-ui/lab/SpeedDialAction'
import chunk from 'lodash.chunk'
import cloneDeep from 'lodash.clonedeep'
import Button from '@material-ui/core/Button'
import Typography from '@material-ui/core/Typography'
import { Slatebox } from 'slateboxjs'
import defaultShapes from './defaultShapes'
import slateProps from '../../propTypes/slatePriops'

export default function QuickNodeActions({
  commentAccessOnly,
  slate,
  onNodeCreated,
}) {
  const chatOpen = useSelector((state) => state.chatOpen)
  const rightSpace = chatOpen ? 27 : 1
  const useStyles = makeStyles((theme) => ({
    speedDial: {
      position: 'fixed',
      bottom: theme.spacing(1),
      right: theme.spacing(rightSpace),
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
        opacity: commentAccessOnly ? 0 : 1,
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

  const nodeLength = slate?.nodes?.allNodes.length || 0

  const baseOpts = cloneDeep(
    slate?.nodes?.allNodes[nodeLength - 1]?.options
  ) || {
    backgroundColor: '#23aad6',
    foregroundColor: '#000',
    lineColor: '#333',
    lineWidth: 3,
  }

  const handleActionMenuOpen = () => {
    setActionMenuOpen(true)
  }

  const handleActionMenuClose = () => {
    setActionMenuOpen(false)
  }

  const addNode = (shape) => {
    let { path } = shape
    if (shape.key === 'addText' || shape.key === 'searchCustom') {
      path = defaultShapes.find((s) => s.key === 'rect').path
    } else if (shape.key === 'comment') {
      path = `M 2.7402 0.25 C 1.3817 0.25 0.2805 1.155 0.2805 2.2714 c 0 0.5665 0.2836 1.0784 0.7404 1.4454 c -0.0232 0.3369 -0.175 0.7774 -0.8208 0.7262 c 0 0 0.9442 0.5851 1.7462 -0.2578 c 0.2491 0.0698 0.5162 0.1077 0.7941 0.1077 c 1.3586 0 2.4598 -0.905 2.4598 -2.0214 S 4.0987 0.25 2.7402 0.25 z`
    }

    let xPos = 0
    let yPos = 0
    const snap = slate?.snapshot()
    if (slate?.nodes?.allNodes.length === 0) {
      xPos = 10000
      yPos = 10000
    } else {
      const orient = slate?.getOrientation()
      // height: 427
      // left: 5406.5
      // orientation: "landscape"
      // top: 4963
      // width: 455
      xPos = orient.left + orient.width + 20
      yPos = orient.top + orient.height / 2
      const z = slate?.options.viewPort.zoom.r
      xPos += xPos / z - xPos
      yPos += yPos / z - yPos
    }

    let nodeOpts = {}
    function setDimens(tString) {
      const bcopy = cloneDeep(baseOpts)
      const tpath = Slatebox.utils._transformPath(path, tString)
      const pbox = Slatebox.utils.getBBox({ path: tpath })
      const iOpts = {
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
    } else {
      if (shape.key === 'line') {
        nodeOpts.borderWidth = 3
      }
      nodeOpts = setDimens(`T${xPos},${yPos}s6,6`)
    }

    const node = new Slatebox.node(nodeOpts)

    slate?.nodes.add(node)

    // send collaboration info
    const pkg = {
      type: 'onNodeAdded',
      data: slate?.exportDifference(snap),
    }
    slate?.collab.send(pkg)

    node.position('center')

    onNodeCreated(node)
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

  if (commentAccessOnly) {
    customActions = [
      {
        key: 'comment',
        text: 'Add Comment',
      },
    ]
  }

  const actionPaths = chunk(defaultShapes, 6).map((ds, i) => ({
    row: i,
    shapes: ds,
  }))
  let actionMenuStyle = actionMenuOpen
    ? {
        backgroundColor: '#fff',
        border: '1px solid #000',
        borderBottomRightRadius: '30px',
        borderTopLeftRadius: '10px',
      }
    : {}

  if (commentAccessOnly) {
    actionMenuStyle = { marginRight: '-50px' }
  }

  // eslint-disable-next-line react/no-unstable-nested-components
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

  QuickNodeActions.propTypes = {
    slate: slateProps.isRequired,
    commentAccessOnly: PropTypes.func.isRequired,
    onNodeCreated: PropTypes.func.isRequired,
  }

  return (
    <div>
      <SpeedDial
        ariaLabel={
          commentAccessOnly
            ? 'Slatebox - comment'
            : 'Slatebox - quickly add a node'
        }
        className={classes.speedDial}
        hidden={false}
        icon={<SpeedDialIcon />}
        onClose={handleActionMenuClose}
        onOpen={handleActionMenuOpen}
        open={commentAccessOnly ? true : actionMenuOpen}
        style={actionMenuStyle}
        direction="up"
      >
        {!commentAccessOnly &&
          actionPaths.map((action) => (
            <SpeedDialAction
              key={action.row}
              tooltipTitle=""
              // eslint-disable-next-line react/jsx-props-no-spreading
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
