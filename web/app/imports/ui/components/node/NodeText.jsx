import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import React from 'react'
import { makeStyles, useTheme } from '@material-ui/core/styles'
import TextField from '@material-ui/core/TextField'
import FormatAlignLeftIcon from '@material-ui/icons/FormatAlignLeft'
import FormatAlignCenterIcon from '@material-ui/icons/FormatAlignCenter'
import FormatAlignRightIcon from '@material-ui/icons/FormatAlignRight'
import FontPicker from 'font-picker-react'
import Grid from '@material-ui/core/Grid'
import Select from '@material-ui/core/Select'
import Paper from '@material-ui/core/Paper'
import MenuItem from '@material-ui/core/MenuItem'
import Divider from '@material-ui/core/Divider'
import useMediaQuery from '@material-ui/core/useMediaQuery'
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup'
import ToggleButton from '@material-ui/lab/ToggleButton'
import HexColor from '../../common/HexColor'
import nodeProps from '../../propTypes/nodeProps'

const useStyles = makeStyles((theme) => ({
  root: {
    width: '100%',
    background: '#fff',
  },
  items: {
    width: 'fit-content',
    marginLeft: 'auto',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    backgroundColor: theme.palette.background.paper,
    color: theme.palette.text.secondary,
    cursor: 'pointer',
    '& svg': {
      margin: theme.spacing(0.5),
    },
    '& hr': {
      margin: theme.spacing(0, 0.5),
    },
  },
  active: {
    color: theme.palette.secondary.main,
  },
  hexInput: {
    padding: '4px 4px',
    width: '110px',
  },
}))

export default function NodeText({ node, onChange }) {
  const theme = useTheme()
  const matches = useMediaQuery(theme.breakpoints.up('md'))

  const classes = useStyles()
  const fontSizes = []
  for (let ptx = 10; ptx < 201; ptx += 1) {
    if (ptx % 2 === 0) fontSizes.push(ptx)
  }
  const fonts = [
    'arial',
    'times-new-roman',
    'georgia',
    'courier-prime',
    'indie-flower',
    'abril-fatface',
    'bangers',
    'caveat',
    'eb-garamond',
    'fredoka-one',
    'graduate',
    'gravitas-one',
    'ibm-plex-mono',
    'ibm-plex-sans',
    'ibm-plex-serif',
    'lemon',
    'nixie-one',
    'noto-sans',
    'pt-sans',
    'pt-sans-narrow',
    'pt-serif',
    'permanent-marker',
    'rammetto-one',
    'roboto',
    'roboto-condensed',
    'roboto-mono',
    'roboto-slab',
    'titan-one',
  ]

  function svgToHtmlAlign(svg) {
    if (svg === 'end') return 'right'
    if (svg === 'start') return 'left'
    return 'center'
  }

  const [value, setText] = React.useState(node?.options?.text)
  const [fontSize, setSize] = React.useState(node?.options?.fontSize)
  const [foregroundColor, setColor] = React.useState(
    node?.options?.foregroundColor || '#000'
  )
  const [textOpacity, setOpacity] = React.useState(
    node?.options?.textOpacity || 1
  )
  const [fontFamily, setFont] = React.useState(node?.options?.fontFamily)
  const [alignment, setAlignment] = React.useState(
    svgToHtmlAlign(node?.options?.textXAlign)
  )

  const filterFonts = (font) => fonts.includes(font.id)

  const updateOptions = (opts) => {
    if (opts.text != null) {
      setText(opts.text)
    } else if (opts.fontFamily) {
      setFont(opts.fontFamily)
    } else if (opts.textXAlign) {
      setAlignment(svgToHtmlAlign(opts.textXAlign))
    } else if (opts.fontColor) {
      setColor(opts.fontColor)
    } else if (opts.fontSize) {
      setSize(opts.fontSize)
    } else if (opts.textOpacity != null) {
      setOpacity(opts.textOpacity)
    }

    window.clearTimeout(window.updateText)
    window.updateText = setTimeout(() => {
      // var textPkg = { type: "onNodeTextChanged", data: { text: _self._.options.text, fontSize: _self._.options.fontSize, fontFamily: _self._.options.fontFamily, fontColor: _self._.options.foregroundColor, textXAlign: _self._.options.textXAlign, textYAlign: _self._.options.textYAlign } };
      const textPkg = { type: 'onNodeTextChanged', data: {} }
      Object.assign(textPkg.data, opts)
      onChange(textPkg)
    }, 250)
  }

  const effects = node?.slate?.filters?.availableFilters || []
  const availEffects = []
  Object.keys(effects).forEach((e) => {
    if (effects[e].types.includes('text')) {
      availEffects.push(e)
    }
  })
  const filterId = node?.options?.filters?.text

  const [selectedFilter, updateEffect] = React.useState(filterId)

  const setEffect = (event, sFilterId) => {
    // event.target.value
    onChange({
      type: 'onNodeEffectChanged',
      data: { filter: { apply: 'text', id: sFilterId } },
    })
    updateEffect(sFilterId)
  }

  let bgColor = node?.options?.backgroundColor.split('-')
  // eslint-disable-next-line no-nested-ternary
  bgColor = bgColor ? (bgColor.length > 1 ? bgColor[1] : bgColor[0]) : null

  NodeText.propTypes = {
    node: nodeProps.isRequired,
    onChange: PropTypes.func.isRequired,
  }

  return (
    <div>
      <Grid
        container
        alignItems="flex-start"
        alignContent="flex-end"
        justify="space-between"
        spacing={1}
      >
        <Grid item xs={6}>
          <TextField
            id="txtNode"
            multiline
            variant="outlined"
            inputProps={{
              style: {
                width: '100%',
                height: '140px',
                lineHeight: 1,
                fontFamily,
                textAlign: alignment,
                color: foregroundColor,
                fontSize,
              },
            }}
            className={classes.root}
            value={value}
            style={{ backgroundColor: bgColor }}
            onChange={(e) => {
              // window.clearTimeout(window.updateText);
              // window.updateText = setTimeout(() => {
              //   console.log("now sending update", e.target.value);
              updateOptions({ text: e.target.value })
              // }, 2000);
            }}
            autoFocus
            onFocus={(e) => {
              const self = e.target
              setTimeout(() => {
                // eslint-disable-next-line no-multi-assign
                self.selectionStart = self.selectionEnd = 10000
              }, 0)
            }}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
        </Grid>
        <Grid item xs={4}>
          <Grid container className={classes.items}>
            <FormatAlignLeftIcon
              className={
                alignment === svgToHtmlAlign('start') ? classes.active : ''
              }
              onClick={() => {
                updateOptions({ textXAlign: 'start' })
              }}
            />
            <FormatAlignCenterIcon
              className={
                alignment === svgToHtmlAlign('middle') ? classes.active : ''
              }
              onClick={() => {
                updateOptions({ textXAlign: 'middle' })
              }}
            />
            <FormatAlignRightIcon
              className={
                alignment === svgToHtmlAlign('end') ? classes.active : ''
              }
              onClick={() => {
                updateOptions({ textXAlign: 'end' })
              }}
            />
            <Divider orientation="vertical" flexItem />
            <Select
              labelId="font-size-label"
              id="font-size"
              value={fontSize}
              onChange={(e) => {
                updateOptions({ fontSize: e.target.value })
              }}
              label="Size"
            >
              {fontSizes.map((f) => (
                <MenuItem key={f} value={f}>
                  {f}
                </MenuItem>
              ))}
            </Select>
            <Divider orientation="vertical" flexItem />
            {/* Overrides the background color on the main */}
            <FontPicker
              apiKey={Meteor.settings.public.googleFontAPIKey}
              activeFontFamily={fontFamily}
              filter={filterFonts}
              onChange={(font) => updateOptions({ fontFamily: font.family })}
            />
            <Divider orientation="vertical" flexItem />
            <Paper
              style={{
                width: '25px',
                height: '35px',
                backgroundColor: '#fff',
                border: '1px solid #000',
              }}
              onClick={() => {
                updateOptions({ fontColor: '#fff', textOpacity: 1 })
              }}
            />
            <Paper
              style={{
                width: '25px',
                height: '35px',
                backgroundColor: '#000',
                border: '1px solid #ccc',
              }}
              onClick={() => {
                updateOptions({ fontColor: '#000', textOpacity: 1 })
              }}
            />
            <Divider flexItem />
            <ToggleButtonGroup
              value={selectedFilter}
              exclusive
              onChange={setEffect}
              aria-label="text effect"
            >
              {availEffects.map((e) => (
                <ToggleButton size="small" key={e} value={e} aria-label={e}>
                  {e}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Grid>
        </Grid>
        {matches && (
          <Grid item xs={2}>
            <HexColor
              opacity={textOpacity}
              color={foregroundColor}
              onChange={(color, opacity) => {
                updateOptions({ fontColor: color, textOpacity: opacity })
              }}
            />
          </Grid>
        )}
      </Grid>
    </div>
  )
}
