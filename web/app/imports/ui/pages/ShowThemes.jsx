/* eslint-disable no-underscore-dangle */
import Container from '@mui/material/Container'
import { Meteor } from 'meteor/meteor'
import { useSetAtom } from 'jotai'
import { useNavigate } from 'react-router-dom'
import React, { useEffect } from 'react'
import ImageList from '@mui/material/ImageList'
import ImageListItemBar from '@mui/material/ImageListItemBar'
import ImageListItem from '@mui/material/ImageListItem'
import Grid from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import CONSTANTS from '../../api/common/constants'
import ThemeHarness from '../components/ThemeHarness'
import promisify from '../../api/client/promisify'
import Title from '../components/Title'
import { Box } from '@mui/material'

import { createSlateWithTheme } from '../jotai/atoms'

export default function ShowThemes() {
  const setWithTheme = useSetAtom(createSlateWithTheme)
  const history = useNavigate()
  const [themes, setThemes] = React.useState([])
  async function get(val) {
    const allThemes = await Meteor.callAsync(
      CONSTANTS.methods.themes.getThemes,
      { filter: val }
    )
    setThemes(allThemes)
  }

  let sf = null
  const filterThemes = (val) => {
    clearTimeout(sf)
    sf = window.setTimeout(() => {
      get(val)
    }, 500)
  }
  useEffect(() => {
    get()
  }, [])

  const enactSlateWithTheme = async (theme) => {
    setWithTheme(theme)
    const shareId = await Meteor.callAsync(
      CONSTANTS.methods.slates.generateShareId
    )
    history(`/canvas/${shareId}`)
  }

  return (
    <Container component="main" maxWidth="xl" style={{ margin: '10px' }}>
      <Title
        showAdd={false}
        showPaging={false}
        showSearch
        onSearchInputChange={filterThemes}
      >
        Slate Themes
      </Title>
      <Box
        sx={{
          '& .imageList': {
            width: 'auto',
            maxnHeight: '300px',
            height: 'auto',
            padding: 0,
          },
        }}
      >
        <ImageList gap={10} cols={3} rowHeight={400}>
          {themes.map((theme) => (
            <ImageListItem
              className="imageListTile"
              key={theme._id}
              sx={{
                overflow: 'hidden',
                height: '100%',
                borderRadius: '10px',
                maxHeight: '300px',
              }}
            >
              <ThemeHarness
                theme={theme}
                onSlateHover={() => {
                  // console.log('slate', slate);
                  // slate.canvas.zoom({
                  //   dur: 500,
                  //   callbacks: {
                  //     after: function() {
                  //       // cb && cb();
                  //     }
                  //   },
                  //   easing: 'easeFromTo',
                  //   zoomPercent: 120
                  // });
                }}
              />
              <ImageListItemBar
                style={{
                  height: '100px',
                  background:
                    'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%)',
                  p: 1,
                  backgroundClip: 'padding-box',
                }}
                position="top"
                title={
                  <Grid
                    container
                    spacing={2}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Grid size={10}>
                      <Typography variant="h5">{theme.name}</Typography>
                      <Typography variant="body2">
                        {theme.description}
                      </Typography>
                    </Grid>
                    <Grid size={2}>
                      <Button
                        fullWidth
                        variant="contained"
                        color="primary"
                        onClick={() => {
                          enactSlateWithTheme(theme)
                        }}
                      >
                        Use
                      </Button>
                    </Grid>
                  </Grid>
                }
              />
            </ImageListItem>
          ))}
        </ImageList>
      </Box>
    </Container>
  )
}
