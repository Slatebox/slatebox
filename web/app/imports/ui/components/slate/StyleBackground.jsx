// The gradient and picture parts of the slate's Background control (SlateStyle.jsx): gradients to
// start from (one per style) or one of your own (two or three colors, linear at an angle or radial),
// and a picture you upload or find (where this server has a picture search), filled, fitted or
// tiled, dimmed with a color so notes on it stay readable. Each choice is one step of your undo,
// written as the style's own background (presentationBackground.mjs), so Revert to original
// brings back the background from before.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import LinearProgress from '@mui/material/LinearProgress'
import Slider from '@mui/material/Slider'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import UploadIcon from '@mui/icons-material/FileUploadOutlined'
import CONSTANTS from '../../../api/common/constants'
import uploadImage from '../../../api/client/uploadImage'
import PayNotice from '../PayNotice'
import { textOn } from '../presentations/presentationStyles.mjs'
import { DIM_DEFAULT, DIM_MAX, GRADIENT_PRESETS, gradientCss, isPictureUrl, sameGradient } from '../presentations/presentationBackground.mjs'

const label = { display: 'block', mt: 1.5, mb: 0.5, fontWeight: 600 }
const swatchGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: 0.75 }

function Swatch({ on, name, background, ink = '#000000', ...props }) {
  return (
    <ButtonBase role="radio" aria-checked={on} aria-label={name} sx={{ flexDirection: 'column', gap: 0.25, borderRadius: '8px', p: 0.25, fontSize: 11, fontWeight: on ? 700 : 500 }} {...props}>
      <Box component="span" aria-hidden="true" sx={{ display: 'grid', placeItems: 'center', width: 40, height: 28, borderRadius: '8px', background, color: ink, border: '2px solid', borderColor: on ? 'primary.main' : 'divider' }}>
        {on && <CheckIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Box component="span">{name}</Box>
    </ButtonBase>
  )
}
Swatch.propTypes = { on: PropTypes.bool, name: PropTypes.string.isRequired, background: PropTypes.string.isRequired, ink: PropTypes.string }

const HEX = /^#[0-9a-f]{6}$/i

/** The color at `dim`, as CSS (the veil over a picture's preview). */
function tintCss(color, dim) {
  const c = HEX.test(color) ? color : '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${dim || 0})`
}


/** Gradients: one per style to start from, and your own. */
export function GradientPicker({ current = null, busy = false, onApply }) {
  const [draft, setDraft] = useState(() => current || GRADIENT_PRESETS[0].gradient)
  const key = JSON.stringify(current)
  useEffect(() => { if (current) setDraft(current) }, [key])
  const setColor = (index, value) => setDraft((was) => ({ ...was, colors: was.colors.map((c, i) => (i === index ? value.toLowerCase() : c)) }))
  const ready = draft.colors.every((c) => HEX.test(c))
  return (
    <Box data-slate-background-gradient>
      <Box role="radiogroup" aria-label="Gradients" sx={swatchGrid}>
        {GRADIENT_PRESETS.map((preset) => (
          <Swatch key={preset.id} on={sameGradient(current, preset.gradient)} name={preset.name} background={gradientCss(preset.gradient)} ink={textOn(preset.color)}
            data-slate-gradient-preset={preset.id} aria-disabled={busy || undefined} onClick={() => !busy && onApply(preset.gradient)} />
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={label}>Your own</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {draft.colors.map((color, index) => (
          // eslint-disable-next-line react/no-array-index-key -- a stop is its place in the gradient
          <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <Box component="input" type="color" value={HEX.test(color) ? color : '#000000'} onChange={(event) => setColor(index, event.target.value)}
              aria-label={`Gradient color ${index + 1}`} data-slate-gradient-color={index}
              sx={{ width: 32, height: 28, p: 0, border: 1, borderColor: 'divider', borderRadius: '6px', bgcolor: 'transparent', cursor: 'pointer' }} />
            {draft.colors.length > 2 && (
              <IconButton size="small" aria-label={`Remove gradient color ${index + 1}`} onClick={() => setDraft((was) => ({ ...was, colors: was.colors.filter((_, i) => i !== index) }))}>
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        ))}
        {draft.colors.length < 3 && (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setDraft((was) => ({ ...was, colors: [...was.colors, was.colors[was.colors.length - 1]] }))}>Add a color</Button>
        )}
      </Box>
      <ToggleButtonGroup size="small" exclusive value={draft.type} aria-label="Gradient shape" sx={{ mt: 1 }}
        onChange={(_, type) => type && setDraft((was) => (type === 'radial' ? { type, colors: was.colors } : { type, colors: was.colors, angle: was.angle ?? 180 }))}>
        <ToggleButton value="linear">Linear</ToggleButton>
        <ToggleButton value="radial">Radial</ToggleButton>
      </ToggleButtonGroup>
      {draft.type === 'linear' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, px: 0.5 }}>
          <Typography variant="caption" id="slate-gradient-angle">Angle</Typography>
          <Slider size="small" min={0} max={345} step={15} value={draft.angle ?? 180} aria-labelledby="slate-gradient-angle"
            valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}°`} getAriaValueText={(v) => `${v} degrees`}
            onChange={(_, angle) => setDraft((was) => ({ ...was, angle }))} data-slate-gradient-angle />
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
        <Box aria-hidden="true" data-slate-gradient-preview sx={{ flex: 1, height: 32, borderRadius: '8px', border: 1, borderColor: 'divider', background: ready ? gradientCss(draft) : 'transparent' }} />
        <Button size="small" variant="outlined" disabled={busy || !ready || sameGradient(current, draft)} onClick={() => onApply(draft)} data-slate-gradient-apply>
          Use this gradient
        </Button>
      </Box>
    </Box>
  )
}
GradientPicker.propTypes = {
  current: PropTypes.shape({ type: PropTypes.string, colors: PropTypes.arrayOf(PropTypes.string), angle: PropTypes.number }),
  busy: PropTypes.bool,
  onApply: PropTypes.func.isRequired,
}

const FITS = [{ value: 'cover', name: 'Fill' }, { value: 'contain', name: 'Fit' }, { value: 'repeat', name: 'Tile' }]
const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const UPLOAD_MAX = 20 * 1024 * 1024

/**
 * A picture: upload your own, or find one where this server has a picture search (asked once;
 * without one there is no search box). Then fill, fit or tile it, and dim it with a color.
 * `tints` are the colors to dim with: [{ color, name }].
 */
export function PicturePicker({ current = null, color, tints, busy = false, onApply, onRemove }) {
  const input = useRef(null)
  const [progress, setProgress] = useState(null)
  const [problem, setProblem] = useState('')
  const [dim, setDim] = useState(current ? current.dim : DIM_DEFAULT)
  useEffect(() => { setDim(current ? current.dim : DIM_DEFAULT) }, [current?.url, current?.dim])
  const [searchReady, setSearchReady] = useState(false)
  useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.images.searchReady).then((ready) => { if (live) setSearchReady(ready === true) }).catch(() => {})
    return () => { live = false }
  }, [])
  const [query, setQuery] = useState('')
  const [found, setFound] = useState({ items: [], more: false, page: 0, query: '' })
  const [searching, setSearching] = useState(false)
  const [refused, setRefused] = useState(null)

  const use = (url) => onApply({ url, fit: current?.fit || 'cover', dim: current ? current.dim : DIM_DEFAULT }, color)
  const take = async (file) => {
    setProblem('')
    if (!file) return
    if (!UPLOAD_TYPES.includes(file.type)) { setProblem('Upload a PNG, JPG, GIF or WEBP picture.'); return }
    if (file.size > UPLOAD_MAX) { setProblem('The picture is larger than 20 MB.'); return }
    setProgress(0)
    try {
      const url = await uploadImage(file, setProgress)
      if (!isPictureUrl(url)) throw new Error('The uploaded picture could not be used as a background.')
      await use(url)
    } catch (error) {
      setProblem(error.message || 'The upload failed.')
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }
  const search = async (page = 0) => {
    const q = page === 0 ? query.trim() : found.query
    if (!q || searching) return
    setSearching(true)
    setProblem('')
    setRefused(null)
    try {
      const res = await Meteor.callAsync(CONSTANTS.methods.images.search, { query: q, page })
      // Only pictures a background may show (an https address with nothing that could end a url()).
      const items = (res.items || []).filter((item) => isPictureUrl(item.link))
      setFound((was) => ({ items: page === 0 ? items : [...was.items, ...items], more: res.more, page, query: q }))
      if (!items.length && page === 0) setProblem('No pictures found. Try other words.')
    } catch (error) {
      setProblem(error.reason || 'Pictures could not be searched just now.')
      if (error.details?.pay) setRefused({ error: error.error, reason: error.reason, details: error.details, page })
    } finally {
      setSearching(false)
    }
  }

  return (
    <Box data-slate-background-picture>
      {current && (
        <Box aria-hidden="true" data-slate-picture-preview sx={{
          height: 64, borderRadius: '8px', border: 1, borderColor: 'divider', mb: 1, backgroundColor: color,
          backgroundImage: `linear-gradient(${tintCss(color, current.dim)}, ${tintCss(color, current.dim)}), url("${current.url.replace(/["\\]/g, '')}")`,
          backgroundSize: `100% 100%, ${current.fit === 'repeat' ? 'auto' : current.fit}`, backgroundRepeat: `no-repeat, ${current.fit === 'repeat' ? 'repeat' : 'no-repeat'}`, backgroundPosition: 'center',
        }} />
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button size="small" variant="outlined" startIcon={<UploadIcon />} disabled={busy || progress !== null} onClick={() => input.current?.click()} data-slate-picture-upload>
          {current ? 'Upload another picture' : 'Upload a picture'}
        </Button>
        {current && <Button size="small" disabled={busy} onClick={onRemove} data-slate-picture-remove>Remove picture</Button>}
        <input ref={input} type="file" hidden accept={UPLOAD_TYPES.join(',')} aria-label="Choose a picture" onChange={(event) => take(event.target.files?.[0])} />
      </Box>
      {progress !== null && <LinearProgress variant="determinate" value={progress} sx={{ mt: 1 }} aria-label="Uploading the picture" />}
      {searchReady && (
        <>
          <Box component="form" onSubmit={(event) => { event.preventDefault(); search(0) }} sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <InputBase type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for a picture"
              inputProps={{ 'aria-label': 'Search for a background picture', 'data-slate-picture-search': true }}
              sx={{ flex: 1, fontSize: 13, px: 1, py: 0.25, border: 1, borderColor: 'divider', borderRadius: '8px' }} />
            <Button size="small" type="submit" variant="outlined" disabled={busy || searching || !query.trim()}>{searching ? 'Searching…' : 'Search'}</Button>
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>Each search counts as agent use.</Typography>
          {refused && <PayNotice plain refusal={refused} from="pictures" retry={() => search(refused.page)} />}
          {found.items.length > 0 && (
            <Box role="group" aria-label="Pictures found" sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5, mt: 1 }}>
              {found.items.map((item) => (
                <ButtonBase key={item.link} aria-label={`Use picture: ${item.title || 'untitled'}`} disabled={busy} onClick={() => use(item.link)} sx={{ borderRadius: '6px', overflow: 'hidden', height: 56 }}>
                  <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </ButtonBase>
              ))}
            </Box>
          )}
          {found.more && <Button size="small" disabled={searching} onClick={() => search(found.page + 1)} sx={{ mt: 0.5 }}>More pictures</Button>}
        </>
      )}
      {problem && <Typography role="alert" variant="caption" color="error" sx={{ display: 'block', mt: 1 }} data-slate-picture-problem>{problem}</Typography>}
      {current && (
        <>
          <Typography variant="caption" component="p" sx={label}>Picture fit</Typography>
          <ToggleButtonGroup size="small" exclusive value={current.fit} aria-label="Picture fit" onChange={(_, fit) => fit && !busy && onApply({ ...current, fit }, color)}>
            {FITS.map((fit) => <ToggleButton key={fit.value} value={fit.value} data-slate-picture-fit={fit.value}>{fit.name}</ToggleButton>)}
          </ToggleButtonGroup>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5, px: 0.5 }}>
            <Typography variant="caption" id="slate-picture-dim" sx={{ whiteSpace: 'nowrap' }}>Dim the picture</Typography>
            <Slider size="small" min={0} max={DIM_MAX * 100} step={5} value={Math.round(dim * 100)} aria-labelledby="slate-picture-dim"
              valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}%`} getAriaValueText={(v) => `${v} percent`} disabled={busy}
              onChange={(_, v) => setDim(v / 100)} onChangeCommitted={(_, v) => onApply({ ...current, dim: v / 100 }, color)} data-slate-picture-dim />
          </Box>
          <Typography variant="caption" component="p" sx={label}>Dim with</Typography>
          <Box role="radiogroup" aria-label="Dim with" sx={swatchGrid}>
            {tints.map((tint) => (
              <Swatch key={tint.color} on={tint.color === color} name={tint.name} background={tint.color} ink={textOn(tint.color)}
                data-slate-picture-tint={tint.color} aria-disabled={busy || undefined} onClick={() => !busy && tint.color !== color && onApply(current, tint.color)} />
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            The color is laid over the picture so notes on it stay readable, and words drawn straight on the canvas take the ink that reads on it.
          </Typography>
        </>
      )}
    </Box>
  )
}
PicturePicker.propTypes = {
  current: PropTypes.shape({ url: PropTypes.string, fit: PropTypes.string, dim: PropTypes.number }),
  color: PropTypes.string.isRequired,
  tints: PropTypes.arrayOf(PropTypes.shape({ color: PropTypes.string, name: PropTypes.string })).isRequired,
  busy: PropTypes.bool,
  onApply: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}
