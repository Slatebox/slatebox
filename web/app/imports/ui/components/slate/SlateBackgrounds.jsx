import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material/styles'
import Grid from '@mui/material/Grid2'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ImageList from '@mui/material/ImageList'
import ImageListItem from '@mui/material/ImageListItem'
import TextField from '@mui/material/TextField'
import Box from '@mui/material/Box'
import ImageListItemBar from '@mui/material/ImageListItemBar'
import ToggleButton from '@mui/material/ToggleButton'
import { useAtomValue } from 'jotai'
import cloneDeep from 'lodash.clonedeep'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'

import { currentSlate } from '../../jotai/atoms'

export default function SlateBackgrounds({ onChange }) {
  const slate = useAtomValue(currentSlate)

  const bUrl = slate?.options?.containerStyle?.backgroundImage
  const bSize = slate?.options?.containerStyle?.backgroundSize
  const bAttribution =
    slate?.options?.containerStyle?.backgroundAttribution || {}
  const [filter, setFilter] = React.useState('')
  const [searchAttempted, setSearchAttempted] = React.useState(false)
  const [selectedBackground, updateBackground] = React.useState({
    url: bUrl,
    size: bSize,
    attribution: bAttribution,
  })

  const [currentSearchResults, setSearchResults] = React.useState([])

  const setBackground = async (index) => {
    // event.target.value
    updateBackground(currentSearchResults[index])
    const cacheUrl = await Meteor.callAsync(
      CONSTANTS.methods.slates.cacheImage,
      { ...currentSearchResults[index], provider: `pixabay` }
    )
    const bg = currentSearchResults[index]
    onChange({
      type: 'onSlateBackgroundImageChanged',
      data: {
        bg: {
          size: 'cover',
          url: cacheUrl,
          attribution: bg.attribution,
        },
      },
    })
  }

  const setBackgroundSize = (event, newSize) => {
    if (newSize != null) {
      const copy = cloneDeep(selectedBackground)
      copy.size = newSize
      updateBackground(copy)
      onChange({
        type: 'onSlateBackgroundImageChanged',
        data: { bg: copy },
      })
    }
  }

  const searchBackgroundImages = async (val) => {
    const results = await Meteor.callAsync(
      CONSTANTS.methods.slates.searchBackgroundImages,
      { filter: val, provider: 'pixabay' }
    )
    setSearchAttempted(true)
    setSearchResults(results)
  }

  const setBackgroundFilter = (term, explicitClear) => {
    setFilter(term)
    if (explicitClear) {
      setSearchAttempted(false)
      setSearchResults([])
    }
  }

  SlateBackgrounds.propTypes = {
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Box
      sx={{
        '& .bgImage': {
          width: 'inherit',
          height: 'inherit',
          padding: '0 !important',
          transition: 'all 500ms',
          cursor: 'pointer',
          '&:hover': {
            transform: 'scale(1.2)',
          },
        },
      }}
    >
      <Grid
        container
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
      >
        <Grid size={4}>
          <Box
            component="a"
            href="https://pixabay.com/"
            target="_tab"
            sx={{
              margin: '2px',
              fontSize: '12px',
              color: '#fff',
              display: 'block',
              float: 'left',
              padding: '5px 2px 2px 5px',
              border: '1px solid #ccc',
            }}
          >
            <Box
              component="i"
              sx={{
                display: 'block',
                width: '68px',
                height: '18px',
                overflow: 'hidden',
              }}
            >
              <Box
                component="img"
                src="/images/pixabay_logo.svg"
                sx={{ width: 'inherit' }}
                alt="Free Images on Pixabay"
              />
            </Box>
            Free Images
          </Box>
        </Grid>
        <Grid size={8} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ToggleButtonGroup
            value={bSize}
            exclusive
            onChange={setBackgroundSize}
            sx={{ flexWrap: 'wrap' }}
            aria-label="slate background"
          >
            {[
              { name: 'Repeat', val: '' },
              { name: 'Stretch', val: 'cover' },
            ].map((v) => (
              <ToggleButton
                size="small"
                key={v.name}
                value={v.val}
                aria-label={v.name}
              >
                {v.name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Grid>
        <Grid size={12}>
          <TextField
            variant="outlined"
            fullWidth
            id="search-backgrounds"
            label="Search..."
            value={filter}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                searchBackgroundImages(filter)
                ev.preventDefault()
              }
            }}
            onChange={(e) => {
              setBackgroundFilter(e.target.value)
            }}
            slotProps={{
              inputLabel: {
                sx: { color: '#fff' },
              },
              input: {
                endAdornment: (
                  <>
                    <Button
                      size="small"
                      onClick={(e) => {
                        searchBackgroundImages(filter)
                      }}
                    >
                      go
                    </Button>
                    {filter && (
                      <Button
                        size="small"
                        onClick={(e) => {
                          setBackgroundFilter('', true)
                        }}
                      >
                        clear
                      </Button>
                    )}
                  </>
                ),
              },
            }}
          />
        </Grid>
        <Grid size={12}>
          <ImageList gap={1} cols={1} rowHeight={180}>
            {currentSearchResults.length === 0 &&
            filter !== '' &&
            searchAttempted ? (
              <Typography variant="body2">No Results Found</Typography>
            ) : (
              currentSearchResults.map((s, index) => (
                <ImageListItem
                  key={s.attribution.title}
                  cols={1}
                  onClick={() => {
                    setBackground(index)
                  }}
                  className="bgImage"
                >
                  <img src={s.previewUrl} alt={s.attribution.title} />
                  <ImageListItemBar
                    title={s.attribution.title}
                    subtitle={s.attribution.author}
                  />
                </ImageListItem>
              ))
            )}
          </ImageList>
        </Grid>
      </Grid>
    </Box>
  )
}
