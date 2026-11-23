/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Box from '@mui/material/Box'
import Tooltip from '@mui/material/Tooltip'
import CheckIcon from '@mui/icons-material/Check'
import { Slatebox } from 'slateboxjs' // Import Slatebox for color utilities

export default function PaletteColorPicker({
  colors, // Array of all available colors { _id, displayName, value }
  selectedKeys = [], // Array of selected color _ids
  onChange, // Callback function, returns the new array of selected keys
  dense = false, // Optional prop for denser layout (smaller swatches)
  selectionMode = 'toggle', // 'toggle' (default) or 'single' (radio button behavior)
}) {
  const handleSelect = (keyToToggle) => {
    const currentlySelected = selectedKeys || []

    // Single mode (radio button behavior)
    if (selectionMode === 'single') {
      // If already selected in single mode, do nothing
      if (currentlySelected.includes(keyToToggle)) {
        return
      }

      // Otherwise, select only this one
      onChange([keyToToggle])
      return
    }

    // Toggle mode (default multi-select behavior)
    let newSelectedKeys
    if (currentlySelected.includes(keyToToggle)) {
      // If already selected in toggle mode, remove it
      newSelectedKeys = currentlySelected.filter((key) => key !== keyToToggle)
    } else {
      // If not selected in toggle mode, add it
      newSelectedKeys = [...currentlySelected, keyToToggle]
    }

    onChange(newSelectedKeys)
  }

  return (
    // Use dense spacing if dense prop is true
    <Grid container spacing={dense ? 0.5 : 1}>
      {colors.map((color) => {
        const isSelected = selectedKeys?.includes(color._id)
        const swatchSize = dense ? 24 : 30 // Smaller size if dense

        return (
          <Grid key={color._id}>
            <Tooltip
              title={`${color.displayName} (${color.value})`}
              placement="top"
            >
              <Box
                onClick={() => handleSelect(color._id)}
                sx={{
                  width: swatchSize,
                  height: swatchSize,
                  borderRadius: '4px',
                  backgroundColor: color.value,
                  cursor: 'pointer',
                  border: isSelected
                    ? '2px solid #fff' // White border for selected
                    : '2px solid transparent',
                  outline: `1px solid ${
                    color.value === '#ffffff' || color.value === '#FFFFFF'
                      ? '#ccc'
                      : 'transparent'
                  }`, // Outline for white swatch
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative', // Needed for checkmark positioning
                  '&:hover': {
                    border: '2px solid #aaa', // Consistent hover border
                  },
                }}
              >
                {isSelected && (
                  <CheckIcon
                    sx={{
                      color: Slatebox.utils.whiteOrBlack(color.value), // Use utility to determine best contrast
                      fontSize: dense ? 14 : 18, // Smaller checkmark if dense
                      // Position checkmark slightly better if needed
                      // position: 'absolute',
                      // top: '50%',
                      // left: '50%',
                      // transform: 'translate(-50%, -50%)'
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          </Grid>
        )
      })}
    </Grid>
  )
}

PaletteColorPicker.propTypes = {
  colors: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired,
      displayName: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ).isRequired,
  selectedKeys: PropTypes.arrayOf(PropTypes.string), // Expect an array of keys
  onChange: PropTypes.func.isRequired, // Renamed from onSelectColor
  dense: PropTypes.bool, // Added dense prop
  selectionMode: PropTypes.oneOf(['toggle', 'single']), // Add selection mode prop
}
