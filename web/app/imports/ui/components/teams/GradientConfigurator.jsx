/* eslint-disable no-underscore-dangle */
import React, { useState, useEffect, useCallback, useRef } from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Alert from '@mui/material/Alert'
import { Meteor } from 'meteor/meteor'
import CONSTANTS from '../../../api/common/constants'
import PaletteColorPicker from './PaletteColorPicker'

export default function GradientConfigurator({
  colors,
  value = {
    baseColorKey: null,
    gradientColorCount: 2,
    gradientType: 'linear',
    gradientStrategy: 'shades',
    gradientColors: [],
  },
  onChange,
  disabled = false,
}) {
  // Internal state for count and type
  const [gradientColorCount, setGradientColorCount] = useState(
    value?.gradientColorCount || 2
  )
  const [gradientType, setGradientType] = useState(
    value?.gradientType || 'linear'
  )
  const [gradientStrategy, setGradientStrategy] = useState(
    value?.gradientStrategy || 'shades'
  )
  const [isLoadingPalette, setIsLoadingPalette] = useState(false)
  const [paletteError, setPaletteError] = useState(null)
  const paletteDebounceTimerRef = useRef(null)

  // Extract baseColorKey from the value prop for PaletteColorPicker
  const baseColorKey = value?.baseColorKey || null

  // Effect to sync internal state when value prop changes from parent
  useEffect(() => {
    setGradientColorCount(value?.gradientColorCount || 2)
    setGradientType(value?.gradientType || 'linear')
    setGradientStrategy(value?.gradientStrategy || 'shades')
    setPaletteError(null)
  }, [value])

  // --- Palette Generation Logic --- START ---
  const generateAndPropagatePalette = useCallback(
    async (config) => {
      const {
        baseColorKey,
        gradientColorCount,
        gradientType,
        gradientStrategy,
      } = config

      if (!baseColorKey) {
        onChange({ ...config, gradientColors: [] })
        setPaletteError(null)
        return
      }

      const baseColorObj = colors.find((c) => c._id === baseColorKey)
      if (!baseColorObj) {
        setPaletteError('Base color not found in palette.')
        onChange({ ...config, gradientColors: [] })
        return
      }
      const baseHex = baseColorObj.value

      setIsLoadingPalette(true)
      setPaletteError(null)

      try {
        const paletteResult = await Meteor.callAsync(
          CONSTANTS.methods.themes.buildColorPalette,
          {
            type: gradientStrategy || 'shades',
            base: baseHex,
          }
        )

        const gradientColors = paletteResult.slice(0, gradientColorCount || 2)
        onChange({
          ...config,
          gradientColors: gradientColors,
        })
      } catch (error) {
        console.error(`Error generating palette:`, error)
        setPaletteError('Failed to generate gradient colors.')
        onChange({ ...config, gradientColors: [] })
      } finally {
        setIsLoadingPalette(false)
      }
    },
    [colors, onChange]
  )
  // --- Palette Generation Logic --- END ---

  // --- Debounce Logic --- START ---
  const DEBOUNCE_DELAY = 300

  const triggerDebouncedGeneration = useCallback(
    (newConfig) => {
      if (paletteDebounceTimerRef.current) {
        clearTimeout(paletteDebounceTimerRef.current)
      }
      paletteDebounceTimerRef.current = setTimeout(() => {
        generateAndPropagatePalette(newConfig)
      }, DEBOUNCE_DELAY)
    },
    [generateAndPropagatePalette]
  )
  // --- Debounce Logic --- END ---

  // Handler for PaletteColorPicker's onChange (for base color)
  const handleBaseColorChange = (newKeys) => {
    const newBaseKey = newKeys[0] || null
    const newConfig = {
      baseColorKey: newBaseKey,
      gradientColorCount,
      gradientType,
      gradientStrategy,
    }
    if (!newBaseKey) {
      generateAndPropagatePalette(newConfig)
    } else {
      triggerDebouncedGeneration(newConfig)
    }
  }

  const handleCountChange = (event) => {
    const newCount = parseInt(event.target.value, 10)
    setGradientColorCount(newCount)
    const newConfig = {
      baseColorKey,
      gradientColorCount: newCount,
      gradientType,
      gradientStrategy,
    }
    triggerDebouncedGeneration(newConfig)
  }

  const handleTypeChange = (event, newType) => {
    if (newType !== null) {
      setGradientType(newType)
      const newConfig = {
        baseColorKey,
        gradientColorCount,
        gradientType: newType,
        gradientStrategy,
      }
      triggerDebouncedGeneration(newConfig)
    }
  }

  const handleStrategyChange = (event, newStrategy) => {
    if (newStrategy !== null) {
      setGradientStrategy(newStrategy)
      const newConfig = {
        baseColorKey,
        gradientColorCount,
        gradientType,
        gradientStrategy: newStrategy,
      }
      triggerDebouncedGeneration(newConfig)
    }
  }

  useEffect(() => {
    return () => {
      if (paletteDebounceTimerRef.current) {
        clearTimeout(paletteDebounceTimerRef.current)
      }
    }
  }, [])

  return (
    <Grid container spacing={2} alignItems="flex-start">
      {/* Base Color Column */}
      <Grid size={6}>
        <Typography variant="subtitle2" gutterBottom>
          Base Color
        </Typography>
        <PaletteColorPicker
          colors={colors}
          selectedKeys={baseColorKey ? [baseColorKey] : []}
          onChange={handleBaseColorChange}
          dense
          selectionMode="single"
          disabled={disabled || isLoadingPalette}
        />
      </Grid>
      {/* Gradient Settings Column - Only shown if base color selected */}
      {baseColorKey && (
        <Grid size={6}>
          {/* Remove Gradient Settings Title */}
          {/* <Typography variant="subtitle2" gutterBottom>
            Gradient Settings
          </Typography> */}

          {/* Use a ROW direction for the settings controls */}
          <Grid container direction="row" spacing={1.5} alignItems="center">
            {/* Column for # Colors Dropdown - Make wider */}
            <Grid size={4}>
              <FormControl variant="outlined" size="small" fullWidth>
                <InputLabel id="gradient-color-count-label">
                  # Colors
                </InputLabel>
                <Select
                  labelId="gradient-color-count-label"
                  id="gradient-color-count"
                  value={gradientColorCount}
                  onChange={handleCountChange}
                  label="# Colors"
                  disabled={disabled || isLoadingPalette}
                >
                  {Array.from({ length: 17 }, (_, i) => i + 2).map(
                    (numColors) => (
                      <MenuItem key={`count-${numColors}`} value={numColors}>
                        {numColors}
                      </MenuItem>
                    )
                  )}
                </Select>
              </FormControl>
            </Grid>
            {/* Column for Linear/Radial Toggle */}
            <Grid size={4}>
              <ToggleButtonGroup
                value={gradientType}
                exclusive
                onChange={handleTypeChange}
                aria-label="gradient type"
                size="small"
                fullWidth
                disabled={disabled || isLoadingPalette}
              >
                <ToggleButton
                  value="linear"
                  aria-label="linear gradient"
                  sx={{ flexGrow: 1 }}
                >
                  Linear
                </ToggleButton>
                <ToggleButton
                  value="radial"
                  aria-label="radial gradient"
                  sx={{ flexGrow: 1 }}
                >
                  Radial
                </ToggleButton>
              </ToggleButtonGroup>
            </Grid>
            {/* Loading Indicator */}
            {isLoadingPalette && (
              <Grid size="auto">
                <CircularProgress size={24} />
              </Grid>
            )}
          </Grid>
          {/* Error Alert */}
          {paletteError && (
            <Grid size={12} sx={{ mt: 1.5 }}>
              <Alert severity="error" variant="outlined" sx={{ width: '100%' }}>
                {paletteError}
              </Alert>
            </Grid>
          )}
        </Grid>
      )}
    </Grid>
  )
}

GradientConfigurator.propTypes = {
  colors: PropTypes.arrayOf(
    PropTypes.shape({
      _id: PropTypes.string.isRequired,
      displayName: PropTypes.string.isRequired,
      value: PropTypes.string.isRequired,
    })
  ).isRequired,
  value: PropTypes.shape({
    baseColorKey: PropTypes.string,
    gradientColorCount: PropTypes.number,
    gradientType: PropTypes.oneOf(['linear', 'radial']),
    gradientStrategy: PropTypes.string,
    gradientColors: PropTypes.arrayOf(PropTypes.string),
  }),
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
