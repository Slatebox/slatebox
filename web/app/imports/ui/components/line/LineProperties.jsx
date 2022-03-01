import React from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import Slider from '@material-ui/core/Slider'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import ArrowBackIcon from '@material-ui/icons/ArrowBack'
import ArrowForwardIcon from '@material-ui/icons/ArrowForward'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemText from '@material-ui/core/ListItemText'
import PresetColors from '../../common/PresetColors'
import HexColor from '../../common/HexColor'
import nodeProps from '../../propTypes/nodeProps'
import associationProps from '../../propTypes/associationProps'

const useStyles = makeStyles(() => ({
  slider: {
    width: 350,
  },
}))

export default function LineProperties({ node, association, onChange }) {
  const classes = useStyles()

  let bColor = node?.options?.lineColor
  bColor = bColor || '#000'

  let lwidth = node?.options?.lineWidth
  lwidth = lwidth || 5

  const lOpacity = node?.options?.lineOpacity || 1

  const parentArrowForChildren = [
    ...new Set(node?.options?.parentArrowForChildren),
  ]
  const noChildArrowForChildren = [
    ...new Set(node?.options?.noChildArrowForChildren),
  ]

  const parentArrow = parentArrowForChildren?.includes(
    association?.child.options.id
  )

  const childArrowExcept = noChildArrowForChildren?.includes(
    association?.child.options.id
  )

  const allArrows = []
  if (parentArrow) allArrows.push('parent')
  if (!childArrowExcept) allArrows.push('child')

  const [bgColor, updateColor] = React.useState(bColor)
  const [lineOpacity, updateOpacity] = React.useState(lOpacity)
  const [lineWidth, updateLineWidth] = React.useState(lwidth)
  const [arrowTypes, updateArrows] = React.useState(allArrows)

  const setColor = (color, opacity) => {
    const index = node?.relationships?.associations.findIndex(
      (a) => a.id === association.id
    )
    if (color !== bColor) {
      const data = {
        val: color,
        prop: 'lineColor',
        associationId: association.id,
        index,
      }
      onChange({ type: 'onLinePropertiesChanged', data })
      updateColor(color)
    } else if (opacity !== lOpacity) {
      const data = {
        val: opacity,
        prop: 'lineOpacity',
        associationId: association.id,
        index,
      }
      onChange({ type: 'onLinePropertiesChanged', data })
      updateOpacity(opacity)
    }
  }

  const setLineWidth = (e, width) => {
    const index = node?.relationships?.associations.findIndex(
      (a) => a.id === association.id
    )
    const data = {
      val: width,
      prop: 'lineWidth',
      associationId: association.id,
      index,
    }
    onChange({ type: 'onLinePropertiesChanged', data })
    updateLineWidth(width)
  }

  const toggleArrows = (e, arrows) => {
    const index = node?.relationships?.associations.findIndex(
      (a) => a.id === association.id
    )
    const parentArrowIndex = parentArrowForChildren.indexOf(
      association.child.options.id
    )
    const childArrowExceptionIndex = noChildArrowForChildren.indexOf(
      association.child.options.id
    )

    if (arrows.includes('parent')) {
      parentArrowForChildren.push(association.child.options.id)
    } else if (parentArrowIndex > -1) {
      parentArrowForChildren.splice(parentArrowIndex, 1)
    }

    // this should REMOVE the child to the exception list
    if (arrows.includes('child') && childArrowExceptionIndex > -1) {
      noChildArrowForChildren.splice(childArrowExceptionIndex, 1)
    } else if (!arrows.includes('child')) {
      // otherwise always add the child
      noChildArrowForChildren.push(association.child.options.id)
    }

    const pkgs = [
      {
        prop: 'showParentArrow',
        val: arrows.includes('parent'),
        index,
        associationId: association.id,
        updateChild: true,
        options: { parentArrowForChildren },
      },
      {
        prop: 'showChildArrow',
        val: arrows.includes('child'),
        index,
        associationId: association.id,
        options: { noChildArrowForChildren },
      },
    ]

    onChange({ type: 'onLinePropertiesChanged', data: pkgs })

    updateArrows(arrows)
  }

  LineProperties.propTypes = {
    onChange: PropTypes.func.isRequired,
    node: nodeProps,
    association: associationProps,
  }

  LineProperties.defaultProps = {
    node: null,
    association: null,
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2}>
      <Grid item>
        <HexColor opacity={lineOpacity} color={bgColor} onChange={setColor} />
      </Grid>
      <Grid item>
        <PresetColors
          onColorChange={(color) => {
            setColor(color)
          }}
        />
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
              onChange={setLineWidth}
            />
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
  )
}
