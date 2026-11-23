import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import SnapSlate from '../SnapSlate'
import libraryApi from '../../../api/client/library'
import { previewSlateOf } from './previewSlate.mjs'

// A still of a library item, drawn by the one renderer the canvas uses (SnapSlate → boardRender):
// a component's board, or a slate's notes and boards. Given the content, it draws it; given only an
// item id, it reads the item (library.get) once the tile comes into view.
export default function LibraryPreview({ itemId, version, content, title, height }) {
  const box = React.useRef(null)
  const [loaded, setLoaded] = React.useState(content || null)
  const [failed, setFailed] = React.useState(false)
  React.useEffect(() => { if (content) setLoaded(content) }, [content])
  React.useEffect(() => {
    if (content || loaded || !itemId || !box.current) return undefined
    let live = true
    const read = () => libraryApi.get({ itemId, ...(version && { version }) })
      .then((answer) => { if (live) setLoaded(answer.version.content) })
      .catch(() => { if (live) setFailed(true) })
    if (typeof IntersectionObserver !== 'function') { read(); return () => { live = false } }
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { seen.disconnect(); read() }
    }, { rootMargin: '200px' })
    seen.observe(box.current)
    return () => { live = false; seen.disconnect() }
  }, [itemId, version, content, loaded])
  const slate = React.useMemo(() => (loaded ? previewSlateOf(loaded, { key: `${itemId || 'item'}${version || ''}`, title }) : null), [loaded, itemId, version, title])
  return (
    <Box ref={box} aria-hidden="true" inert="" data-testid="library-preview"
      sx={{ position: 'relative', height, overflow: 'hidden', borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
      {slate && <SnapSlate slate={slate} allowDrag={false} allowZoom={false} disableCollab index={0} />}
      {!slate && (
        <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          {failed ? 'No preview' : ''}
        </Typography>
      )}
    </Box>
  )
}

LibraryPreview.propTypes = {
  itemId: PropTypes.string,
  version: PropTypes.number,
  content: PropTypes.object,
  title: PropTypes.string,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
}

LibraryPreview.defaultProps = { itemId: null, version: null, content: null, title: '', height: 120 }
