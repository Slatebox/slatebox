// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Slot canvas.recipes: what recipes do on this slate. The notes they keep up to date
// (MaintainedNotes) and, when the slate is kept in a repository, its sync line (SyncedWithRepo).
import React from 'react'
import PropTypes from 'prop-types'
import MaintainedNotes from './MaintainedNotes'
import SyncedWithRepo from './SyncedWithRepo'

export default function CanvasRecipes(props) {
  return (
    <>
      <SyncedWithRepo slate={props.slate} canEdit={props.canEdit} />
      <MaintainedNotes {...props} />
    </>
  )
}

CanvasRecipes.propTypes = {
  slate: PropTypes.object,
  canEdit: PropTypes.bool,
  readSelection: PropTypes.func,
}
