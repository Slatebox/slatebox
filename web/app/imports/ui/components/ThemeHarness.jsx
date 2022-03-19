/* eslint-disable react/prop-types */
/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */
import Box from '@material-ui/core/Box'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import React, { useEffect } from 'react'
import { Slatebox } from 'slateboxjs'

const useStyles = makeStyles(() => ({
  slateTheme: {
    width: 'inherit',
    height: 'inherit',
    padding: '0 important',
    transition: 'all 500ms',
    '&:hover': {
      transform: 'scale(1.2)',
    },
  },
}))

export default function ThemeHarness({ theme, allowDrag, onSlateHover }) {
  const snap = React.useRef(null)
  const classes = useStyles()

  useEffect(() => {
    snap.current = new Slatebox.slate({
      container: `slate_${theme._id}`,
      containerStyle: {
        backgroundColor: theme.containerStyle.backgroundColor,
        backgroundEffect: theme.containerStyle.backgroundEffect,
        backgroundImage: theme.containerStyle.backgroundImage,
        backgroundSize: theme.containerStyle.backgroundSize,
        backgroundColorAsGradient:
          theme.containerStyle.backgroundColorAsGradient,
        backgroundGradientType: theme.containerStyle.backgroundGradientType,
        backgroundGradientColors: theme.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy:
          theme.containerStyle.backgroundGradientStrategy,
      },
      viewPort: {
        allowDrag: !!allowDrag,
        useInertiaScrolling: !!allowDrag,
      },
      defaultLineColor: theme.defaultLineColor,
      allowDrag: false,
      name: ``,
      description: ``,
      showbirdsEye: false,
      showLocks: false,
      showMultiSelect: false,
      showUndoRedo: false,
      showZoom: false,
      showAddNodes: false,
      collaboration: {
        allow: false,
      },
    }).init()

    let cols = 0
    let xPos = 5500
    let yPos = 5300
    const nodesPerRow = 5
    let totWidth = 0
    const pad = 175
    let dir = 1
    let lastNode = null
    Array.from({ length: 15 }).forEach((a, i) => {
      const styleId = i === 0 ? 'parent' : `child_${i}`
      const nodeStyle = theme.styles[styleId]
      const width = i === 0 ? 100 : 100
      const height = i === 0 ? 100 : 100
      totWidth += width
      const name = i === 0 ? 'P' : `${i}`
      cols += 1
      if (i % nodesPerRow === 0 && i > 0) {
        cols = 0
        if (dir === 1) {
          dir = -1
          xPos = 5500 + totWidth + nodesPerRow * pad
        } else {
          dir = 1
          xPos = 5500 + pad
        }
        totWidth = width
        yPos += height + pad
      }
      const x = xPos + cols * pad * dir + totWidth * dir
      const nodeOptions = {
        name: '',
        text: name,
        xPos: x,
        yPos,
        height,
        width,
      }
      Object.assign(nodeOptions, nodeStyle)
      nodeOptions.vectorPath = Slatebox.utils._transformPath(
        nodeStyle.vectorPath,
        `T${x},${yPos}`
      )
      nodeOptions.filters = nodeStyle.filters
      const node = new Slatebox.node(nodeOptions)
      snap.current.nodes.add(node)
      if (lastNode) {
        lastNode.relationships.addAssociation(node)
      }
      lastNode = node
    })
    snap.current.canvas.hideBg(1)
    snap.current.controller.scaleToFitAndCenter()
  }, [])

  return (
    <Box
      id={`slate_${theme._id}`}
      className={classes.slateTheme}
      onMouseEnter={(e) => {
        onSlateHover(snap.current)
      }}
    />
  )
}

ThemeHarness.propTypes = {
  theme: PropTypes.shape({
    styles: PropTypes.arrayOf(
      PropTypes.shape({
        vectorPath: PropTypes.shape,
        filters: PropTypes.node,
      })
    ),
    containerStyle: PropTypes.shape({
      backgroundColor: PropTypes.string,
      backgroundEffect: PropTypes.string,
      backgroundImage: PropTypes.string,
      backgroundSize: PropTypes.string,
      backgroundColorAsGradient: PropTypes.bool,
      backgroundGradientType: PropTypes.string,
      backgroundGradientColors: PropTypes.string,
      backgroundGradientStrategy: PropTypes.string,
    }),
    defaultLineColor: PropTypes.string,
  }).isRequired,
  allowDrag: PropTypes.bool.isRequired,
  onSlateHover: PropTypes.func.isRequired,
}
