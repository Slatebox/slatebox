// A style (a preset): the fonts, note colors, background and presentation bar a kind of slate gets.
// It edits the same preset value as before; every field shows what slates get when it is left unset.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Popover from '@mui/material/Popover'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CONSTANTS from '../../../api/common/constants'
import {
  BRAND_FONTS, SIZE_CHOICES, MIN_FONT_SIZE, MAX_FONT_SIZE, SLATEBOX_DEFAULTS,
  backgroundKind, backgroundOf, backgroundValue, fontInfo, fontSize, inkOn, normalHex,
} from './brandKit.mjs'
import { ContrastBadge, Dot, Label } from './ui'

/** A button showing a color; opens the kit's swatches, black and white, and any color. */
export function ColorChoice({ value, palette, onChange, label, allowAuto, disabled, testId }) {
  const [anchor, setAnchor] = useState(null)
  const name = value ? (palette.find((c) => c.value === value)?.name || value) : 'Automatic'
  const swatches = [...palette.map((c) => ({ value: c.value, name: c.name })), { value: '#ffffff', name: 'White' }, { value: '#111111', name: 'Black' }]
    .filter((s, i, all) => all.findIndex((o) => o.value === s.value) === i)
  const pick = (v) => { setAnchor(null); onChange(v) }
  return (
    <>
      <ButtonBase disabled={disabled} onClick={(e) => setAnchor(e.currentTarget)} aria-label={`${label}: ${name}`} data-color-choice={testId}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1, py: 0.5, borderRadius: '8px', border: '1px solid', borderColor: 'divider', minHeight: 36, maxWidth: '100%' }}>
        <Dot color={value || 'transparent'} />
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>{name}</Typography>
      </ButtonBase>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 1.5, display: 'grid', gap: 1, maxWidth: 280 }}>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {swatches.map((s) => (
              <ButtonBase key={s.value} onClick={() => pick(s.value)} aria-label={s.name} title={s.name}
                sx={{ width: 30, height: 30, borderRadius: '8px', bgcolor: s.value, border: '2px solid', borderColor: s.value === value ? 'primary.main' : 'rgba(0,0,0,.15)' }} />
            ))}
          </Box>
          <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}>
            <input type="color" defaultValue={value || '#40709a'} onChange={(e) => onChange(e.target.value)} aria-label="Any color" style={{ width: 30, height: 30, border: 0, padding: 0, background: 'none' }} />
            <Typography variant="body2">Any color</Typography>
          </Box>
          {allowAuto && <Button size="small" onClick={() => pick(null)}>Automatic (black or white)</Button>}
        </Box>
      </Popover>
    </>
  )
}
ColorChoice.propTypes = {
  value: PropTypes.string, palette: PropTypes.arrayOf(PropTypes.shape({ value: PropTypes.string, name: PropTypes.string })).isRequired,
  onChange: PropTypes.func.isRequired, label: PropTypes.string.isRequired, allowAuto: PropTypes.bool, disabled: PropTypes.bool, testId: PropTypes.string,
}
ColorChoice.defaultProps = { value: null, allowAuto: false, disabled: false, testId: undefined }

function FontField({ label, family, size, isSet, onFamily, onSize, sample, disabled, id, unsetHint }) {
  const info = fontInfo(family)
  const options = info.source === 'missing' ? [...BRAND_FONTS, info] : BRAND_FONTS
  const chip = SIZE_CHOICES.find((s) => s.size === size)
  return (
    <Box data-font-field={id} sx={{ display: 'grid', gap: 1 }}>
      <Label hint={isSet ? null : unsetHint}>{label}</Label>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField select size="small" value={info.family} disabled={disabled} onChange={(e) => onFamily(e.target.value)}
          SelectProps={{ inputProps: { 'aria-label': `${label} font` } }} sx={{ minWidth: 200, flex: '1 1 200px' }}>
          {options.map((f) => (
            <MenuItem key={f.family} value={f.family} sx={{ fontFamily: `"${f.family}"`, display: 'flex', gap: 1 }}>
              <span>{f.label === f.family ? f.family : `${f.family}`}</span>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ fontFamily: 'inherit' }}>
                {f.source === 'served' ? f.label : f.source === 'system' ? 'on every computer' : 'not available on slates'}
              </Typography>
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup size="small" exclusive value={chip ? chip.size : null} disabled={disabled} aria-label={`${label} size`}
          onChange={(_e, v) => v && onSize(v)}>
          {SIZE_CHOICES.map((s) => <ToggleButton key={s.key} value={s.size} aria-label={`${s.name}, ${s.size} pixels`} sx={{ px: 1.25 }}>{s.key}</ToggleButton>)}
        </ToggleButtonGroup>
        <TextField size="small" type="number" value={size} disabled={disabled} onChange={(e) => { const n = fontSize(e.target.value); if (n) onSize(n) }}
          inputProps={{ min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, 'aria-label': `${label} size in pixels` }} sx={{ width: 92 }}
          InputProps={{ endAdornment: <Typography variant="caption" color="text.secondary">px</Typography> }} />
      </Box>
      {info.source === 'missing' && (
        <Typography variant="caption" color="error" component="div" role="note">
          {info.family} is not one of the fonts slates can draw, so notes show in the reader&apos;s default font. Pick one of the fonts listed.
        </Typography>
      )}
      <Box sx={{ fontFamily: `"${info.family}"`, fontSize: Math.min(size, 44), lineHeight: 1.25, overflowWrap: 'normal', wordBreak: 'normal', color: 'text.primary', minWidth: 0, overflow: 'hidden' }} aria-hidden data-font-sample={id}>
        {sample}
      </Box>
    </Box>
  )
}
FontField.propTypes = {
  label: PropTypes.string.isRequired, family: PropTypes.string.isRequired, size: PropTypes.number.isRequired, isSet: PropTypes.bool.isRequired,
  onFamily: PropTypes.func.isRequired, onSize: PropTypes.func.isRequired, sample: PropTypes.string.isRequired, disabled: PropTypes.bool.isRequired, id: PropTypes.string.isRequired,
  unsetHint: PropTypes.string.isRequired,
}

function PairList({ title, hint, pairs, isSet, font, palette, onChange, disabled, id }) {
  const set = (i, patch) => onChange(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  return (
    <Box data-pair-list={id} sx={{ display: 'grid', gap: 1 }}>
      <Label hint={isSet ? hint : `${hint} Not set: slates use the one below.`}>{title}</Label>
      {pairs.map((p, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <Box key={i} data-pair={`${id}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ px: 1.5, py: 0.75, borderRadius: '8px', bgcolor: p.backgroundColor, color: p.foregroundColor, fontFamily: `"${font}"`, fontWeight: 600, border: '1px solid rgba(0,0,0,.08)', minWidth: 52, textAlign: 'center' }} aria-hidden>Aa</Box>
          <ColorChoice label="Fill" value={p.backgroundColor} palette={palette} disabled={disabled} testId={`${id}-${i}-fill`}
            onChange={(v) => {
              const fill = normalHex(v)
              // Text left automatic (black or white) stays automatic on the new fill.
              set(i, { backgroundColor: fill, foregroundColor: p.foregroundColor === inkOn(p.backgroundColor) ? inkOn(fill) : p.foregroundColor })
            }} />
          <ColorChoice label="Text" value={p.foregroundColor} palette={palette} disabled={disabled} allowAuto testId={`${id}-${i}-text`}
            onChange={(v) => set(i, { foregroundColor: v ? normalHex(v) : inkOn(p.backgroundColor) })} />
          <ContrastBadge ink={p.foregroundColor} fill={p.backgroundColor} />
          {isSet && !disabled && (
            <IconButton size="small" aria-label={`Remove ${title.toLowerCase()} ${i + 1}`} onClick={() => onChange(pairs.filter((_, j) => j !== i))}><CloseIcon fontSize="small" /></IconButton>
          )}
        </Box>
      ))}
      {!disabled && pairs.length < 6 && (
        <Box>
          <Button size="small" startIcon={<AddIcon />} onClick={() => {
            const used = new Set(pairs.map((p) => p.backgroundColor))
            const fill = palette.find((c) => !used.has(c.value))?.value || '#e8eef3'
            onChange([...(isSet ? pairs : pairs.slice(0, 1)), { backgroundColor: fill, foregroundColor: inkOn(fill) }])
          }}>Add a color pair</Button>
        </Box>
      )}
    </Box>
  )
}
PairList.propTypes = {
  title: PropTypes.string.isRequired, hint: PropTypes.string.isRequired, pairs: PropTypes.arrayOf(PropTypes.shape({ backgroundColor: PropTypes.string, foregroundColor: PropTypes.string })).isRequired,
  isSet: PropTypes.bool.isRequired, font: PropTypes.string.isRequired, palette: PropTypes.array.isRequired, onChange: PropTypes.func.isRequired, disabled: PropTypes.bool.isRequired, id: PropTypes.string.isRequired,
}

export default function StyleSection({ preset, style, palette, onChange, disabled }) {
  const [shading, setShading] = useState(false)
  const set = (patch, label) => onChange({ ...preset, ...patch }, label)
  const kind = backgroundKind(preset)
  const bgHex = backgroundOf(preset)
  const setBackground = async (nextKind, hex) => {
    const value = normalHex(hex) || bgHex || palette.find((c) => c.role === 'neutral')?.value || '#f4f6f2'
    if (nextKind === 'none') { const { background, ...rest } = preset; onChange(rest, 'Background'); return }
    if (nextKind === 'color') { set({ background: backgroundValue('color', value) }, 'Background'); return }
    setShading(true)
    try {
      const shades = await Meteor.callAsync(CONSTANTS.methods.colors.buildColorPalette, { type: 'shades', base: value })
      set({ background: backgroundValue('gradient', value, shades) }, 'Background')
    } catch {
      set({ background: backgroundValue('gradient', value, [value]) }, 'Background')
    } finally {
      setShading(false)
    }
  }
  return (
    <Box sx={{ display: 'grid', gap: 2.5 }}>
      <FontField id="heading" label="Heading font" family={style.headingFont} size={style.headingSize} isSet={style.custom.headingFont || style.custom.headingSize}
        sample="Quarterly roadmap" disabled={disabled} unsetHint={`Not set: new notes use ${SLATEBOX_DEFAULTS.headingFont} at ${SLATEBOX_DEFAULTS.headingSize}px.`}
        onFamily={(f) => set({ categoryFont: f }, 'Heading font')} onSize={(n) => set({ categoryFontSize: n }, 'Heading size')} />
      <FontField id="note" label="Note font" family={style.noteFont} size={style.noteSize} isSet={style.custom.noteFont || style.custom.noteSize}
        sample="Interview twelve customers about onboarding" disabled={disabled} unsetHint="Not set: the AI picks fonts and sizes for the notes under headings."
        onFamily={(f) => set({ noteFont: f }, 'Note font')} onSize={(n) => set({ noteFontSize: n }, 'Note size')} />
      <PairList id="headings" title="Heading notes" hint="New notes take the first pair. The AI uses all of them for headings."
        pairs={style.headings} isSet={style.custom.headings} font={style.headingFont} palette={palette} disabled={disabled}
        onChange={(next) => set({ categoryStyles: next }, 'Heading colors')} />
      <PairList id="notes" title="Other notes" hint="The AI uses these for the notes under headings."
        pairs={style.notes} isSet={style.custom.notes} font={style.noteFont} palette={palette} disabled={disabled}
        onChange={(next) => set({ noteStyles: next }, 'Note colors')} />
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Label hint={kind === 'none' ? 'Not set: slates start white (dark in dark mode).' : 'Every new slate starts on it.'}>Slate background</Label>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <ToggleButtonGroup size="small" exclusive value={kind} disabled={disabled || shading} onChange={(_e, v) => v && setBackground(v)} aria-label="Slate background">
            <ToggleButton value="none">Slatebox&apos;s</ToggleButton>
            <ToggleButton value="color">One color</ToggleButton>
            <ToggleButton value="gradient">Soft gradient</ToggleButton>
          </ToggleButtonGroup>
          {kind !== 'none' && <ColorChoice label="Background color" value={bgHex} palette={palette} disabled={disabled || shading} onChange={(v) => setBackground(kind, v)} testId="background" />}
          {shading && <Typography variant="caption" color="text.secondary">Making the gradient…</Typography>}
        </Box>
      </Box>
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Label hint="The bar under a published presentation, with its buttons and words.">Presentation bar</Label>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <ColorChoice label="Bar color" value={style.barColor} palette={palette} disabled={disabled} testId="bar"
            onChange={(v) => set({ presentationMenuBgColorKey: normalHex(v), ...(style.custom.controls ? {} : { presentationControlsColorKey: inkOn(normalHex(v)) }) }, 'Presentation bar')} />
          <ColorChoice label="Buttons and words" value={style.controlsColor} palette={palette} disabled={disabled} allowAuto testId="controls"
            onChange={(v) => set({ presentationControlsColorKey: v ? normalHex(v) : inkOn(style.barColor) }, 'Presentation controls')} />
          <ContrastBadge ink={style.controlsColor} fill={style.barColor} />
        </Box>
      </Box>
    </Box>
  )
}
StyleSection.propTypes = {
  preset: PropTypes.object.isRequired,
  style: PropTypes.object.isRequired,
  palette: PropTypes.array.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool.isRequired,
}
