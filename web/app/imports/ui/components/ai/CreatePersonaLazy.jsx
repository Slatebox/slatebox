import React, { Suspense, lazy, useState } from 'react'
import { useAtomValue } from 'jotai'
import { isPersonaOpen } from '../../jotai/atoms'

// The AI conversation editor (an admin's tool) brings a whole JSON editor (vanilla-jsoneditor, over a
// megabyte). It loads the first time it is opened, never with the page, and stays mounted after that so
// it closes with its own transition.
const CreatePersona = lazy(() => import('./CreatePersona'))

export default function CreatePersonaLazy() {
  const open = useAtomValue(isPersonaOpen)
  const [wanted, setWanted] = useState(false)
  if (open && !wanted) setWanted(true)
  if (!wanted && !open) return null
  return <Suspense fallback={null}><CreatePersona /></Suspense>
}
