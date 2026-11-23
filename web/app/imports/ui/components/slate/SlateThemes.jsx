/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material/styles'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import Autocomplete from '@mui/material/Autocomplete'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import Checkbox from '@mui/material/Checkbox'
import ListItemText from '@mui/material/ListItemText'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slateProps'

export default function SlateThemes({ slate, onChange }) {
  const sTheme = slate?.options.syncWithTheme
  const [syncWithTheme, setSync] = React.useState(sTheme)

  const themeId = slate?.options?.basedOnThemeId
  const [currentThemeId, updateThemeId] = React.useState(themeId)
  const [availableThemes, setAvailableThemes] = React.useState([])
  async function getSlateboxThemes() {
    const availThemes = await Meteor.callAsync(
      CONSTANTS.methods.themes.getThemes
    )
    setAvailableThemes(availThemes)
  }

  useEffect(() => {
    getSlateboxThemes()
  }, [])

  const setTheme = (newThemeId) => {
    // event.target.value
    const theme = availableThemes.find((t) => t._id === newThemeId)
    onChange({
      type: 'onSlateThemeChanged',
      data: { theme, syncWithTheme },
    })
    updateThemeId(newThemeId)
  }

  SlateThemes.propTypes = {
    slate: slateProps,
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid
      container
      alignItems="center"
      justifyContent="center"
      spacing={2}
      sx={{ minHeight: '180px' }}
    >
      <Grid size={12}>
        <Tooltip
          title={
            <Typography
              component="div"
              style={{ color: '#fff' }}
              variant="body2"
            >
              Warning: all existing shapes and colors will be replaced by those
              in this theme. You can always rever to a previous snapshot version
              using the snapshot button above.
            </Typography>
          }
        >
          <List>
            <ListItemButton
              role={undefined}
              dense
              onClick={(e) => {
                setSync(!syncWithTheme)
              }}
            >
              <ListItemIcon>
                <Checkbox
                  edge="start"
                  checked={syncWithTheme}
                  tabIndex={-1}
                  disableRipple
                />
              </ListItemIcon>
              <ListItemText primary="Sync shapes &amp; colors" />
            </ListItemButton>
          </List>
        </Tooltip>
      </Grid>
      <Grid size={12}>
        <Autocomplete
          id="slate-themes"
          fullWidth
          selectOnFocus
          clearOnBlur
          handleHomeEndKeys
          value={
            currentThemeId &&
            availableThemes.find((t) => t._id === currentThemeId)
              ? availableThemes.find((t) => t._id === currentThemeId).name
              : null
          }
          options={availableThemes.map((t) => t.name)}
          onChange={(event, themeName) => {
            const getTheme = availableThemes.find((t) => t.name === themeName)
            setTheme(getTheme ? getTheme._id : null)
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Search themes…"
              variant="outlined"
              slotProps={{
                inputLabel: {
                  style: { color: '#fff' },
                },
              }}
            />
          )}
        />
      </Grid>
    </Grid>
  )
}
