import React, { Suspense, lazy } from 'react'
import PropTypes from 'prop-types'

// The library's place on a canvas. A builder slate (slate.library.mode 'build', made by
// library.branch) shows the build bar; a reviewer's private review copy ('review', made by
// library.review.open) shows the review panel. Any other slate shows nothing and loads nothing.
const BuildBar = lazy(() => import('./build/BuildBar'))
const ReviewPanel = lazy(() => import('./review/ReviewPanel'))

export default function LibrarySlot({ slate }) {
  const mode = slate?.library?.mode
  if (mode !== 'build' && mode !== 'review') return null
  return (
    <Suspense fallback={null}>
      {mode === 'build' ? <BuildBar slate={slate} /> : <ReviewPanel slate={slate} />}
    </Suspense>
  )
}

LibrarySlot.propTypes = {
  slate: PropTypes.shape({
    shareId: PropTypes.string,
    library: PropTypes.shape({ mode: PropTypes.oneOf(['build', 'review']), itemId: PropTypes.string, version: PropTypes.number, boardId: PropTypes.string }),
  }),
}

LibrarySlot.defaultProps = { slate: null }
