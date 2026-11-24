/* eslint-disable new-cap */
// The brand kit's sample slate: drawn by the engine itself, read-only, as the gallery's still pictures
// are (SnapSlate.jsx), so its notes look exactly as notes on a real slate do. Each note is sized for its
// words the way real slates size them (brand/fitNote.mjs), after its font has loaded, so the engine
// lays every word out whole and inside its note at any font, size or preset.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import { Slatebox } from 'slateboxjs'
import { sampleSlate } from './brand/brandKit.mjs'
import { fitInPage, fontsReady } from './brand/measure'
import { stillPicture } from './stillPicture.mjs'

export default function BrandPreviewSlate({ previewId, style, height, onDrawn }) {
  const containerId = `brand-preview-${previewId}`
  const slateRef = useRef(null)
  const boxRef = useRef(null)
  const [ready, setReady] = useState(false)
  const drawing = useRef(0)

  useEffect(() => {
    let live = true
    let slate = null
    ;(async () => {
      try {
        slate = await new Slatebox.slate(
          {
            container: containerId,
            containerStyle: { backgroundColor: style.background },
            viewPort: { allowDrag: false, useInertiaScrolling: false, showGrid: false, snapToObjects: false },
            name: 'Brand preview',
            mediaPlayback: false,
            showbirdsEye: false,
            showLocks: false,
            showMultiSelect: false,
            showUndoRedo: false,
            showZoom: false,
            showAddNodes: false,
            allowCollaboration: false,
            autoResizeNodesBasedOnText: false,
          },
          { onInitCollaboration: async () => null, onCanvasClicked: () => {} }
        ).init()
        if (!live) { slate.destroy?.(); return }
        slateRef.current = slate
        setReady(true)
      } catch (error) {
        console.error('Brand preview: the slate did not start', error)
      }
    })()
    const stop = stillPicture(boxRef.current, 'A sample slate in your brand')
    return () => {
      live = false
      stop()
      try { slateRef.current?.destroy?.() } catch { /* already gone */ }
      slateRef.current = null
      const el = document.getElementById(containerId)
      if (el) el.innerHTML = ''
    }
  }, [containerId])

  // Redraw on every change of style, the newest change winning.
  const styleKey = JSON.stringify(style)
  useEffect(() => {
    if (!ready || !slateRef.current) return undefined
    const turn = ++drawing.current
    const timer = setTimeout(async () => {
      await fontsReady([style.headingFont, style.noteFont])
      if (turn !== drawing.current || !slateRef.current) return
      const json = sampleSlate(style, fitInPage)
      const slate = slateRef.current
      try {
        await slate.loadJSON(JSON.stringify(json))
        slate.collab?.invoke?.({
          type: 'onSlateBackgroundColorChanged',
          data: {
            color: style.background,
            asGradient: style.backgroundColors.length > 1,
            gradientType: 'radial',
            gradientColors: style.backgroundColors,
            gradientStrategy: 'shades',
          },
        })
        requestAnimationFrame(() => {
          if (turn !== drawing.current) return
          slate.controller?.scaleToFitAndCenter?.(() => onDrawn?.(boxRef.current))
        })
      } catch (error) {
        console.error('Brand preview: the sample did not draw', error)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [ready, styleKey])

  return (
    <Box ref={boxRef} data-brand-preview-slate="" sx={{ position: 'relative', width: '100%', height, borderRadius: '10px', overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: style.background }}>
      <Box id={containerId} sx={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
    </Box>
  )
}

BrandPreviewSlate.propTypes = {
  previewId: PropTypes.string.isRequired,
  style: PropTypes.shape({
    background: PropTypes.string,
    backgroundColors: PropTypes.arrayOf(PropTypes.string),
    headings: PropTypes.arrayOf(PropTypes.shape({ backgroundColor: PropTypes.string, foregroundColor: PropTypes.string })),
    notes: PropTypes.arrayOf(PropTypes.shape({ backgroundColor: PropTypes.string, foregroundColor: PropTypes.string })),
    headingFont: PropTypes.string,
    headingSize: PropTypes.number,
    noteFont: PropTypes.string,
    noteSize: PropTypes.number,
  }).isRequired,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.object]),
  onDrawn: PropTypes.func,
}
BrandPreviewSlate.defaultProps = { height: 300, onDrawn: null }
