/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import { useAtom, useAtomValue } from 'jotai'
import {
  currentSlate,
  slateHuddleType,
  currentSlateName,
  slateNameProblem,
} from '../../jotai/atoms'

export default function SlateSettings({ onChange }) {
  const slate = useAtomValue(currentSlate)
  const [getSlateName, setSlateName] = useAtom(currentSlateName)
  const [nameProblem, setNameProblem] = useAtom(slateNameProblem)
  const [getSlateHuddleType, setSlateHuddleType] = useAtom(slateHuddleType)
  const [slateDescription, setSlateDescription] = React.useState(
    slate?.options?.description
  )

  const [showGrid, setSlateShowGrid] = React.useState(
    slate?.options?.viewPort?.showGrid
  )
  const [snapToObjects, setSlatesnapToObjects] = React.useState(
    slate?.options?.viewPort?.snapToObjects
  )
  const [isFollowMe, setSlateFollowMe] = React.useState(
    slate?.options?.followMe
  )
  const [mindMapMode, setSlateMindMapMode] = React.useState(
    slate?.options?.mindMapMode
  )
  const [autoResizeNodesBasedOnText, setAutoResizeNodesBasedOnText] =
    React.useState(slate?.options?.autoResizeNodesBasedOnText)

  const setShowGrid = (e) => {
    setSlateShowGrid(e.target.checked)
    onChange({
      type: 'onSlateShowGridChanged',
      data: { showGrid: e.target.checked },
    })
  }

  const setSnapToObjects = (e) => {
    setSlatesnapToObjects(e.target.checked)
    onChange({
      type: 'onSlateSnapToObjectsChanged',
      data: { snapToObjects: e.target.checked },
    })
  }

  const setFollowMe = (e) => {
    setSlateFollowMe(e.target.checked)
    onChange({
      type: 'onSlateFollowMeChanged',
      data: { followMe: e.target.checked },
    })
  }

  const setHuddleType = (val) => {
    setSlateHuddleType(val)
    // setHuddleEnabled(false)
    onChange({
      type: 'onSlateHuddleChanged',
      data: {
        huddleType: val,
        huddleEnabled: false,
      },
    })
  }

  const setMindMap = (e) => {
    setSlateMindMapMode(e.target.checked)
    onChange({
      type: 'onSlateMindMapModeChanged',
      data: { mindMapMode: e.target.checked },
    })
  }

  const setAutoResize = (e) => {
    setAutoResizeNodesBasedOnText(e.target.checked)
    onChange({
      type: 'onSlateAutoResizeNodesBasedOnTextChanged',
      data: { autoResizeNodesBasedOnText: e.target.checked },
    })
  }

  const setName = (e) => {
    setNameProblem('')
    setSlateName(e.target.value)
  }

  const setDescription = (e) => {
    setSlateDescription(e.target.value)
    onChange({
      type: 'onSlateDescriptionChanged',
      data: { description: e.target.value },
    })
  }

  return (
    <Grid container alignItems="center" justifyContent="flex-start" spacing={1}>
      <Grid size={12}>
        <TextField
          label="Name"
          variant="outlined"
          onChange={setName}
          value={getSlateName}
          error={Boolean(nameProblem)}
          helperText={nameProblem || undefined}
          // A workshop names its slate, and a workshop's title has at most 120 characters.
          slotProps={{ htmlInput: slate?.workshopTitled ? { maxLength: 120 } : {}, formHelperText: { role: 'alert' } }}
          fullWidth
        />
      </Grid>
      {/* A workshop slate's description is written from its workshop: the title, lanes and cards. */}
      {!slate?.workshopTitled && (
        <Grid size={12}>
          <TextField
            label="Description"
            multiline
            minRows={3}
            value={slateDescription}
            onChange={setDescription}
            variant="outlined"
            fullWidth
          />
        </Grid>
      )}
      <Grid size={8}>
        <Typography variant="body2">Mind map mode</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip title="A note you add joins its neighbor with a line" placement="top">
          <Switch onChange={setMindMap} checked={mindMapMode} inputProps={{ 'aria-label': 'Mind map mode' }} />
        </Tooltip>
      </Grid>
      <Grid size={8}>
        <Typography variant="body2">Notes grow to fit their text</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip title="A note grows as you type, so its words always fit" placement="top">
          <Switch
            onChange={setAutoResize}
            checked={autoResizeNodesBasedOnText}
            inputProps={{ 'aria-label': 'Notes grow to fit their text' }}
          />
        </Tooltip>
      </Grid>
      <Grid size={12}>
        <Select
          value={getSlateHuddleType}
          size="small"
          onChange={(e) => {
            setHuddleType(e.target.value)
          }}
          variant="outlined"
          inputProps={{ 'aria-label': 'Huddles on this slate' }}
        >
          <MenuItem key="disabled" value="disabled">
            No huddles
          </MenuItem>
          <MenuItem key="audio" value="audio">
            Audio huddles
          </MenuItem>
          <MenuItem key="video" value="video">
            Video huddles
          </MenuItem>
        </Select>
      </Grid>
      <Grid size={8}>
        <Typography variant="body2">Show grid</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip title="Show a grid behind the notes" placement="top">
          <Switch onChange={setShowGrid} checked={showGrid} inputProps={{ 'aria-label': 'Show grid' }} />
        </Tooltip>
      </Grid>
      <Grid size={8}>
        <Typography variant="body2">Snap to neighbors</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip title="A note you drag lines up with the notes beside it" placement="top">
          <Switch onChange={setSnapToObjects} checked={snapToObjects} inputProps={{ 'aria-label': 'Snap to neighbors' }} />
        </Tooltip>
      </Grid>
      <Grid size={8}>
        <Typography variant="body2">Follow me</Typography>
      </Grid>
      <Grid size={4}>
        <Tooltip title="Everyone on the slate sees what you see as you move around" placement="top">
          <Switch onChange={setFollowMe} checked={isFollowMe} inputProps={{ 'aria-label': 'Follow me' }} />
        </Tooltip>
      </Grid>
    </Grid>
  )
}

SlateSettings.propTypes = {
  onChange: PropTypes.func.isRequired,
}
