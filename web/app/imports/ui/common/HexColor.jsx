import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import { HexColorPicker, RgbaColorPicker } from 'react-colorful'
import './react-colorful.css'
import FormControl from '@mui/material/FormControl'
import OutlinedInput from '@mui/material/OutlinedInput'
import InputAdornment from '@mui/material/InputAdornment'
import rgbToHex from 'rgb-hex'
import hexToRGB from 'hex-rgb'
import { Box } from '@mui/material'

export default function HexColor({
  color,
  opacity,
  onChange,
  alignItems = 'center',
  justifyContent = 'flex-start',
  noAlpha = false,
}) {
  let ucolor = color
  let uopacity = opacity
  ucolor = color === 'transparent' ? '#fff' : ucolor
  uopacity = color === 'transparent' ? 0 : uopacity
  let c = null
  try {
    c = hexToRGB(ucolor)
  } catch (err) {
    c = hexToRGB('#fff')
  }
  const c2 = {
    r: c.red,
    g: c.green,
    b: c.blue,
    a: uopacity,
  }

  let lt = null
  const debounceChange = (ccolor, alpha) => {
    clearTimeout(lt)
    lt = window.setTimeout(() => {
      onChange(ccolor, alpha)
    }, 50)
  }

  return (
    <Box
      sx={{
        '& .hexInput': {
          padding: '4px 4px',
          width: '110px',
        },
        '& .colorPicker': {
          height: '150px',
        },
      }}
    >
      <Grid
        container
        alignItems={alignItems || 'center'}
        justifyContent={justifyContent || 'flex-start'}
      >
        <Grid>
          <Grid size={12}>
            {noAlpha ? (
              <HexColorPicker
                color={color}
                onChange={(ccolor) => {
                  debounceChange(`#${ccolor.replace('#', '')}`)
                }}
                className="colorPicker"
              />
            ) : (
              <RgbaColorPicker
                color={c2}
                onChange={(ccolor) => {
                  const hex = rgbToHex(ccolor.r, ccolor.g, ccolor.b)
                  debounceChange(`#${hex}`, ccolor.a)
                }}
                className="colorPicker"
              />
            )}
          </Grid>
          <Grid size={12}>
            <FormControl variant="outlined" style={{ marginTop: '8px' }}>
              <OutlinedInput
                id="outlined-adornment-hex"
                classes={{ input: 'hexInput' }}
                value={color.replace('#', '')}
                onChange={(e) => {
                  debounceChange(`#${e.target.value.replace('#', '')}`)
                }}
                startAdornment={
                  <InputAdornment position="start">#</InputAdornment>
                }
              />
            </FormControl>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  )
}

HexColor.propTypes = {
  color: PropTypes.string.isRequired,
  opacity: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  alignItems: PropTypes.string,
  noAlpha: PropTypes.bool,
  justifyContent: PropTypes.string,
}
