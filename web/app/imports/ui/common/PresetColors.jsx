import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'

const presetDefaults = [
  '#f44336',
  '#e91e63',
  '#9c27b0',
  '#673ab7',
  '#3f51b5',
  '#2196f3',
  '#03a9f4',
  '#00bcd4',
  '#009688',
  '#4caf50',
  '#8bc34a',
  '#cddc39',
  '#ffeb3b',
  '#ffc107',
  '#ff9800',
  '#ff5722',
  '#795548',
  '#607d8b',
]

export default function PresetColors({ width, height, onColorChange }) {
  return (
    <Grid
      container
      sx={{
        width: `${width || 280}px`,
        height: `${height || 150}px`,
      }}
    >
      {presetDefaults.map((presetColor) => (
        <Grid
          size={2}
          sx={{
            width: '40px',
            height: '40px',
            cursor: 'pointer',
            border: '1px solid #000',
            borderRadius: 1,
            backgroundColor: presetColor,
            '&:hover': {
              transform: 'scale(1.1)',
            },
          }}
          key={presetColor}
          onClick={() => onColorChange(presetColor)}
        />
      ))}
    </Grid>
  )
}

PresetColors.propTypes = {
  width: PropTypes.number,
  height: PropTypes.number,
  onColorChange: PropTypes.func.isRequired,
}
