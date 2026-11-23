import React from 'react'
import { Meteor } from 'meteor/meteor'
import Grid from '@mui/material/Grid2'
import Tooltip from '@mui/material/Tooltip'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import Typography from '@mui/material/Typography'
import HexColor from '../../common/HexColor'
import promisify from '../../../api/client/promisify'
import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slateProps'

export default function GenerateNodeColors({ slate }) {
  let bcolor = slate?.options?.containerStyle?.backgroundColor
  bcolor = bcolor || '#fff'
  const [selectedColor, updateColor] = React.useState(bcolor)
  const [selectedOpacity, updateOpacity] = React.useState(1)
  const [genType, setType] = React.useState(null)

  const setColor = (color, opacity) => {
    updateColor(color)
    updateOpacity(opacity)
  }

  const genColors = async (event, newType) => {
    let nntype = newType
    if (!nntype) {
      nntype = genType
    } else {
      setType(nntype)
    }
    const palette = await Meteor.callAsync(
      CONSTANTS.methods.themes.buildColorPalette,
      { type: newType, base: selectedColor }
    )
    const c = slate.collab
    if (slate.options.eligibleForThemeCompilation) {
      const ppkg = {
        type: 'onNodeColorChanged',
        data: { id: `parent`, opacity: selectedOpacity, color: palette[0] },
      }
      c.invoke(ppkg)
      c.send(ppkg)
      for (let p = 1; p < palette.length; p += 1) {
        const cpkg = {
          type: 'onNodeColorChanged',
          data: {
            id: `child_${p}`,
            opacity: selectedOpacity,
            color: palette[p],
          },
        }
        c.invoke(cpkg)
        c.send(cpkg)
      }
    } else {
      let p = -1
      slate.nodes.allNodes.forEach((n) => {
        if (!n.options.image.length) {
          p += 1
          if (p > palette.length) {
            p = 0
          }
          const cpkg = {
            type: 'onNodeColorChanged',
            data: {
              id: n.options.id,
              opacity: selectedOpacity,
              color: palette[p],
            },
          }
          c.invoke(cpkg)
          c.send(cpkg)
        }
      })
    }
  }

  GenerateNodeColors.propTypes = {
    slate: slateProps,
  }

  return (
    <Grid container alignItems="center" justifyContent="center" spacing={4}>
      <Grid>
        <Typography variant="body2">
          Automatically generate complementary colors or shades for all the
          nodes on this slate. Select a single color then click the
          complementary or shades button to generate. NOTE: this will replace
          the current node colors.
        </Typography>
      </Grid>
      <Grid>
        <HexColor
          color={selectedColor}
          opacity={selectedOpacity}
          onChange={setColor}
        />
      </Grid>
      <Grid>
        <ToggleButtonGroup
          value={genType}
          exclusive
          onChange={genColors}
          aria-label="gen type"
        >
          <ToggleButton value="palette" aria-label="palette">
            <Tooltip
              title="Generate complementary colors based on the selected color"
              placement="top"
            >
              <Typography variant="body2">Complementary</Typography>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="shades" aria-label="shades">
            <Tooltip
              title="Generate shades of the selected color based on the selected color"
              placement="top"
            >
              <Typography variant="body2">Shades</Typography>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Grid>
    </Grid>
  )
}
