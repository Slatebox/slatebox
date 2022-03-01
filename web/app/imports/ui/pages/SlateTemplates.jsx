import React from 'react'
import DisplaySlates from '../components/DisplaySlates'

export default function SlateTemplates() {
  return (
    <DisplaySlates
      type="templates"
      cols={2}
      cellHeight={350}
      slateMinimumPerPage={6}
      pinSlatePerPageCount="true"
      showDescription="true"
    />
  )
}
