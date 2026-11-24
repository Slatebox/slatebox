import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtomValue } from 'jotai'
import Grid from '@mui/material/Grid2'
import Tooltip from '@mui/material/Tooltip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Brightness1Icon from '@mui/icons-material/Brightness1'
import Typography from '@mui/material/Typography'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import CONSTANTS from '../../../api/common/constants'
import PresetColors from '../../common/PresetColors'
import HexColor from '../../common/HexColor'
import { currentSlate } from '../../jotai/atoms'

export default function SlateColors({ onChange }) {
  const slate = useAtomValue(currentSlate)

  let bcolor = slate?.options?.containerStyle?.backgroundColor
  bcolor = bcolor || '#fff'

  let lcolor = slate?.options?.defaultLineColor
  lcolor = lcolor || '#000'

  const [colorType, setType] = React.useState('onSlateBackgroundColorChanged')
  const style = slate?.options?.containerStyle
  const [settings, setSettings] = React.useState(() => ({
    selectedColor: bcolor,
    asGradient: style?.backgroundColorAsGradient,
    linearOrRadial: style?.backgroundGradientType || 'linear',
    gradientColorCount: style?.backgroundGradientColors?.length || 2,
    bgStrategy: style?.backgroundGradientStrategy || 'shades',
  }))
  const { selectedColor, asGradient, linearOrRadial, gradientColorCount, bgStrategy } = settings
  const paletteRequest = React.useRef(0)
  useEffect(() => () => { paletteRequest.current++ }, [])

  // Opening the drawer or inspecting a different swatch must never edit the board.
  async function applyChange(change) {
    const next = { ...settings, ...change }
    setSettings(next)
    const sequence = ++paletteRequest.current
    const data = { color: next.selectedColor, asGradient: next.asGradient,
      gradientType: next.linearOrRadial, gradientStrategy: next.bgStrategy,
      gradientColors: style?.backgroundGradientColors || [] }
    if (colorType === 'onSlateBackgroundColorChanged' && next.asGradient) {
      const palette = await Meteor.callAsync(CONSTANTS.methods.colors.buildColorPalette, {
        type: next.bgStrategy, base: next.selectedColor,
      })
      if (sequence !== paletteRequest.current) return
      data.gradientColors = palette.slice(0, next.gradientColorCount)
    }
    onChange({ type: colorType, data })
  }

  const setColor = selectedColor => applyChange({ selectedColor })
  const handleType = (event, newType) => {
    if (!newType) return
    setType(newType)
    setSettings({ ...settings, selectedColor: newType === 'onSlateBackgroundColorChanged' ? bcolor : lcolor })
  }

  return (
    <Grid container alignItems="center" justifyContent="center" spacing={2}>
      <Grid>
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
              <Grid container alignItems="center" justifyContent="center">
                <Grid>
                  <Brightness1Icon htmlColor={bcolor} />
                </Grid>
                <Grid style={{ fontSize: '7pt' }}>Background</Grid>
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
              <Grid container alignItems="center" justifyContent="center">
                <Grid>
                  <Brightness1Icon htmlColor={lcolor} />
                </Grid>
                <Grid style={{ fontSize: '7pt' }}>Relationships</Grid>
              </Grid>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Grid>
      <Grid>
        <HexColor color={selectedColor} noAlpha onChange={setColor} />
      </Grid>
      {colorType === 'onSlateBackgroundColorChanged' && (
        <Grid container sx={{ mt: 1 }} justifyContent="space-evenly">

          <Grid size={12}>
            <ToggleButton
              value="asGradient"
              style={{ width: '100%' }}
              selected={asGradient}
              color="secondary"
              size="small"
              onChange={() => {
                applyChange({ asGradient: !asGradient })
              }}
            >
              As Gradient...
            </ToggleButton>
          </Grid>
          <Grid>
            <FormControl variant="outlined" size="small">
              <InputLabel id="color-count"># colors</InputLabel>
              <Select
                labelId="color-count"
                disabled={!asGradient}
                id="color-gradient-count"
                value={gradientColorCount}
                onChange={(e) => {
                  applyChange({ gradientColorCount: e.target.value })
                }}
                label="Gradient Color Count"
              >
                {Array.from({ length: 17 }).map((c, ind) => [
                  <MenuItem key={ind} value={ind + 2}>
                    {ind + 2}
                  </MenuItem>,
                ])}
              </Select>
            </FormControl>
          </Grid>
          <Grid>
            <FormControl variant="outlined" size="small">
              <InputLabel id="gradient-style">style</InputLabel>
              <Select
                labelId="gradient-style"
                disabled={!asGradient}
                id="gradient-style-type"
                value={linearOrRadial}
                onChange={(e) => {
                  applyChange({ linearOrRadial: e.target.value })
                }}
                label="Gradient Color Count"
              >
                <MenuItem value="linear">linear</MenuItem>
                <MenuItem value="radial">radial</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid>
            <ToggleButtonGroup
              value={bgStrategy}
              exclusive
              onChange={(event, strategy) => { if (strategy) applyChange({ bgStrategy: strategy }) }}
              aria-label="gradient generation type"
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
      <Grid>
        <PresetColors
          width={250}
          onColorChange={(color) => {
            setColor(color)
          }}
        />
      </Grid>
    </Grid>
  )
}

SlateColors.propTypes = { onChange: PropTypes.func.isRequired }
