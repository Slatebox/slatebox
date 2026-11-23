import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { componentSlate, drawStill } from '../../workshop/boardRender'
import libraryApi from '../../../../api/client/library'

// A library item's picture, drawn by the one renderer (slateboxjs/boards/still, through boardRender): a component as
// its board alone, a slate or presentation as its notes and boards. Read-only, fitted to its box. A card's picture
// fetches the item's content and draws only when it nears the viewport; the item page hands its content in.

const contents = new Map()
/** The published content of an item, fetched once per page visit. */
export function itemContent(itemId) {
  if (!contents.has(itemId)) {
    contents.set(itemId, libraryApi.get({ itemId }).then(answer => answer.version.content, (err) => { contents.delete(itemId); throw err }))
  }
  return contents.get(itemId)
}
/** Remember content already read (the item page's), so a card for the same item does not fetch it again. */
export const rememberContent = (itemId, content) => { if (itemId && content) contents.set(itemId, Promise.resolve(content)) }

/** The slate the renderer draws for an item's content. */
export function stillSlate(content, title) {
  if (!content) return null
  if (content.kind === 'component') return content.workshop ? componentSlate(content.workshop, title) : null
  return content.slate ?? null
}

export default function LibraryStill({ itemId, content, title, label, height = 180, eager = false, fitShape = false }) {
  const host = useRef(null)
  const [state, setState] = useState('waiting')
  // The item page's picture takes the shape of what it shows (a wide plan is wide), between a third and two thirds of its width.
  const [shape, setShape] = useState(null)

  useEffect(() => {
    const el = host.current
    if (!el) return undefined
    let still = null
    let gone = false
    const draw = async () => {
      try {
        const body = content ?? (await itemContent(itemId))
        const slate = stillSlate(body, title)
        if (gone) return
        if (!slate) { setState('empty'); return }
        still = await drawStill(el, slate)
        if (gone) { still.destroy(); return }
        if (fitShape && still.frame?.width) setShape(Math.min(Math.max((still.frame.height + 48) / (still.frame.width + 48), 0.34), 0.66))
        setState('drawn')
      } catch (err) {
        if (!gone) setState('failed')
        console.warn('A library picture could not be drawn.', err)
      }
    }
    let observer = null
    if (eager || typeof IntersectionObserver === 'undefined') draw()
    else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); draw() }
      }, { rootMargin: '400px' })
      observer.observe(el)
    }
    return () => { gone = true; observer?.disconnect(); still?.destroy() }
  }, [itemId, content, eager])

  return (
    <Box
      role="img"
      aria-label={label}
      data-library-still={itemId}
      data-state={state}
      sx={{ position: 'relative', ...(shape ? { height: { xs: 280, sm: 'auto' }, aspectRatio: { sm: `1 / ${shape.toFixed(3)}` } } : { height }), borderRadius: 1.5, overflow: 'hidden', bgcolor: 'background.default', border: 1, borderColor: 'divider' }}
    >
      <Box ref={host} sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', '& svg': { display: 'block' } }} />
      {state !== 'drawn' && (
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', px: 2, textAlign: 'center' }}>
          {state === 'failed' ? 'The picture could not be drawn.' : state === 'empty' ? 'Nothing to show yet.' : 'Drawing…'}
        </Typography>
      )}
    </Box>
  )
}

LibraryStill.propTypes = {
  itemId: PropTypes.string.isRequired,
  content: PropTypes.object,
  title: PropTypes.string,
  label: PropTypes.string,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string, PropTypes.object]),
  eager: PropTypes.bool,
  fitShape: PropTypes.bool,
}
