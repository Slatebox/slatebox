/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
import Autocomplete from '@material-ui/lab/Autocomplete'
import List from '@material-ui/core/List'
import ListItem from '@material-ui/core/ListItem'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import Checkbox from '@material-ui/core/Checkbox'
import ListItemText from '@material-ui/core/ListItemText'
import Tooltip from '@material-ui/core/Tooltip'
import Typography from '@material-ui/core/Typography'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import slateProps from '../../propTypes/slatePriops'

export default function SlateThemes({ slate, onChange }) {
  const sTheme = slate?.options.syncWithTheme
  const [syncWithTheme, setSync] = React.useState(sTheme)

  const themeId = slate?.options?.basedOnThemeId
  const [currentThemeId, updateThemeId] = React.useState(themeId)
  const [availableThemes, setAvailableThemes] = React.useState([])
  async function getSlateboxThemes() {
    const availThemes = await promisify(
      Meteor.call,
      CONSTANTS.methods.themes.getThemes,
      { slateId: slate?.options.id }
    )
    setAvailableThemes(availThemes)
  }

  useEffect(() => {
    getSlateboxThemes()
  }, [])

  const setTheme = (newThemeId) => {
    // event.target.value
    const mtheme = availableThemes.find((t) => t._id === newThemeId)
    onChange({
      type: 'onSlateThemeChanged',
      data: { mtheme, syncWithTheme },
    })
    updateThemeId(newThemeId)
  }

  SlateThemes.propTypes = {
    slate: slateProps.isRequired,
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid
      container
      alignItems="center"
      justify="center"
      spacing={2}
      style={{ minHeight: '180px' }}
    >
      <Grid item xs={12}>
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
            <ListItem
              role={undefined}
              dense
              button
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
            </ListItem>
          </List>
        </Tooltip>
      </Grid>
      <Grid item xs={12}>
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
              label="Search themes..."
              variant="outlined"
              InputLabelProps={{
                style: { color: '#fff' },
              }}
            />
          )}
        />
      </Grid>
    </Grid>
  )
}
