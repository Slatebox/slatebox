import React, { useState } from 'react'
import PropTypes from 'prop-types'
import FontPicker from '@slatebox/font-picker-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'

/**
 * FontPickerBrand - A simpler wrapper for FontPicker with toggle functionality
 * @param {Object} props
 * @param {string} props.apiKey - Google Fonts API key
 * @param {string} props.fontFamily - Currently selected font family
 * @param {Function} props.onChange - Callback when font changes
 * @param {Function} props.filter - Optional filter function for fonts
 */
export default function FontPickerBrand({
  apiKey,
  fontFamily = 'Roboto',
  onChange,
  filter = null,
}) {
  const [isActive, setIsActive] = useState(false)

  // Toggle the font picker visibility
  const toggleFontPicker = () => {
    setIsActive((prev) => !prev)
  }

  // Handle font selection
  const handleFontSelected = (nextFont) => {
    onChange(nextFont)
    setIsActive(false)
  }

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          p: 1,
          border: '1px solid #e0e0e0',
          borderRadius: 1,
          mb: isActive ? 1 : 0,
        }}
      >
        <Typography
          style={{
            fontFamily: fontFamily || 'Roboto',
            fontSize: '16px',
          }}
        >
          {fontFamily || 'Select a font'}
        </Typography>
        <Button variant="outlined" size="small" onClick={toggleFontPicker}>
          {isActive ? 'Close' : 'Change'}
        </Button>
      </Box>

      {isActive && (
        <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, p: 1 }}>
          <FontPicker
            apiKey={apiKey}
            activeFontFamily={fontFamily}
            filter={filter}
            onChange={handleFontSelected}
          />
        </Box>
      )}
    </Box>
  )
}

// PropTypes validation
FontPickerBrand.propTypes = {
  apiKey: PropTypes.string.isRequired,
  fontFamily: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  filter: PropTypes.func,
}
