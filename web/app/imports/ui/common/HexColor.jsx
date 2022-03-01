import React from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import { HexColorPicker, RgbaColorPicker } from 'react-colorful'
import './react-colorful.css'
import FormControl from '@material-ui/core/FormControl'
import OutlinedInput from '@material-ui/core/OutlinedInput'
import InputAdornment from '@material-ui/core/InputAdornment'
import rgbToHex from 'rgb-hex'
import hexToRGB from 'hex-rgb'

const useStyles = makeStyles(() => ({
  hexInput: {
    padding: '4px 4px',
    width: '110px',
  },
  colorPicker: {
    height: '150px',
  },
}))

export default function HexColor({
  color,
  opacity,
  onChange,
  alignItems,
  justify,
  noAlpha,
}) {
  const classes = useStyles()
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
    <Grid
      container
      alignItems={alignItems || 'center'}
      justify={justify || 'flex-start'}
    >
      <Grid item>
        <Grid item xs={12}>
          {noAlpha ? (
            <HexColorPicker
              color={color}
              onChange={(ccolor) => {
                debounceChange(`#${ccolor.replace('#', '')}`)
              }}
              className={classes.colorPicker}
            />
          ) : (
            <RgbaColorPicker
              color={c2}
              onChange={(ccolor) => {
                const hex = rgbToHex(ccolor.r, ccolor.g, ccolor.b)
                debounceChange(`#${hex}`, ccolor.a)
              }}
              className={classes.colorPicker}
            />
          )}
        </Grid>
        <Grid xs={12}>
          <FormControl variant="outlined" style={{ marginTop: '8px' }}>
            <OutlinedInput
              id="outlined-adornment-hex"
              classes={{ input: classes.hexInput }}
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
  )
}

HexColor.propTypes = {
  color: PropTypes.string.isRequired,
  opacity: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
  alignItems: PropTypes.string,
  noAlpha: PropTypes.bool,
  justify: PropTypes.string,
}

HexColor.defaultProps = {
  alignItems: 'center',
  noAlpha: false,
  justify: 'flex-start',
}
