/* eslint-disable react/forbid-prop-types */
import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import PropTypes from 'prop-types'
import Select from '@mui/material/Select'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'

import CONSTANTS from '../../../api/common/constants'

export default function AISelect({
  aiProp,
  aiPropDescription,
  currentValue,
  onChange,
  availableTemplates = null,
  availableThemes = null,
  styleVariant,
}) {
  const [aiVal, setAIVal] = React.useState(currentValue)
  if (currentValue && currentValue !== aiVal) {
    // seems like a hack? but this gets themes populated when selected the persona
    setAIVal(currentValue)
  }
  return (
    <FormControl style={{ width: '100%' }}>
      <InputLabel
        style={
          styleVariant
            ? { color: '#ccc', padding: '10px', marginTop: '-13px' }
            : { color: '#fff' }
        }
        id={`ai-${aiProp}`}
      >
        {aiPropDescription}
      </InputLabel>
      {['templateId', 'themeId'].includes(aiProp) ? (
        <Select
          labelId={`ai-${aiProp}`}
          id={`ai-${aiProp}`}
          value={aiVal}
          variant={styleVariant || 'standard'}
          onChange={(e) => {
            setAIVal(e.target.value)
            onChange(e.target.value)
          }}
          fullWidth
        >
          {aiProp === 'templateId' &&
            availableTemplates?.map((t) => (
              <MenuItem value={t.shareId}>{t.options.name}</MenuItem>
            ))}
          {aiProp === 'themeId' && <MenuItem value={null}>None</MenuItem>}
          {aiProp === 'themeId' &&
            availableThemes?.map((t) => (
              <MenuItem value={t.themeId}>{t.name}</MenuItem>
            ))}
        </Select>
      ) : (
        <Select
          labelId={`ai-${aiProp}`}
          id={`ai-${aiProp}`}
          value={aiVal}
          variant={styleVariant || 'standard'}
          onChange={(e) => {
            setAIVal(e.target.value)
            onChange(e.target.value)
          }}
          fullWidth
        >
          {Object.keys(CONSTANTS.ai[aiProp]).map((p) => (
            <MenuItem
              value={p}
              disabled={CONSTANTS.ai[aiProp][p].comingSoon}
            >
              &nbsp;&nbsp;
              {CONSTANTS.ai[aiProp][p].display}
              {CONSTANTS.ai[aiProp][p].comingSoon && (
                <Typography variant="subtitle2">&nbsp;(Coming Soon)</Typography>
              )}
            </MenuItem>
            // </Tooltip>
          ))}
        </Select>
      )}
    </FormControl>
  )
}

AISelect.propTypes = {
  aiProp: PropTypes.string.isRequired,
  aiPropDescription: PropTypes.string.isRequired,
  currentValue: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  availableTemplates: PropTypes.array,
  availableThemes: PropTypes.array,
  styleVariant: PropTypes.string.isRequired,
}
