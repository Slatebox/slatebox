/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-nested-ternary */
/* eslint-disable react/prop-types */
import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import Tooltip from '@material-ui/core/Tooltip'
import Brightness1Icon from '@material-ui/icons/Brightness1'
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemText from '@material-ui/core/ListItemText'
import Slider from '@material-ui/core/Slider'
import ButtonGroup from '@material-ui/core/ButtonGroup'
import Button from '@material-ui/core/Button'
import Popper from '@material-ui/core/Popper'
import Grow from '@material-ui/core/Grow'
import Paper from '@material-ui/core/Paper'
import ClickAwayListener from '@material-ui/core/ClickAwayListener'
import MenuList from '@material-ui/core/MenuList'
import MenuItem from '@material-ui/core/MenuItem'
import HexColor from '../../common/HexColor'
import PresetColors from '../../common/PresetColors'
import nodeProps from '../../propTypes/nodeProps'

export default function NodeColor({ onChange, node }) {
  let nColor = node?.options?.backgroundColor?.split('-')
  nColor = nColor ? (nColor.length > 1 ? nColor[1] : nColor[0]) : '#fff'

  const bColor = node?.options?.borderColor || '#000'

  const [bgColor, updateColor] = React.useState(nColor)
  const [bgOpacity, updateOpacity] = React.useState(node?.options?.opacity)
  const [backgroundOrBorder, propChanged] = React.useState('background')

  const setColor = (color, opacity) => {
    switch (backgroundOrBorder) {
      case 'border': {
        const prop =
          color === node?.options?.borderColor ? 'borderOpacity' : 'borderColor'
        const val = prop === 'borderOpacity' ? opacity : color
        onChange({
          type: 'onNodeBorderPropertiesChanged',
          data: { val, prop },
        })
        break
      }
      case 'background': {
        onChange({
          type: 'onNodeColorChanged',
          data: { opacity, color },
        })
        break
      }
      default:
        break
    }
    updateOpacity(opacity)
    updateColor(color)
  }

  const changeProp = (e, newProp) => {
    const bgc =
      newProp === 'border'
        ? node?.options?.borderColor
        : node?.options?.backgroundColor
    const bgo =
      newProp === 'border'
        ? node?.options?.borderOpacity
        : node?.options?.opacity
    updateOpacity(bgo)
    updateColor(bgc)
    propChanged(newProp)
  }

  const setBorderProp = (val, prop) => {
    onChange({
      type: 'onNodeBorderPropertiesChanged',
      data: { val, prop },
    })
  }

  const borderStyles = [
    { r: null, s: null, l: 'solid' },
    { r: '-', s: [3, 1], l: 'dashed' },
    { r: '.', s: [1, 1], l: 'dotted' },
    { r: '--.', s: [8, 3, 1, 3], l: 'combo' },
    // { r: "-..", s: [3, 1, 1, 1, 1, 1] },
    // { r: ". ", s: [1, 3] },
    // { r: "- ", s: [4, 3] },
    // { r: "--", s: [8, 3] },
    // { r: "- .", s: [4, 3, 1, 3] },
    // { r: "--.", s: [8, 3, 1, 3] },
    // { r: "--..", s: [8, 3, 1, 3, 1, 3] }
  ]

  const [borderOpen, setBorderOpen] = React.useState(false)
  const anchorRef = React.useRef(null)
  let borderIndex = borderStyles.findIndex(
    (b) => b.r === node?.options?.borderStyle
  )
  borderIndex = borderIndex > -1 ? borderIndex : 0
  const [selectedBorderIndex, setSelectedBorderIndex] =
    React.useState(borderIndex)

  const handleClick = () => {
    // nothing to do, already applied on item click
  }

  const onBorderChanged = (event, index) => {
    setSelectedBorderIndex(index)
    setBorderOpen(false)
    setBorderProp(borderStyles[index].r, 'borderStyle')
  }

  const borderToggle = () => {
    setBorderOpen((prevborderOpen) => !prevborderOpen)
  }

  const borderClose = (event) => {
    if (anchorRef.current && anchorRef.current.contains(event.target)) {
      return
    }

    setBorderOpen(false)
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={5}>
      <Grid item>
        <ToggleButtonGroup
          value={backgroundOrBorder}
          exclusive
          orientation="vertical"
          onChange={changeProp}
          aria-label="node color type changed"
        >
          <ToggleButton value="background" aria-label="background">
            <Tooltip title="Node Background" placement="top">
              <Grid container alignItems="center" justify="center">
                <Grid item>
                  <Brightness1Icon htmlColor={nColor} />
                </Grid>
                <Grid item style={{ fontSize: '7pt' }}>
                  Background
                </Grid>
              </Grid>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="border" aria-label="border">
            <Tooltip title="Node Border" placement="top">
              <Grid container alignItems="center" justify="center">
                <Grid item>
                  <Brightness1Icon htmlColor={bColor} />
                </Grid>
                <Grid item style={{ fontSize: '7pt' }}>
                  Border
                </Grid>
              </Grid>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid item>
        <HexColor
          opacity={bgOpacity}
          color={bgColor}
          onChange={setColor}
          alignItems="center"
          justify="flex-end"
        />
      </Grid>
      <Grid item>
        <PresetColors
          onColorChange={(color) => {
            setColor(color)
          }}
        />
      </Grid>
      <Grid item>
        <List component="nav" aria-label="border options">
          <ListItem divider>
            <ListItemText primary="Width" />
            &nbsp;&nbsp;
            <Slider
              style={{ width: '175px' }}
              defaultValue={node?.options?.borderWidth}
              step={1}
              marks
              min={1}
              max={30}
              color="secondary"
              disabled={backgroundOrBorder === 'background'}
              valueLabelDisplay="auto"
              onChange={(e, val) => {
                setBorderProp(val, 'borderWidth')
              }}
            />
          </ListItem>
          <ListItem>
            <ButtonGroup
              variant="contained"
              color="secondary"
              ref={anchorRef}
              aria-label="split button"
              disabled={backgroundOrBorder === 'background'}
            >
              <Button onClick={handleClick} disabled>
                Border: {borderStyles[selectedBorderIndex]?.l}
              </Button>
              <Button
                color="primary"
                size="small"
                aria-controls={borderOpen ? 'split-button-menu' : undefined}
                aria-expanded={borderOpen ? 'true' : undefined}
                aria-label="select border style"
                aria-haspopup="menu"
                onClick={borderToggle}
              >
                <ArrowDropDownIcon />
              </Button>
            </ButtonGroup>
            <Popper
              open={borderOpen}
              anchorEl={anchorRef.current}
              role={undefined}
              transition
              disablePortal
            >
              {({ TransitionProps, placement }) => (
                <Grow
                  {...TransitionProps}
                  style={{
                    transformOrigin:
                      placement === 'bottom' ? 'center top' : 'center bottom',
                  }}
                >
                  <Paper>
                    <ClickAwayListener onClickAway={borderClose}>
                      <MenuList id="split-button-menu">
                        {borderStyles.map((option, index) => (
                          <MenuItem
                            key={option.r}
                            selected={index === selectedBorderIndex}
                            onClick={(event) => onBorderChanged(event, index)}
                          >
                            <Tooltip title={option.l}>
                              <svg height="25" width="120">
                                <g stroke="#000" strokeWidth="3">
                                  <path
                                    strokeDasharray={
                                      option.s ? option.s.join(',') : null
                                    }
                                    d="M5 20 l120 0"
                                  />
                                </g>
                              </svg>
                            </Tooltip>
                          </MenuItem>
                        ))}
                      </MenuList>
                    </ClickAwayListener>
                  </Paper>
                </Grow>
              )}
            </Popper>
          </ListItem>
        </List>
      </Grid>
    </Grid>
  )
}

NodeColor.propTypes = {
  node: nodeProps.isRequired,
  onChange: PropTypes.func.isRequired,
}
