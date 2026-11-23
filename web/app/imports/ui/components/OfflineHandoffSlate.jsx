import React from 'react'
import { OfflineHandoffBoard } from 'slateboxjs/workshops'

export default function OfflineHandoffSlate({value, onChange, readOnly}) {
  return <OfflineHandoffBoard value={value} onChange={onChange} readOnly={readOnly}/>
}
