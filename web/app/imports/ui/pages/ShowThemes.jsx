/* eslint-disable no-underscore-dangle */
import Container from '@material-ui/core/Container'
import { Meteor } from 'meteor/meteor'
import { useDispatch } from 'react-redux'
import { useHistory } from 'react-router-dom'
import React, { useEffect } from 'react'
import GridList from '@material-ui/core/GridList'
import GridListTileBar from '@material-ui/core/GridListTileBar'
import GridListTile from '@material-ui/core/GridListTile'
import { makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import Typography from '@material-ui/core/Typography'
import Button from '@material-ui/core/Button'
import CONSTANTS from '../../api/common/constants'
import ThemeHarness from '../components/ThemeHarness'
import promisify from '../../api/client/promisify'
import Title from '../components/Title'

const useStyles = makeStyles(() => ({
  gridList: {
    width: 'auto',
    minHeight: '600px',
    height: 'auto',
    cursor: 'pointer',
    padding: 0,
  },
  gridListTile: {
    cursor: 'pointer',
    '& svg': {
      cursor: 'pointer',
    },
  },
}))

export default function ShowThemes() {
  const dispatch = useDispatch()
  const classes = useStyles()
  const history = useHistory()
  const [themes, setThemes] = React.useState([])
  async function get(val) {
    const allThemes = await promisify(
      Meteor.call,
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

  const createSlateWithTheme = async (theme) => {
    dispatch({ type: 'canvas', createWithTheme: theme })
    const shareId = await promisify(
      Meteor.call,
      CONSTANTS.methods.slates.generateShareId
    )
    history.push(`/canvas/${shareId}`)
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
      <GridList spacing={10} cols={2} cellHeight={400}>
        {themes.map((theme) => (
          <GridListTile className={classes.gridListTile} key={theme._id}>
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
            <GridListTileBar
              style={{ height: '100px' }}
              title={
                <Grid container spacing={12}>
                  <Grid item xs={10}>
                    <Typography variant="h5">{theme.name}</Typography>
                    <Typography variant="body2">{theme.description}</Typography>
                  </Grid>
                  <Grid item xs={2}>
                    <Button
                      fullWidth
                      variant="contained"
                      color="secondary"
                      onClick={() => {
                        createSlateWithTheme(theme)
                      }}
                    >
                      Use Theme
                    </Button>
                  </Grid>
                </Grid>
              }
            />
          </GridListTile>
        ))}
      </GridList>
    </Container>
  )
}
