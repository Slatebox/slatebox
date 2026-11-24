// The live preview: a sample slate drawn by the engine (BrandPreviewSlate), the frame a published
// presentation plays in (BasePresent.jsx: the square logo in the corner, the bar in the bar colors),
// and the share image a public slate's link shows (a picture of the slate: server/common/share-image.mjs).
// Each updates as the kit is edited, before it is saved.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore'
import NavigateNextIcon from '@mui/icons-material/NavigateNext'
import BrandPreviewSlate, { CHROME } from '../BrandPreviewSlate'
import { fitSize } from './fitNote.mjs'
import { fontsReady, measurer } from './measure'

function Caption({ title, children }) {
  return (
    <Box sx={{ mb: 0.75 }}>
      <Typography variant="body2" component="h3" sx={{ fontWeight: 700 }}>{title}</Typography>
      {children && <Typography variant="caption" color="text.secondary" component="div">{children}</Typography>}
    </Box>
  )
}
Caption.propTypes = { title: PropTypes.string.isRequired, children: PropTypes.node }
Caption.defaultProps = { children: null }

/** A title in a fixed box, at the largest size that fits with every word whole (fitNote.mjs). */
function FittedTitle({ text, font, maxSize }) {
  const box = useRef(null)
  const [room, setRoom] = useState(null)
  const [fit, setFit] = useState(null)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const watch = new ResizeObserver(([entry]) => setRoom({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }))
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    let live = true
    if (!room?.width || !room?.height) return undefined
    fontsReady([font]).then(() => {
      if (!live) return
      setFit(fitSize({ text, width: room.width - 8, height: room.height - 4, maxSize, measureAt: (s, size) => measurer({ fontSize: size, fontFamily: font })(s) }))
    })
    return () => { live = false }
  }, [text, font, maxSize, room?.width, room?.height])
  return (
    <Box ref={box} sx={{ position: 'absolute', inset: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {fit && (
        <Box component="span" data-fitted-title={fit.size} sx={{ fontFamily: `"${font}"`, fontSize: fit.size, lineHeight: 1.3, textAlign: 'center', whiteSpace: 'pre' }}>
          {fit.lines.join('\n')}
        </Box>
      )}
    </Box>
  )
}
FittedTitle.propTypes = { text: PropTypes.string.isRequired, font: PropTypes.string.isRequired, maxSize: PropTypes.number.isRequired }

function PresentationFrame({ style, logoUrl }) {
  const heading = style.headings[0]
  return (
    <Box data-brand-preview-presentation="" sx={{ position: 'relative', aspectRatio: '16 / 9', borderRadius: '10px', overflow: 'hidden', border: '1px solid', borderColor: 'divider',
      background: style.backgroundColors.length > 1 ? `radial-gradient(circle, ${style.backgroundColors.join(', ')})` : style.background }}>
      <Box sx={{ position: 'absolute', top: 8, left: 8, width: 38, borderRadius: '4px', bgcolor: '#ffffff', opacity: 0.92, p: 0.25, display: 'flex' }}>
        <Box component="img" src={logoUrl || '/images/sb_yellow_boxes.svg'} alt={logoUrl ? 'Your square logo' : 'The Slatebox mark (no square logo yet)'} sx={{ width: '100%' }} />
      </Box>
      <Box sx={{ position: 'absolute', inset: '18% 16% 30%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', bgcolor: heading.backgroundColor, color: heading.foregroundColor, px: 1 }}>
        <FittedTitle text="Quarterly roadmap" font={style.headingFont} maxSize={Math.min(style.headingSize * 1.6, 40)} />
      </Box>
      <Box sx={{ position: 'absolute', left: '15%', right: '15%', bottom: 0, display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5,
        bgcolor: style.barColor, color: style.controlsColor, borderTopLeftRadius: 10, borderTopRightRadius: 10 }}>
        <Typography variant="caption" noWrap sx={{ flex: 1, color: 'inherit', minWidth: 0 }}>Quarterly roadmap</Typography>
        <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: style.controlsColor, color: style.barColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><PlayArrowIcon sx={{ fontSize: 16 }} /></Box>
        <IconButton size="small" tabIndex={-1} aria-hidden sx={{ color: 'inherit', p: 0.25 }}><NavigateBeforeIcon fontSize="small" /></IconButton>
        <IconButton size="small" tabIndex={-1} aria-hidden sx={{ color: 'inherit', p: 0.25 }}><NavigateNextIcon fontSize="small" /></IconButton>
        <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>1/6</Typography>
      </Box>
    </Box>
  )
}
PresentationFrame.propTypes = { style: PropTypes.object.isRequired, logoUrl: PropTypes.string }
PresentationFrame.defaultProps = { logoUrl: null }

function ShareCard({ style, picture }) {
  return (
    <Box data-brand-preview-share="" sx={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ aspectRatio: '1.91 / 1', bgcolor: style.background, position: 'relative', '& svg': { width: '100%', height: '100%', display: 'block' } }}
        aria-hidden
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={picture ? { __html: picture } : undefined} />
      <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" component="div">app.slatebox.com</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>Quarterly roadmap</Typography>
        <Typography variant="caption" color="text.secondary" component="div">A public slate on Slatebox</Typography>
      </Box>
    </Box>
  )
}
ShareCard.propTypes = { style: PropTypes.object.isRequired, picture: PropTypes.string }
ShareCard.defaultProps = { picture: null }

export default function BrandPreview({ style, logoUrl, compact }) {
  const [picture, setPicture] = useState(null)
  const last = useRef(null)
  const drawn = useCallback((box) => {
    // The share image is a picture of the slate: the same drawing, copied once it is framed.
    setTimeout(() => {
      const svg = box?.querySelector('svg')
      if (!svg) return
      const copy = svg.cloneNode(true)
      copy.removeAttribute('id')
      copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
      copy.querySelectorAll(CHROME.join(',')).forEach((el) => el.remove())
      const html = copy.outerHTML
      if (html !== last.current) { last.current = html; setPicture(html) }
    }, 400)
  }, [])
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Caption title="A new slate">Notes sized for their words, as on a real slate.</Caption>
        <BrandPreviewSlate previewId="brand-kit" style={style} height={compact ? 220 : 300} onDrawn={drawn} />
      </Box>
      <Box>
        <Caption title="A published presentation">The square logo and bar colors frame every published presentation.</Caption>
        <PresentationFrame style={style} logoUrl={logoUrl} />
      </Box>
      <Box>
        <Caption title="Share image">A public slate&apos;s link shows a picture of the slate, so it carries your style. Your logo is not added.</Caption>
        <ShareCard style={style} picture={picture} />
      </Box>
    </Box>
  )
}
BrandPreview.propTypes = { style: PropTypes.object.isRequired, logoUrl: PropTypes.string, compact: PropTypes.bool }
BrandPreview.defaultProps = { logoUrl: null, compact: false }
