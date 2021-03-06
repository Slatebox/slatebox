import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useSelector } from 'react-redux'
import Grid from '@material-ui/core/Grid'
import Tooltip from '@material-ui/core/Tooltip'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Checkbox from '@material-ui/core/Checkbox'
import ListItemText from '@material-ui/core/ListItemText'
import Box from '@material-ui/core/Box'
import Brightness1Icon from '@material-ui/icons/Brightness1'
import Typography from '@material-ui/core/Typography'
import FormControl from '@material-ui/core/FormControl'
import InputLabel from '@material-ui/core/InputLabel'
import Select from '@material-ui/core/Select'
import MenuItem from '@material-ui/core/MenuItem'
import CONSTANTS from '../../../api/common/constants'
import PresetColors from '../../common/PresetColors'
import HexColor from '../../common/HexColor'
import promisify from '../../../api/client/promisify'

export default function SlateColors({ onChange }) {
  const slate = useSelector((state) => state.slate)

  let bcolor = slate?.options?.containerStyle?.backgroundColor
  bcolor = bcolor || '#fff'

  let lcolor = slate?.options?.defaultLineColor
  lcolor = lcolor || '#000'

  const [selectedColor, updateColor] = React.useState(bcolor)
  const [colorType, setType] = React.useState('onSlateBackgroundColorChanged')

  const bgGradient = slate?.options?.containerStyle?.backgroundColorAsGradient
  const bgGradientType =
    slate?.options?.containerStyle?.backgroundGradientType || 'linear'
  const bgGradientColors = React.useRef(
    slate?.options?.containerStyle?.backgroundGradientColors || []
  )
  const bgGradientStrategy =
    slate?.options?.containerStyle?.backgroundGradientStrategy || 'shades'
  const [asGradient, setAsGradient] = React.useState(bgGradient)
  const [linearOrRadial, setLinearOrRadial] = React.useState(bgGradientType)
  const [gradientColorCount, setGradientColorCount] = React.useState(
    bgGradientColors.current.length ? bgGradientColors.current.length : 2
  )
  const [bgStrategy, setBgStrategy] = React.useState(bgGradientStrategy)

  useEffect(() => {
    async function enactColorChange() {
      if (asGradient) {
        const palette = await promisify(
          Meteor.call,
          CONSTANTS.methods.themes.buildColorPalette,
          { type: bgStrategy, base: selectedColor }
        )
        bgGradientColors.current = palette.slice(0, gradientColorCount)
      }
      const payload = {
        color: selectedColor,
        asGradient,
        gradientType: linearOrRadial,
        gradientColors: bgGradientColors.current,
        gradientStrategy: bgStrategy,
      }
      onChange({ type: colorType, data: payload })
    }
    if (selectedColor !== 'transparent') {
      enactColorChange()
    }
  }, [
    selectedColor,
    colorType,
    asGradient,
    linearOrRadial,
    gradientColorCount,
    bgStrategy,
  ])

  const setColor = async (color) => {
    updateColor(color)
  }

  const handleType = (event, newType) => {
    setType(newType)
    const c = newType === 'onSlateBackgroundColorChanged' ? bcolor : lcolor
    updateColor(c)
  }

  const genColors = (event, newStrategy) => {
    if (newStrategy) {
      setBgStrategy(newStrategy)
    }
  }

  const toggleTransparent = () => {
    if (selectedColor === 'transparent') {
      updateColor('#fff')
    } else {
      updateColor('transparent')
    }
  }

  SlateColors.propTypes = {
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2}>
      <Grid item>
        <ToggleButtonGroup
          value={colorType}
          exclusive
          onChange={handleType}
          aria-label="color type"
        >
          <ToggleButton
            value="onSlateBackgroundColorChanged"
            aria-label="onSlateBackgroundColorChanged"
          >
            <Tooltip title="Slate background color" placement="top">
              <Grid container alignItems="center" justify="center">
                <Grid item>
                  <Brightness1Icon htmlColor={bcolor} />
                </Grid>
                <Grid item style={{ fontSize: '7pt' }}>
                  Background
                </Grid>
              </Grid>
            </Tooltip>
          </ToggleButton>
          <ToggleButton
            value="onLineColorChanged"
            aria-label="onLineColorChanged"
          >
            <Tooltip
              title="Default color of relationship lines between nodes"
              placement="top"
            >
              <Grid container alignItems="center" justify="center">
                <Grid item>
                  <Brightness1Icon htmlColor={lcolor} />
                </Grid>
                <Grid item style={{ fontSize: '7pt' }}>
                  Relationships
                </Grid>
              </Grid>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid item>
        <HexColor color={selectedColor} noAlpha onChange={setColor} />
      </Grid>
      {colorType === 'onSlateBackgroundColorChanged' && (
        <Grid container spacing={2} justify="space-evenly">
          {/* <Grid item xs={12}>
            <List>
              <ListItem
                role={undefined}
                dense
                button
                onClick={(e) => {
                  toggleTransparent()
                }}
              >
                <ListItemIcon>
                  <Checkbox
                    edge="start"
                    checked={selectedColor === 'transparent'}
                    tabIndex={-1}
                    disableRipple
                  />
                </ListItemIcon>
                <ListItemText primary="transparent" />
              </ListItem>
            </List>
          </Grid> */}
          <Grid item xs={12}>
            <ToggleButton
              style={{ width: '100%' }}
              selected={asGradient}
              color="secondary"
              size="small"
              onChange={() => {
                setAsGradient(!asGradient)
              }}
            >
              As Gradient...
            </ToggleButton>
          </Grid>
          <Grid item>
            <FormControl variant="outlined" size="small">
              <InputLabel id="color-count"># colors</InputLabel>
              <Select
                labelId="color-count"
                disabled={!asGradient}
                id="color-gradient-count"
                value={gradientColorCount}
                onChange={(e) => {
                  setGradientColorCount(e.target.value)
                }}
                label="Gradient Color Count"
              >
                {Array.from({ length: 17 }).map((c, ind) => (
                  <MenuItem key={ind} value={ind + 2}>
                    {ind + 2}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item>
            <FormControl variant="outlined" size="small">
              <InputLabel id="gradient-style">style</InputLabel>
              <Select
                labelId="gradient-style"
                disabled={!asGradient}
                id="gradient-style-type"
                value={linearOrRadial}
                onChange={(e) => {
                  setLinearOrRadial(e.target.value)
                }}
                label="Gradient Color Count"
              >
                <MenuItem value="linear">linear</MenuItem>
                <MenuItem value="radial">radial</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item>
            <ToggleButtonGroup
              value={bgStrategy}
              exclusive
              onChange={genColors}
              aria-label="gen type"
            >
              <ToggleButton
                value="palette"
                aria-label="palette"
                disabled={!asGradient}
              >
                <Tooltip
                  title="Generate gradient as complementary colors of the selected color"
                  placement="top"
                >
                  <Typography variant="body2">Complementary</Typography>
                </Tooltip>
              </ToggleButton>
              <ToggleButton
                value="shades"
                aria-label="shades"
                disabled={!asGradient}
              >
                <Tooltip
                  title="Generate gradient as shades of the selected color"
                  placement="top"
                >
                  <Typography variant="body2">Shades</Typography>
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      )}
      <Grid item>
        <Box style={{ padding: '10px' }}>
          <PresetColors
            onColorChange={(color) => {
              setColor(color)
            }}
          />
        </Box>
      </Grid>
    </Grid>
  )
}
