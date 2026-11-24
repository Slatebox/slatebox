/* eslint-disable new-cap */
// The brand kit's sample slate: drawn by the engine itself, read-only, as the gallery's still pictures
// are (SnapSlate.jsx), so its notes look exactly as notes on a real slate do. Every note is the note a
// real slate makes (noteStyle.mjs noteAt, via brandKit.mjs sampleSlate), with nothing fitted by hand:
// the engine's own autofit keeps every word whole and shrinks text to fit, as it does on the canvas.
// It draws twice when the engine grows a note taller (more lines), so the stack never overlaps, and
// the box takes the sample's shape so the notes are drawn near their real size, not tiny.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import { Slatebox } from 'slateboxjs'
import { sampleSlate } from './brand/brandKit.mjs'
import { fontsReady } from './brand/measure'
import { stillPicture } from './stillPicture.mjs'

// The editing chrome a picture of a slate leaves out (the engine's own export list: Export.ts).
export const CHROME = ['[class*="svg_select"]', '.connection-handle', '.connector-handle', '.connector-handle-glyph', '.line-tool-preview',
  '.line-tool-tip', '.comment-badge', '.node-link-badge', '.node-cog', '.node-toolbar', '.line-cog']

export default function BrandPreviewSlate({ previewId, style, columns, onDrawn }) {
  const containerId = `brand-preview-${previewId}`
  const slateRef = useRef(null)
  const boxRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [aspect, setAspect] = useState('4 / 3')
  const [fitTurn, setFitTurn] = useState(0)
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
      const slate = slateRef.current
      const draw = async (heights) => {
        const json = sampleSlate(style, { heights, columns })
        await slate.loadJSON(JSON.stringify(json))
        return json
      }
      try {
        let json = await draw({})
        // The heights the engine grew notes to for their lines: draw again with room for them.
        const grown = Object.fromEntries((slate.nodes?.allNodes || []).map((n) => [n.options?.id, n.options?.height]))
        if (json.nodes.some((n) => (grown[n.options.id] || 0) > n.options.height + 1)) json = await draw(grown)
        if (turn !== drawing.current) return
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
        // The box takes the sample's shape (with a margin), so fitting it fills the box.
        const pad = 48
        setAspect(`${Math.round(json.size.width + pad)} / ${Math.round(json.size.height + pad)}`)
        setFitTurn(turn)
      } catch (error) {
        console.error('Brand preview: the sample did not draw', error)
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [ready, styleKey, columns])

  // Frame the drawing once the box has its shape, and again whenever the box is resized.
  useEffect(() => {
    const slate = slateRef.current
    const box = boxRef.current
    if (!fitTurn || !slate || !box) return undefined
    const fit = () => { try { slate.controller?.scaleToFitAndCenter?.(() => onDrawn?.(box)) } catch { /* gone */ } }
    const frame = requestAnimationFrame(fit)
    let last = box.clientWidth
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (Math.abs(box.clientWidth - last) < 2) return
      last = box.clientWidth
      fit()
    })
    watch?.observe(box)
    return () => { cancelAnimationFrame(frame); watch?.disconnect() }
  }, [fitTurn, aspect])

  return (
    <Box ref={boxRef} data-brand-preview-slate="" sx={{ position: 'relative', width: '100%', aspectRatio: aspect, maxHeight: 460, borderRadius: '10px', overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: style.background, [`& ${CHROME.join(', & ')}`]: { display: 'none' } }}>
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
  columns: PropTypes.number,
  onDrawn: PropTypes.func,
}
BrandPreviewSlate.defaultProps = { columns: 2, onDrawn: null }
