import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import Skeleton from '@mui/material/Skeleton'
import Grid from '@mui/material/Grid2'
import { useAtomValue } from 'jotai'
import uniq from 'lodash.uniq'
import CONSTANTS from '../../api/common/constants'
import { currentSlate } from '../jotai/atoms'

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
  const slate = useAtomValue(currentSlate)
  const [presetColors, setPresets] = React.useState(
    slate?.options.themeId ? [] : presetDefaults
  )

  useEffect(() => {
    async function getPresets() {
      if (slate) {
        const palette = await Meteor.callAsync(
          CONSTANTS.methods.themes.getPresetColors,
          { themeId: slate.options.basedOnThemeId }
        )
        if (!palette || uniq(palette.map((p) => p.nodeColor)).length === 1) {
          setPresets(presetDefaults)
        } else {
          setPresets(palette.map((p) => p.nodeColor))
        }
      }
    }
    getPresets()
  }, [slate?.options.basedOnThemeId])

  return (
    <Grid
      container
      sx={{
        width: `${width || 280}px`,
        height: `${height || 150}px`,
      }}
    >
      {presetColors.length === 0 ? (
        <>
          {Array.from({ length: 18 }).map((k) => (
            <Grid
              key={k}
              sx={{
                width: '40px',
                height: '40px',
                cursor: 'pointer',
                border: '1px solid #000',
                borderRadius: 1,
                '&:hover': {
                  transform: 'scale(1.1)',
                },
              }}
              size={2}
            >
              <Skeleton
                variant="rect"
                animation="wave"
                width="100%"
                height="100%"
              />
            </Grid>
          ))}
        </>
      ) : (
        presetColors.map((presetColor) => (
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
        ))
      )}
    </Grid>
  )
}

PresetColors.propTypes = {
  width: PropTypes.number,
  height: PropTypes.number,
  onColorChange: PropTypes.func.isRequired,
}
